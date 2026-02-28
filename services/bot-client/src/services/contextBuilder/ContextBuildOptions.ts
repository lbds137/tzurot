/**
 * Options for building message context.
 * Extracted from MessageContextBuilder for max-lines compliance.
 */

import type { ResolvedExtendedContextSettings } from '@tzurot/common-types';
import type { GuildMember, User } from 'discord.js';

export interface ContextBuildOptions {
  /**
   * Extended context settings: resolved limits for fetching recent Discord messages.
   * Includes maxMessages, maxAge, and maxImages limits.
   * When provided, merges Discord messages with DB conversation history.
   */
  extendedContext?: ResolvedExtendedContextSettings;
  /**
   * Bot's Discord user ID (required for extended context to identify assistant messages)
   */
  botUserId?: string;
  /**
   * Override user for context building (slash commands).
   * When provided, this user is used for userId, persona resolution, and BYOK lookup
   * instead of message.author. Required when the anchor message isn't from the invoking user.
   */
  overrideUser?: User;
  /**
   * Override guild member for context building (slash commands).
   * When provided, this member is used for display name and guild info extraction.
   * If overrideUser is set but overrideMember is not, we'll try to fetch the member.
   */
  overrideMember?: GuildMember | null;
  /**
   * Weigh-in mode flag (slash commands without message).
   * When true, the content parameter is the weigh-in prompt, not the anchor message content.
   * This prevents link replacements from the anchor message being applied to the prompt.
   */
  isWeighInMode?: boolean;
  /**
   * Whether to fetch cross-channel history to fill unused context budget.
   * When true and current channel history is under maxMessages, fills remaining
   * budget with history from other channels where this user+personality interacted.
   */
  crossChannelHistoryEnabled?: boolean;
}
