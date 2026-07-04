/**
 * MentionResolver - Resolves Discord channel/role mentions in message content.
 *
 * Thin Discord adapter over the shared mention-rewriting kernels in common-types
 * (`rewriteChannelMentions` / `rewriteRoleMentions`). It owns ONLY the
 * guild-cache lookups the worker cannot re-derive: channel and role names live
 * in the Discord guild cache, which only bot-client has.
 *
 * User-mention resolution (`<@id>` → persona name) is intentionally NOT done
 * here. The worker's `ContextAssembler.rewriteRawContent` re-derives it from the
 * shipped `rawMentionedUsers` against the worker's OWN Prisma, and `ContextStep`
 * unconditionally overwrites the message content with that re-derivation
 * (`job.data.message = assembled.messageContent`). Resolving user mentions
 * bot-side would be a vestigial Prisma read — so it was stripped (the worker is
 * the single source of truth for user→persona rewriting). User mentions are left
 * RAW in the content here; the worker rewrites them.
 */

import {
  type RawMentionedChannel,
  type RawMentionedRole,
} from '@tzurot/common-types/types/schemas/rawEnvelope';
import {
  rewriteChannelMentions,
  rewriteRoleMentions,
} from '@tzurot/common-types/utils/mentionRewriter';
import type { Guild } from 'discord.js';
import type {
  FullMentionResolutionResult,
  ResolvedChannel,
  ResolvedRole,
} from './MentionResolverTypes.js';

/**
 * Resolves Discord channel + role mentions to readable names (guild-cache only).
 */
export class MentionResolver {
  /**
   * Rewrite channel + role mentions in message content. User mentions (`<@id>`)
   * are left raw — the worker rewrites them to persona names from the envelope.
   *
   * @param content - Message content containing mentions
   * @param guild - Discord guild (for channel/role cache lookup); null in DMs
   */
  resolveAllMentions(content: string, guild: Guild | null): FullMentionResolutionResult {
    const channelResult = this.resolveChannelMentions(content, guild);
    const roleResult = this.resolveRoleMentions(channelResult.processedContent, guild);

    return {
      processedContent: roleResult.processedContent,
      mentionedChannels: channelResult.mentionedChannels,
      mentionedRoles: roleResult.mentionedRoles,
    };
  }

  /**
   * Resolve channel mentions in message content
   * Replaces <#channelId> with #channel-name
   *
   * @param content - Message content containing channel mentions
   * @param guild - Discord guild object (for channel lookup)
   * @returns Processed content and info about mentioned channels
   */
  resolveChannelMentions(
    content: string,
    guild: Guild | null
  ): { processedContent: string; mentionedChannels: ResolvedChannel[] } {
    return rewriteChannelMentions(content, (channelId): RawMentionedChannel | null => {
      const channel = guild?.channels.cache.get(channelId);
      if (channel === undefined || !('name' in channel)) {
        return null;
      }
      const resolved: RawMentionedChannel = {
        channelId,
        channelName: channel.name,
        guildId: guild?.id,
      };
      // Add topic if available (text channels have topics)
      if (
        'topic' in channel &&
        channel.topic !== undefined &&
        channel.topic !== null &&
        channel.topic.length > 0
      ) {
        resolved.topic = channel.topic;
      }
      return resolved;
    });
  }

  /**
   * Resolve role mentions in message content
   * Replaces <@&roleId> with @RoleName
   *
   * @param content - Message content containing role mentions
   * @param guild - Discord guild object (for role lookup)
   * @returns Processed content and info about mentioned roles
   */
  resolveRoleMentions(
    content: string,
    guild: Guild | null
  ): { processedContent: string; mentionedRoles: ResolvedRole[] } {
    return rewriteRoleMentions(content, (roleId): RawMentionedRole | null => {
      const role = guild?.roles.cache.get(roleId);
      if (role === undefined) {
        return null;
      }
      return {
        roleId,
        roleName: role.name,
        mentionable: role.mentionable,
      };
    });
  }
}
