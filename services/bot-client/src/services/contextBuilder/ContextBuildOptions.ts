/**
 * Options for building message context.
 * Extracted from MessageContextBuilder for max-lines compliance.
 */

import type { ResolvedExtendedContextSettings } from '@tzurot/common-types/schemas/api/adminSettings';
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
   * Anonymity flag (separate from weigh-in framing). When true, the summon is
   * anonymous: skip the persona-scoped STM-reset epoch so the user's
   * /conversation reset doesn't bound the shared channel history. A personal
   * summon (false) keeps the epoch. Defaults to isWeighInMode at the call site.
   */
  incognito?: boolean;
}
