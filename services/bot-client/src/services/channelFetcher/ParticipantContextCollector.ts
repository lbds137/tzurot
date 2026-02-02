/**
 * Participant Context Collector
 *
 * Functions for collecting guild member info and reactor users for participant context.
 * Extracted from DiscordChannelFetcher.ts for better modularity.
 */

import type { Message } from 'discord.js';
import { createLogger, MESSAGE_LIMITS, type MessageReaction } from '@tzurot/common-types';
import type { ParticipantGuildInfo, ExtendedContextUser } from './types.js';

const logger = createLogger('ParticipantContextCollector');

/**
 * Extract guild member info from a Discord message
 * Used to collect guild info for extended context participants
 */
export function extractGuildInfo(msg: Message): ParticipantGuildInfo {
  const member = msg.member;
  if (!member) {
    return { roles: [] };
  }

  try {
    // Get role names, sorted by position (highest first), excluding @everyone
    const roles =
      member.roles !== undefined
        ? Array.from(member.roles.cache.values())
            .filter(r => r.id !== msg.guild?.id)
            .sort((a, b) => b.position - a.position)
            .slice(0, MESSAGE_LIMITS.MAX_GUILD_ROLES)
            .map(r => r.name)
        : [];

    return {
      roles,
      // Display color from highest colored role (#000000 is treated as transparent)
      displayColor: member.displayHexColor !== '#000000' ? member.displayHexColor : undefined,
      // When user joined the server
      joinedAt: member.joinedAt?.toISOString(),
    };
  } catch (error) {
    // Discord.js can throw when accessing member properties in edge cases
    logger.warn(
      { err: error, memberId: member.id },
      '[ParticipantContextCollector] Failed to extract guild info, returning empty'
    );
    return { roles: [] };
  }
}

/**
 * Limit participantGuildInfo to most recent N participants.
 * Relies on ES2015+ object key insertion order guarantee (string keys preserve order).
 * We delete and re-add entries on update to maintain recency ordering.
 */
export function limitParticipants(
  participantGuildInfo: Record<string, ParticipantGuildInfo>
): Record<string, ParticipantGuildInfo> {
  const entries = Object.entries(participantGuildInfo);
  if (entries.length <= MESSAGE_LIMITS.MAX_EXTENDED_CONTEXT_PARTICIPANTS) {
    return participantGuildInfo;
  }

  // Keep only the last N entries (most recent participants)
  const limited = entries.slice(-MESSAGE_LIMITS.MAX_EXTENDED_CONTEXT_PARTICIPANTS);
  return Object.fromEntries(limited);
}

/**
 * Collect unique reactor users from reactions
 *
 * @param reactions - Array of reactions to collect users from
 * @param existingUsers - Set of user IDs already collected (for deduplication)
 * @returns Array of unique reactor users
 */
export function collectReactorUsers(
  reactions: MessageReaction[],
  existingUsers: Set<string>
): ExtendedContextUser[] {
  const reactorUsers: ExtendedContextUser[] = [];
  const seenIds = new Set(existingUsers);

  for (const reaction of reactions) {
    for (const reactor of reaction.reactors) {
      // Extract Discord ID from personaId format ('discord:123456')
      const discordId = reactor.personaId.replace('discord:', '');
      if (seenIds.has(discordId)) {
        continue;
      }
      seenIds.add(discordId);

      reactorUsers.push({
        discordId,
        username: reactor.displayName, // Best we have from reaction data
        displayName: reactor.displayName,
        isBot: false,
      });
    }
  }

  return reactorUsers;
}
