/**
 * Extended Context Persona Resolver
 *
 * Handles resolving discord:XXXX format personaIds to actual UUIDs
 * for messages fetched from extended context. Resolves BOTH message
 * authors AND reaction reactors in a single batch to minimize API calls.
 *
 * This module is the sole consumer of the `discord:XXXX` placeholder format
 * on the resolution side — writers (DiscordChannelFetcher, ReactionProcessor,
 * ParticipantContextCollector) construct the format, and this module strips
 * or resolves it. The shared prefix constant (`INTERNAL_DISCORD_ID_PREFIX`)
 * lives in `bot-client/src/constants/personaId.ts` so neither side has to
 * cross-import from the other. The format is a transient internal
 * representation used in the two-step fetch → resolve pipeline:
 *
 *   1. DiscordChannelFetcher / ReactionProcessor create ConversationMessage /
 *      reactor records with personaId = `discord:{discordId}` before any
 *      identity resolution
 *   2. resolveExtendedContextPersonaIds() resolves registered users'
 *      discord: → UUID, then STRIPS any remaining discord: placeholders
 *      (unregistered users) so the format NEVER leaves bot-client
 *
 * Postcondition of resolveExtendedContextPersonaIds: no message or reactor
 * exits with a `discord:XXXX` personaId. ai-worker therefore only sees
 * UUIDs (or the empty-string sentinel for unregistered users) — all
 * identity-resolution logic there is dormant and can be deleted.
 */

import {
  createLogger,
  type PersonaResolver,
  type ConversationMessage,
  type ReactionReactor,
} from '@tzurot/common-types';
import { INTERNAL_DISCORD_ID_PREFIX } from '../../constants/personaId.js';

// Re-exported for any legacy importer that still reaches here; new callers
// should import directly from `constants/personaId.ts`.
export { INTERNAL_DISCORD_ID_PREFIX };

const logger = createLogger('ExtendedContextPersonaResolver');

/** Participant guild info type (roles, display color, join date) */
export type ParticipantGuildInfo = Record<
  string,
  { roles: string[]; displayColor?: string; joinedAt?: string }
>;

/** Result of persona resolution */
interface PersonaResolutionResult {
  /** Number of message author personaIds resolved to UUIDs (registered users) */
  messageCount: number;
  /** Number of reactor personaIds resolved to UUIDs (registered users) */
  reactorCount: number;
  /** Total resolved (messageCount + reactorCount) */
  total: number;
  /**
   * Number of message author personaIds stripped (unregistered users).
   * Their `discord:XXXX` placeholder was replaced with '' — messages stay
   * in the context with display-name attribution but contribute no persona.
   */
  strippedMessageCount: number;
  /**
   * Number of reactors dropped from the reactor list (unregistered users).
   * Reactors are lightweight identity metadata; unresolved ones add no value.
   */
  strippedReactorCount: number;
}

/**
 * Extract discordId from a personaId if it starts with the discord: prefix.
 * @returns The discordId if valid and in userMap, undefined otherwise
 */
function extractDiscordId(
  personaId: string | undefined,
  userMap: Map<string, string>
): string | undefined {
  if (personaId === undefined) {
    return undefined;
  }
  if (!personaId.startsWith(INTERNAL_DISCORD_ID_PREFIX)) {
    return undefined;
  }
  const discordId = personaId.slice(INTERNAL_DISCORD_ID_PREFIX.length);
  return userMap.has(discordId) ? discordId : undefined;
}

/**
 * Collect discordIds from reaction reactors.
 */
function collectReactorDiscordIds(
  reactions: NonNullable<ConversationMessage['messageMetadata']>['reactions'],
  userMap: Map<string, string>,
  collector: Set<string>
): void {
  if (reactions === undefined) {
    return;
  }
  for (const reaction of reactions) {
    for (const reactor of reaction.reactors) {
      const discordId = extractDiscordId(reactor.personaId, userMap);
      if (discordId !== undefined) {
        collector.add(discordId);
      }
    }
  }
}

/**
 * Collect ALL discordIds needing resolution from messages.
 * Includes both message authors AND reaction reactors.
 *
 * @param messages - Messages to scan
 * @param userMap - Map of discordId -> userId from batch user creation
 * @returns Set of discordIds that need persona resolution
 */
export function collectAllDiscordIdsNeedingResolution(
  messages: ConversationMessage[],
  userMap: Map<string, string>
): Set<string> {
  const uniqueDiscordIds = new Set<string>();

  for (const msg of messages) {
    // Check message author
    const authorDiscordId = extractDiscordId(msg.personaId, userMap);
    if (authorDiscordId !== undefined) {
      uniqueDiscordIds.add(authorDiscordId);
    }

    // Check reaction reactors
    collectReactorDiscordIds(msg.messageMetadata?.reactions, userMap, uniqueDiscordIds);
  }

  return uniqueDiscordIds;
}

/**
 * Batch resolve personas for a set of discordIds.
 * @param discordIds - Set of Discord user IDs to resolve
 * @param personalityId - Personality ID for persona lookup
 * @param personaResolver - Persona resolver instance
 * @returns Map of discordId -> resolved persona info
 */
export async function batchResolvePersonas(
  discordIds: Set<string>,
  personalityId: string,
  personaResolver: PersonaResolver
): Promise<Map<string, { personaId: string; preferredName: string | null | undefined }>> {
  const resolvedMap = new Map<
    string,
    { personaId: string; preferredName: string | null | undefined }
  >();

  const resolutionResults = await Promise.allSettled(
    Array.from(discordIds).map(async discordId => {
      const resolved = await personaResolver.resolve(discordId, personalityId);
      return { discordId, resolved };
    })
  );

  for (const result of resolutionResults) {
    if (result.status === 'rejected') {
      logger.warn({ err: result.reason }, 'Failed to resolve persona');
      continue;
    }
    const { discordId, resolved } = result.value;
    if (resolved.config.personaId.length > 0) {
      resolvedMap.set(discordId, {
        personaId: resolved.config.personaId,
        preferredName: resolved.config.preferredName,
      });
    }
  }

  return resolvedMap;
}

/** Type alias for resolved persona info */
interface ResolvedPersonaInfo {
  personaId: string;
  preferredName: string | null | undefined;
}

/**
 * Apply resolved persona to a single reactor if applicable.
 * Uses ReactionReactor type from common-types for type safety.
 * @returns true if the reactor was updated, false otherwise
 */
function applyResolvedPersonaToReactor(
  reactor: ReactionReactor,
  resolvedMap: Map<string, ResolvedPersonaInfo>
): boolean {
  if (!reactor.personaId.startsWith(INTERNAL_DISCORD_ID_PREFIX)) {
    return false;
  }
  const discordId = reactor.personaId.slice(INTERNAL_DISCORD_ID_PREFIX.length);
  const resolved = resolvedMap.get(discordId);
  if (resolved === undefined) {
    return false;
  }
  reactor.personaId = resolved.personaId;
  if (resolved.preferredName !== undefined && resolved.preferredName !== null) {
    reactor.displayName = resolved.preferredName;
  }
  return true;
}

/**
 * Apply resolved personas to reaction reactors.
 * @returns Number of reactors updated
 */
function applyResolvedPersonasToReactors(
  reactions: NonNullable<ConversationMessage['messageMetadata']>['reactions'],
  resolvedMap: Map<string, ResolvedPersonaInfo>
): number {
  if (reactions === undefined) {
    return 0;
  }
  let count = 0;
  for (const reaction of reactions) {
    for (const reactor of reaction.reactors) {
      if (applyResolvedPersonaToReactor(reactor, resolvedMap)) {
        count++;
      }
    }
  }
  return count;
}

/**
 * Apply resolved personas to message authors and reactors.
 *
 * @param messages - Messages to update (modified in place)
 * @param resolvedMap - Map of discordId -> resolved persona info
 * @returns Resolution counts and guild info remap
 */
export function applyResolvedPersonas(
  messages: ConversationMessage[],
  resolvedMap: Map<string, ResolvedPersonaInfo>
): { messageCount: number; reactorCount: number; guildInfoRemap: Map<string, string> } {
  let messageCount = 0;
  let reactorCount = 0;
  const guildInfoRemap = new Map<string, string>();

  for (const msg of messages) {
    // Apply to message author
    if (msg.personaId?.startsWith(INTERNAL_DISCORD_ID_PREFIX)) {
      const discordId = msg.personaId.slice(INTERNAL_DISCORD_ID_PREFIX.length);
      const resolved = resolvedMap.get(discordId);
      if (resolved !== undefined) {
        const oldPersonaId = msg.personaId;
        msg.personaId = resolved.personaId;
        if (resolved.preferredName !== undefined && resolved.preferredName !== null) {
          msg.personaName = resolved.preferredName;
        }
        guildInfoRemap.set(oldPersonaId, resolved.personaId);
        messageCount++;
      }
    }

    // Apply to reaction reactors (extracted to reduce nesting)
    reactorCount += applyResolvedPersonasToReactors(msg.messageMetadata?.reactions, resolvedMap);
  }

  return { messageCount, reactorCount, guildInfoRemap };
}

/**
 * Remap participantGuildInfo keys from discord:XXXX to resolved UUIDs.
 * @param participantGuildInfo - Guild info map to remap (modified in place)
 * @param guildInfoRemap - Map of oldKey -> newKey for remapping
 */
export function remapParticipantGuildInfoKeys(
  participantGuildInfo: ParticipantGuildInfo,
  guildInfoRemap: Map<string, string>
): void {
  for (const [oldKey, newKey] of guildInfoRemap) {
    if (oldKey in participantGuildInfo) {
      participantGuildInfo[newKey] = participantGuildInfo[oldKey];
      delete participantGuildInfo[oldKey];
    }
  }
}

/**
 * Strip any remaining discord: placeholder personaIds after the resolve pass.
 * Unregistered users don't have UUIDs; their discord: placeholders must NOT
 * leave bot-client. Message authors get their personaId set to '' (empty
 * sentinel — matches the codebase convention of 'assistant' for non-user
 * messages; preserves the ConversationMessage.personaId: string non-null
 * contract). Display name stays for attribution. Reactors are dropped from
 * the list entirely because unresolved reactor identity adds no value.
 */
function stripUnresolvedPlaceholders(messages: ConversationMessage[]): {
  strippedMessageCount: number;
  strippedReactorCount: number;
} {
  let strippedMessageCount = 0;
  let strippedReactorCount = 0;

  for (const msg of messages) {
    if (msg.personaId?.startsWith(INTERNAL_DISCORD_ID_PREFIX)) {
      msg.personaId = '';
      strippedMessageCount++;
    }

    const reactions = msg.messageMetadata?.reactions;
    if (reactions === undefined) {
      continue;
    }
    for (const reaction of reactions) {
      const before = reaction.reactors.length;
      reaction.reactors = reaction.reactors.filter(
        r => !r.personaId.startsWith(INTERNAL_DISCORD_ID_PREFIX)
      );
      strippedReactorCount += before - reaction.reactors.length;
    }
  }

  return { strippedMessageCount, strippedReactorCount };
}

/**
 * Resolve ALL discord:XXXX format personaIds to actual UUIDs, then strip
 * any that couldn't be resolved (unregistered users). Handles BOTH message
 * authors AND reaction reactors in a single batch. Also remaps
 * participantGuildInfo keys to use the new UUIDs.
 *
 * **Postcondition**: no message or reactor exits with a `discord:XXXX`
 * personaId. ai-worker therefore only ever sees UUIDs (or the empty-string
 * sentinel for unresolved message authors). The `discord:XXXX` format is
 * strictly internal to this module and the fetch sites that produce it.
 *
 * @param messages - Messages to update (modified in place)
 * @param userMap - Map of discordId -> userId from batch creation
 * @param personalityId - Personality ID for persona resolution
 * @param personaResolver - Persona resolver instance
 * @param participantGuildInfo - Guild info map to remap (modified in place)
 * @returns Resolution result with resolved + stripped counts
 */
export async function resolveExtendedContextPersonaIds(
  messages: ConversationMessage[],
  userMap: Map<string, string>,
  personalityId: string,
  personaResolver: PersonaResolver,
  participantGuildInfo?: ParticipantGuildInfo
): Promise<PersonaResolutionResult> {
  // Collect ALL discordIds (message authors + reactors) in one pass.
  // If userMap is empty or nothing matches, the set is empty and we fall
  // straight through to the strip pass.
  const uniqueDiscordIds = collectAllDiscordIdsNeedingResolution(messages, userMap);

  let messageCount = 0;
  let reactorCount = 0;

  if (uniqueDiscordIds.size > 0) {
    // Single batch resolve for all registered users
    const resolvedMap = await batchResolvePersonas(
      uniqueDiscordIds,
      personalityId,
      personaResolver
    );

    // Apply to both message authors and reactors
    const applyResult = applyResolvedPersonas(messages, resolvedMap);
    messageCount = applyResult.messageCount;
    reactorCount = applyResult.reactorCount;

    // Remap guild info keys
    if (participantGuildInfo !== undefined && applyResult.guildInfoRemap.size > 0) {
      remapParticipantGuildInfoKeys(participantGuildInfo, applyResult.guildInfoRemap);
    }
  }

  // Strip any remaining discord: placeholders (unregistered users).
  // Runs unconditionally so users not in userMap (provisioning failed or
  // userMap was empty) still get cleaned up.
  const { strippedMessageCount, strippedReactorCount } = stripUnresolvedPlaceholders(messages);

  const total = messageCount + reactorCount;
  if (total > 0 || strippedMessageCount > 0 || strippedReactorCount > 0) {
    logger.debug(
      { messageCount, reactorCount, total, strippedMessageCount, strippedReactorCount },
      'Resolved/stripped personaIds'
    );
  }

  return {
    messageCount,
    reactorCount,
    total,
    strippedMessageCount,
    strippedReactorCount,
  };
}
