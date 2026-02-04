/**
 * Extended Context Persona Resolver
 *
 * Handles resolving discord:XXXX format personaIds to actual UUIDs
 * for messages fetched from extended context. Resolves BOTH message
 * authors AND reaction reactors in a single batch to minimize API calls.
 */

import { createLogger, type PersonaResolver, type ConversationMessage } from '@tzurot/common-types';

const logger = createLogger('ExtendedContextPersonaResolver');

/** Prefix used for unresolved Discord user IDs in personaId fields */
const DISCORD_ID_PREFIX = 'discord:';

/** Participant guild info type (roles, display color, join date) */
export type ParticipantGuildInfo = Record<
  string,
  { roles: string[]; displayColor?: string; joinedAt?: string }
>;

/** Result of persona resolution */
export interface PersonaResolutionResult {
  /** Number of message author personaIds resolved */
  messageCount: number;
  /** Number of reactor personaIds resolved */
  reactorCount: number;
  /** Total number resolved */
  total: number;
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
  if (!personaId.startsWith(DISCORD_ID_PREFIX)) {
    return undefined;
  }
  const discordId = personaId.slice(DISCORD_ID_PREFIX.length);
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
      logger.warn(
        { error: result.reason },
        '[ExtendedContextPersonaResolver] Failed to resolve persona'
      );
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
 * @returns true if the reactor was updated, false otherwise
 */
function applyResolvedPersonaToReactor(
  reactor: { personaId?: string; displayName: string },
  resolvedMap: Map<string, ResolvedPersonaInfo>
): boolean {
  if (reactor.personaId === undefined) {
    return false;
  }
  if (!reactor.personaId.startsWith(DISCORD_ID_PREFIX)) {
    return false;
  }
  const discordId = reactor.personaId.slice(DISCORD_ID_PREFIX.length);
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
    if (msg.personaId?.startsWith(DISCORD_ID_PREFIX)) {
      const discordId = msg.personaId.slice(DISCORD_ID_PREFIX.length);
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
 * Resolve ALL discord:XXXX format personaIds to actual UUIDs.
 * Handles BOTH message authors AND reaction reactors in a single batch.
 * Also remaps participantGuildInfo keys to use the new UUIDs.
 *
 * @param messages - Messages to update (modified in place)
 * @param userMap - Map of discordId -> userId from batch creation
 * @param personalityId - Personality ID for persona resolution
 * @param personaResolver - Persona resolver instance
 * @param participantGuildInfo - Guild info map to remap (modified in place)
 * @returns Resolution result with counts
 */
export async function resolveExtendedContextPersonaIds(
  messages: ConversationMessage[],
  userMap: Map<string, string>,
  personalityId: string,
  personaResolver: PersonaResolver,
  participantGuildInfo?: ParticipantGuildInfo
): Promise<PersonaResolutionResult> {
  if (userMap.size === 0) {
    return { messageCount: 0, reactorCount: 0, total: 0 };
  }

  // Collect ALL discordIds (message authors + reactors) in one pass
  const uniqueDiscordIds = collectAllDiscordIdsNeedingResolution(messages, userMap);
  if (uniqueDiscordIds.size === 0) {
    return { messageCount: 0, reactorCount: 0, total: 0 };
  }

  // Single batch resolve for all
  const resolvedMap = await batchResolvePersonas(uniqueDiscordIds, personalityId, personaResolver);

  // Apply to both message authors and reactors
  const { messageCount, reactorCount, guildInfoRemap } = applyResolvedPersonas(
    messages,
    resolvedMap
  );

  // Remap guild info keys
  if (participantGuildInfo !== undefined && guildInfoRemap.size > 0) {
    remapParticipantGuildInfoKeys(participantGuildInfo, guildInfoRemap);
  }

  const total = messageCount + reactorCount;
  if (total > 0) {
    logger.debug(
      { messageCount, reactorCount, total },
      '[ExtendedContextPersonaResolver] Resolved personaIds to UUIDs'
    );
  }

  return { messageCount, reactorCount, total };
}

// --- Legacy exports for backwards compatibility during transition ---
// These can be removed once all callers are updated

/** @deprecated Use collectAllDiscordIdsNeedingResolution instead */
export function collectDiscordIdsNeedingResolution(
  messages: ConversationMessage[],
  userMap: Map<string, string>
): Set<string> {
  const uniqueDiscordIds = new Set<string>();
  for (const msg of messages) {
    if (msg.personaId?.startsWith(DISCORD_ID_PREFIX)) {
      const discordId = msg.personaId.slice(DISCORD_ID_PREFIX.length);
      if (userMap.has(discordId)) {
        uniqueDiscordIds.add(discordId);
      }
    }
  }
  return uniqueDiscordIds;
}

/** @deprecated Use applyResolvedPersonas instead */
export function updateMessagesWithResolvedPersonas(
  messages: ConversationMessage[],
  resolvedMap: Map<string, { personaId: string; preferredName: string | null | undefined }>
): { resolvedCount: number; guildInfoRemap: Map<string, string> } {
  const { messageCount, guildInfoRemap } = applyResolvedPersonas(messages, resolvedMap);
  return { resolvedCount: messageCount, guildInfoRemap };
}
