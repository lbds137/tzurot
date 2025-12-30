/**
 * MentionResolver Types
 * Type definitions for Discord mention resolution
 */

/**
 * Information about a mentioned user's persona
 */
export interface MentionedUserInfo {
  /** Discord user ID */
  discordId: string;
  /** User's database UUID */
  userId: string;
  /** Persona's database UUID */
  personaId: string;
  /** Display name used in message replacement */
  personaName: string;
}

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
  /** Whether the role is mentionable */
  mentionable: boolean;
}

/**
 * Result of resolving user mentions in a message
 */
export interface MentionResolutionResult {
  /** Message content with mentions replaced by names */
  processedContent: string;
  /** Information about mentioned users */
  mentionedUsers: MentionedUserInfo[];
}

/**
 * Result of resolving all mention types in a message
 */
export interface FullMentionResolutionResult extends MentionResolutionResult {
  /** Information about mentioned channels (for LTM scoping) */
  mentionedChannels: ResolvedChannel[];
  /** Information about mentioned roles */
  mentionedRoles: ResolvedRole[];
}
