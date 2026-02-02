/**
 * Extended Context Persona Resolver
 *
 * Handles resolving discord:XXXX format personaIds to actual UUIDs
 * for messages fetched from extended context.
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

/**
 * Collect discordIds from messages that need persona resolution.
 * @param messages - Messages to scan for discord:XXX personaIds
 * @param userMap - Map of discordId -> userId from batch user creation
 * @returns Set of discordIds that need persona resolution
 */
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

/**
 * Update messages with resolved persona info, returning remap for guild info.
 * @param messages - Messages to update (modified in place)
 * @param resolvedMap - Map of discordId -> resolved persona info
 * @returns Object with resolvedCount and guildInfoRemap for key remapping
 */
export function updateMessagesWithResolvedPersonas(
  messages: ConversationMessage[],
  resolvedMap: Map<string, { personaId: string; preferredName: string | null | undefined }>
): { resolvedCount: number; guildInfoRemap: Map<string, string> } {
  let resolvedCount = 0;
  const guildInfoRemap = new Map<string, string>();

  for (const msg of messages) {
    if (!msg.personaId?.startsWith(DISCORD_ID_PREFIX)) {
      continue;
    }
    const discordId = msg.personaId.slice(DISCORD_ID_PREFIX.length);
    const resolved = resolvedMap.get(discordId);
    if (resolved === undefined) {
      continue;
    }
    const oldPersonaId = msg.personaId;
    msg.personaId = resolved.personaId;
    if (resolved.preferredName !== undefined && resolved.preferredName !== null) {
      msg.personaName = resolved.preferredName;
    }
    guildInfoRemap.set(oldPersonaId, resolved.personaId);
    resolvedCount++;
  }

  return { resolvedCount, guildInfoRemap };
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
 * Resolve discord:XXXX format personaIds to actual UUIDs.
 * Also remaps participantGuildInfo keys to use the new UUIDs.
 *
 * @param messages - Messages to update (modified in place)
 * @param userMap - Map of discordId -> userId from batch creation
 * @param personalityId - Personality ID for persona resolution
 * @param personaResolver - Persona resolver instance
 * @param participantGuildInfo - Guild info map to remap (modified in place)
 * @returns Number of resolved personaIds
 */
export async function resolveExtendedContextPersonaIds(
  messages: ConversationMessage[],
  userMap: Map<string, string>,
  personalityId: string,
  personaResolver: PersonaResolver,
  participantGuildInfo?: ParticipantGuildInfo
): Promise<number> {
  if (userMap.size === 0) {
    return 0;
  }

  const uniqueDiscordIds = collectDiscordIdsNeedingResolution(messages, userMap);
  if (uniqueDiscordIds.size === 0) {
    return 0;
  }

  const resolvedMap = await batchResolvePersonas(uniqueDiscordIds, personalityId, personaResolver);
  const { resolvedCount, guildInfoRemap } = updateMessagesWithResolvedPersonas(
    messages,
    resolvedMap
  );

  if (participantGuildInfo !== undefined && guildInfoRemap.size > 0) {
    remapParticipantGuildInfoKeys(participantGuildInfo, guildInfoRemap);
  }

  return resolvedCount;
}
