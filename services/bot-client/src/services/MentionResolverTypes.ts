/**
 * MentionResolver Types
 * Type definitions for Discord channel/role mention resolution.
 *
 * User-mention resolution is NOT done bot-side (the worker re-derives it from
 * the envelope), so there is no `mentionedUsers` shape here.
 */

/**
 * Information about a mentioned channel
 */
export interface ResolvedChannel {
  /** Discord channel ID */
  channelId: string;
  /** Channel name (without #) */
  channelName: string;
  /** Channel topic/description (for context injection) */
  topic?: string;
  /** Guild ID this channel belongs to */
  guildId?: string;
}

/**
 * Information about a mentioned role
 */
export interface ResolvedRole {
  /** Discord role ID */
  roleId: string;
  /** Role name (without @) */
  roleName: string;
  /** Whether the role is mentionable (absent when the source didn't carry it) */
  mentionable?: boolean;
}

/**
 * Result of resolving channel + role mentions in a message. User mentions are
 * left raw (the worker re-derives user→persona rewriting from the envelope).
 */
export interface FullMentionResolutionResult {
  /** Message content with channel/role mentions replaced by names (user mentions left raw). */
  processedContent: string;
  /** Information about mentioned channels (for LTM scoping) */
  mentionedChannels: ResolvedChannel[];
  /** Information about mentioned roles */
  mentionedRoles: ResolvedRole[];
}
