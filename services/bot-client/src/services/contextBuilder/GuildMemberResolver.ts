/**
 * Guild Member Resolver
 *
 * Handles resolving and extracting guild member info for context building.
 */

import type { Message, GuildMember } from 'discord.js';
import { MESSAGE_LIMITS, type GuildMemberInfo } from '@tzurot/common-types';

/** Options that may contain member override */
interface MemberResolveOptions {
  /** Override guild member for context building */
  overrideMember?: GuildMember | null;
  /** Override user for context building (used to fetch member if no overrideMember) */
  overrideUser?: { id: string };
}

/**
 * Extract guild member info (roles, color, join date) from a Discord member.
 * @param member - Guild member to extract info from
 * @param guildId - Guild ID (to filter out @everyone role)
 * @returns GuildMemberInfo or undefined if member is null/undefined
 */
export function extractGuildMemberInfo(
  member: GuildMember | null | undefined,
  guildId: string | undefined
): GuildMemberInfo | undefined {
  if (!member) {
    return undefined;
  }
  return {
    // Get role names (excluding @everyone which has same ID as guild)
    // Sort by position (highest first), limit per MESSAGE_LIMITS.MAX_GUILD_ROLES
    roles:
      member.roles !== undefined
        ? Array.from(member.roles.cache.values())
            .filter(r => r.id !== guildId)
            .sort((a, b) => b.position - a.position)
            .slice(0, MESSAGE_LIMITS.MAX_GUILD_ROLES)
            .map(r => r.name)
        : [],
    // Display color from highest colored role (#000000 is treated as transparent)
    displayColor: member.displayHexColor !== '#000000' ? member.displayHexColor : undefined,
    // When user joined the server
    joinedAt: member.joinedAt?.toISOString(),
  };
}

/**
 * Resolve the effective guild member for context building.
 *
 * Priority:
 * 1. Explicit overrideMember (if provided and not null)
 * 2. Fetch member for overrideUser (if overrideUser provided but no overrideMember)
 * 3. message.member (default for @mention flow)
 * 4. Fetch member for message.author (fallback)
 *
 * @param message - The anchor Discord message
 * @param options - Options that may contain member/user overrides
 * @returns Resolved GuildMember or null
 */
export async function resolveEffectiveMember(
  message: Message,
  options: MemberResolveOptions
): Promise<GuildMember | null> {
  // If overrideMember is explicitly provided (including null), use it
  if (options.overrideMember !== undefined) {
    return options.overrideMember;
  }

  // If overrideUser is provided, try to fetch their member
  if (options.overrideUser !== undefined && message.guild !== null) {
    try {
      return await message.guild.members.fetch(options.overrideUser.id);
    } catch {
      // User not in guild or fetch failed
      return null;
    }
  }

  // Default: use message.member or fetch message.author
  if (message.member !== null) {
    return message.member;
  }
  if (message.guild !== null) {
    try {
      return await message.guild.members.fetch(message.author.id);
    } catch {
      return null;
    }
  }
  return null;
}
