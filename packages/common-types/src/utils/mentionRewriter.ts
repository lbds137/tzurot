/**
 * Mention rewriting kernels — the scan/dedup/cap/replace logic shared by
 * bot-client's MentionResolver and ai-worker's content rewriter.
 *
 * Shared-implementation guarantee: the ORDERING rules are the drift surface
 * here, not the lookups. Mention ids are processed in content order, deduped,
 * and capped; beyond-cap ids are left untouched in the content; within-cap
 * ids that fail to resolve get a placeholder (channels/roles) or stay raw
 * (users). Re-implementing those rules on one side would inevitably drift.
 *
 * What stays caller-side: HOW ids resolve. Bot-client resolves users from
 * the live mentions collection + its DB, channels/roles from the guild
 * cache; ai-worker resolves users from the envelope's rawMentionedUsers +
 * its own DB, channels/roles from the envelope's capture-time raw lists.
 */

import { DISCORD_MENTIONS, isValidDiscordId } from '../constants/discord.js';
import { createLogger } from './logger.js';
import type { RawMentionedChannel, RawMentionedRole } from '../types/schemas/rawEnvelope.js';

const logger = createLogger('MentionRewriter');

/** A user-mention target — derivable from a live Discord User or a raw envelope user. */
export interface MentionTargetUser {
  discordId: string;
  username: string;
  /** Effective display name (globalName ?? username on the bot side). */
  displayName: string;
  isBot: boolean;
}

/** A resolved user mention (persona attached). */
export interface ResolvedUserMention {
  discordId: string;
  /** Internal user UUID. */
  userId: string;
  personaId: string;
  /** The name substituted into the content. */
  personaName: string;
}

/** The services the user-mention resolution needs on either side. */
export interface UserMentionDeps {
  /** getOrCreateUser(discordId, username, displayName, bio, isBot) — null for bots. */
  getOrCreateUser(
    discordId: string,
    username: string,
    displayName?: string,
    bio?: string,
    isBot?: boolean
  ): Promise<{ userId: string } | null>;
  /** Persona resolution for a user+personality pair. */
  resolvePersona(
    discordUserId: string,
    personalityId: string
  ): Promise<{ personaId: string; preferredName: string | null }>;
  /**
   * DB fallback for mention ids absent from the target map (user not in a
   * shared server / not in the message's mention collection).
   */
  findUserByDiscordId(discordId: string): Promise<{ id: string; username: string } | null>;
}

export interface UserMentionResult {
  processedContent: string;
  mentionedUsers: ResolvedUserMention[];
}

/** Resolve one in-map mention target to its persona, or null (bots, errors). */
async function resolveKnownTarget(
  target: MentionTargetUser,
  personalityId: string,
  deps: UserMentionDeps
): Promise<ResolvedUserMention | null> {
  try {
    const provisioned = await deps.getOrCreateUser(
      target.discordId,
      target.username,
      target.displayName,
      undefined, // bio
      target.isBot
    );
    // Bots have no personas — leave their mention tags untouched.
    if (provisioned === null) {
      return null;
    }

    const persona = await deps.resolvePersona(target.discordId, personalityId);
    return {
      discordId: target.discordId,
      userId: provisioned.userId,
      personaId: persona.personaId,
      personaName: persona.preferredName ?? target.displayName,
    };
  } catch (error) {
    logger.error({ err: error, discordId: target.discordId }, 'Failed to resolve known user');
    return null;
  }
}

/** DB-fallback resolution for ids outside the target map. */
async function resolveUnknownTarget(
  discordId: string,
  personalityId: string,
  deps: UserMentionDeps
): Promise<ResolvedUserMention | null> {
  try {
    const user = await deps.findUserByDiscordId(discordId);
    if (user === null) {
      return null;
    }
    const persona = await deps.resolvePersona(discordId, personalityId);
    return {
      discordId,
      userId: user.id,
      personaId: persona.personaId,
      personaName: persona.preferredName ?? user.username,
    };
  } catch (error) {
    logger.error({ err: error, discordId }, 'Failed to look up existing user');
    return null;
  }
}

/**
 * Resolve `<@id>` / `<@!id>` user mentions to `@personaName`.
 *
 * Content-order unique ids, capped at MAX_PER_MESSAGE (beyond-cap ids left
 * raw). In-map ids upsert + persona-resolve; out-of-map ids fall back to the
 * DB lookup. Unresolvable ids (bots, unknown users) stay as raw tags.
 */
export async function resolveUserMentions(
  content: string,
  targets: ReadonlyMap<string, MentionTargetUser>,
  personalityId: string,
  deps: UserMentionDeps
): Promise<UserMentionResult> {
  const mentionRegex = new RegExp(DISCORD_MENTIONS.USER_PATTERN, 'g');
  const matches = [...content.matchAll(mentionRegex)];
  if (matches.length === 0) {
    return { processedContent: content, mentionedUsers: [] };
  }

  logger.debug({ mentionCount: matches.length }, 'Found user mentions to resolve');

  // Snowflake-validate like the channel/role scans: USER_PATTERN matches any
  // digit string, and an invalid id reaching the out-of-map fallback would
  // cost a DB round-trip on known-junk input.
  const allUniqueIds = [...new Set(matches.map(m => m[1]))].filter(isValidDiscordId);
  const overCap = allUniqueIds.length > DISCORD_MENTIONS.MAX_PER_MESSAGE;
  const uniqueIds = overCap
    ? allUniqueIds.slice(0, DISCORD_MENTIONS.MAX_PER_MESSAGE)
    : allUniqueIds;
  if (overCap) {
    logger.warn(
      { uniqueMentions: allUniqueIds.length, limit: DISCORD_MENTIONS.MAX_PER_MESSAGE },
      'Unique mentions exceed limit, processing only first batch'
    );
  }

  const resolutionResults = await Promise.all(
    uniqueIds.map(async (discordId): Promise<[string, ResolvedUserMention | null]> => {
      const target = targets.get(discordId);
      if (target !== undefined) {
        return [discordId, await resolveKnownTarget(target, personalityId, deps)];
      }
      const existing = await resolveUnknownTarget(discordId, personalityId, deps);
      if (existing === null) {
        logger.debug(
          { discordId },
          'Could not resolve mention - user not in shared server or database'
        );
      }
      return [discordId, existing];
    })
  );

  const userInfoMap = new Map<string, ResolvedUserMention>();
  for (const [discordId, userInfo] of resolutionResults) {
    if (userInfo) {
      userInfoMap.set(discordId, userInfo);
    }
  }

  let processedContent = content;
  // Map iteration preserves insertion order, so replacements apply in the
  // same content-order the ids were collected in — deterministic on both sides.
  for (const [discordId, userInfo] of userInfoMap) {
    const replacement = `@${userInfo.personaName}`;
    processedContent = processedContent.replaceAll(`<@${discordId}>`, replacement);
    processedContent = processedContent.replaceAll(`<@!${discordId}>`, replacement);
  }

  logger.debug(
    { resolvedCount: userInfoMap.size, totalMentions: uniqueIds.length },
    'Mention resolution complete'
  );

  return { processedContent, mentionedUsers: Array.from(userInfoMap.values()) };
}

/**
 * Rewrite `<#id>` channel mentions to `#channel-name`.
 *
 * Snowflake-validated unique ids, capped at MAX_CHANNELS_PER_MESSAGE
 * (beyond-cap ids left raw). Within-cap ids that don't resolve get the
 * unknown-channel placeholder so raw ids never reach the prompt.
 */
export function rewriteChannelMentions(
  content: string,
  lookup: (channelId: string) => RawMentionedChannel | null
): { processedContent: string; mentionedChannels: RawMentionedChannel[] } {
  const channelRegex = new RegExp(DISCORD_MENTIONS.CHANNEL_PATTERN, 'g');
  const matches = [...content.matchAll(channelRegex)];
  if (matches.length === 0) {
    return { processedContent: content, mentionedChannels: [] };
  }

  logger.debug({ mentionCount: matches.length }, 'Found channel mentions to resolve');

  const allUniqueIds = [...new Set(matches.map(m => m[1]))].filter(isValidDiscordId);
  const overCap = allUniqueIds.length > DISCORD_MENTIONS.MAX_CHANNELS_PER_MESSAGE;
  const uniqueIds = overCap
    ? allUniqueIds.slice(0, DISCORD_MENTIONS.MAX_CHANNELS_PER_MESSAGE)
    : allUniqueIds;
  if (overCap) {
    logger.warn(
      { uniqueChannels: allUniqueIds.length, limit: DISCORD_MENTIONS.MAX_CHANNELS_PER_MESSAGE },
      'Unique channel mentions exceed limit, processing only first batch'
    );
  }

  const mentionedChannels: RawMentionedChannel[] = [];
  let processedContent = content;
  for (const channelId of uniqueIds) {
    const resolved = lookup(channelId);
    const mentionTag = `<#${channelId}>`;
    if (resolved !== null) {
      mentionedChannels.push(resolved);
      processedContent = processedContent.replaceAll(mentionTag, `#${resolved.channelName}`);
    } else {
      logger.debug({ channelId }, 'Could not resolve channel - not in cache or external');
      processedContent = processedContent.replaceAll(
        mentionTag,
        DISCORD_MENTIONS.UNKNOWN_CHANNEL_PLACEHOLDER
      );
    }
  }

  logger.debug(
    { resolvedCount: mentionedChannels.length, totalMentions: uniqueIds.length },
    'Channel mention resolution complete'
  );

  return { processedContent, mentionedChannels };
}

/**
 * Rewrite `<@&id>` role mentions to `@RoleName`. Same scan/cap/placeholder
 * rules as channels, with MAX_ROLES_PER_MESSAGE.
 */
export function rewriteRoleMentions(
  content: string,
  lookup: (roleId: string) => RawMentionedRole | null
): { processedContent: string; mentionedRoles: RawMentionedRole[] } {
  const roleRegex = new RegExp(DISCORD_MENTIONS.ROLE_PATTERN, 'g');
  const matches = [...content.matchAll(roleRegex)];
  if (matches.length === 0) {
    return { processedContent: content, mentionedRoles: [] };
  }

  logger.debug({ mentionCount: matches.length }, 'Found role mentions to resolve');

  const allUniqueIds = [...new Set(matches.map(m => m[1]))].filter(isValidDiscordId);
  const overCap = allUniqueIds.length > DISCORD_MENTIONS.MAX_ROLES_PER_MESSAGE;
  const uniqueIds = overCap
    ? allUniqueIds.slice(0, DISCORD_MENTIONS.MAX_ROLES_PER_MESSAGE)
    : allUniqueIds;
  if (overCap) {
    logger.warn(
      { uniqueRoles: allUniqueIds.length, limit: DISCORD_MENTIONS.MAX_ROLES_PER_MESSAGE },
      'Unique role mentions exceed limit, processing only first batch'
    );
  }

  const mentionedRoles: RawMentionedRole[] = [];
  let processedContent = content;
  for (const roleId of uniqueIds) {
    const resolved = lookup(roleId);
    const mentionTag = `<@&${roleId}>`;
    if (resolved !== null) {
      mentionedRoles.push(resolved);
      processedContent = processedContent.replaceAll(mentionTag, `@${resolved.roleName}`);
    } else {
      logger.debug({ roleId }, 'Could not resolve role - not in cache or external');
      processedContent = processedContent.replaceAll(
        mentionTag,
        DISCORD_MENTIONS.UNKNOWN_ROLE_PLACEHOLDER
      );
    }
  }

  logger.debug(
    { resolvedCount: mentionedRoles.length, totalMentions: uniqueIds.length },
    'Role mention resolution complete'
  );

  return { processedContent, mentionedRoles };
}
