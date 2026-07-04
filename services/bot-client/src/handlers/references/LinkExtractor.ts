/**
 * Link Extractor
 *
 * Extracts referenced messages from Discord message links
 */

import {
  type Message,
  type Channel,
  type TextChannel,
  type ThreadChannel,
  type DMChannel,
  type NewsChannel,
  type GuildMember,
  ChannelType,
  PermissionsBitField,
} from 'discord.js';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { type ParsedMessageLink } from '@tzurot/common-types/utils/messageLinkParser';

const logger = createLogger('LinkExtractor');

/**
 * Service for extracting referenced messages from Discord message links
 */
export class LinkExtractor {
  /**
   * Fetch a message from a parsed Discord link
   * @param link - Parsed message link (the link being expanded)
   * @param invokingMessage - Message that contains the link (its author is
   *   the user whose access is being verified). Named to disambiguate from
   *   the linked-to message, which is what this method FETCHES.
   * @returns Discord message or null if not accessible
   */
  async fetchMessageFromLink(
    link: ParsedMessageLink,
    invokingMessage: Message
  ): Promise<Message | null> {
    try {
      // Resolve the source channel. DM links (`guildId === null`) skip the guild
      // fetch — DM channels don't belong to any guild. The downstream access check
      // (`verifyInvokerCanAccessSource` → `channel.isDMBased()` branch) verifies
      // the invoking user is THE recipient of that DM, so a user can't paste
      // someone else's DM link and have it expanded.
      let channel = await this.resolveSourceChannel(link, invokingMessage);

      // If not in channels cache, it might be a thread - fetch it
      if (!channel) {
        try {
          logger.debug(
            {
              channelId: link.channelId,
              messageId: link.messageId,
            },
            'Channel not in cache, fetching...'
          );

          channel = await invokingMessage.client.channels.fetch(link.channelId);

          logger.debug(
            {
              channelId: link.channelId,
              channelType: channel?.type,
              isThread: (channel?.isThread?.() ?? false) === true,
            },
            'Channel fetched successfully'
          );
        } catch (fetchError) {
          logger.warn(
            {
              err: fetchError,
              channelId: link.channelId,
              messageId: link.messageId,
            },
            'Failed to fetch channel'
          );
          return null;
        }
      }

      if (!channel || !this.isTextBasedChannel(channel)) {
        logger.info(
          {
            channelId: link.channelId,
            hasChannel: channel !== null && channel !== undefined,
            isTextBased: (channel?.isTextBased?.() ?? false) === true,
            hasMessages: channel !== null && channel !== undefined && 'messages' in channel,
          },
          '[LinkExtractor] Channel not text-based or inaccessible'
        );
        return null;
      }

      // SECURITY: verify the invoking user (not just the bot) has access to the
      // source channel before fetching. Without this check, the bot's credentials
      // would let anyone expand a message link from a channel they cannot see,
      // leaking private content into the AI reply via context assembly.
      // See docs/reference/architecture/epic-identity-hardening.md.
      const invokerCanAccess = await this.verifyInvokerCanAccessSource(channel, invokingMessage);
      if (!invokerCanAccess) {
        // Access denial is a security event — log at info so it surfaces in
        // production logs for probe/abuse detection (e.g., "is someone
        // pasting staff-channel links hoping the bot will expand them?").
        logger.info(
          {
            messageId: link.messageId,
            channelId: link.channelId,
            guildId: link.guildId,
            invokerId: invokingMessage.author.id,
          },
          'Invoking user lacks access to source channel — skipping expansion'
        );
        return null;
      }

      // All four channel types resolved upstream expose `.messages.fetch()`.
      // NewsChannel is included because Discord announcement channels are text-based
      // and pass `isTextBasedChannel()`, even if uncommon in practice.
      const fetchedMessage = await (
        channel as TextChannel | ThreadChannel | DMChannel | NewsChannel
      ).messages.fetch(link.messageId);

      logger.info(
        {
          messageId: link.messageId,
          channelId: link.channelId,
          author: fetchedMessage.author.username,
        },
        'Successfully fetched message from link'
      );

      return fetchedMessage;
    } catch (error) {
      // Differentiate between expected and unexpected errors
      const discordError = error as Error & { code?: number };
      const errorCode = discordError.code;

      if (errorCode === 10008) {
        // Unknown Message - deleted or never existed (expected)
        logger.debug({ messageId: link.messageId }, 'Message not found (deleted or inaccessible)');
      } else if (errorCode === 50001 || errorCode === 50013) {
        // Missing Access / Missing Permissions (expected)
        logger.debug({ messageId: link.messageId }, 'No permission to access message');
      } else {
        // Unexpected error - log at WARN level for investigation
        logger.warn(
          {
            err: error,
            messageId: link.messageId,
            guildId: link.guildId,
            channelId: link.channelId,
          },
          'Unexpected error fetching message from link'
        );
      }
      return null;
    }
  }

  /**
   * Resolve the source channel for a parsed link, handling DM links separately
   * from guild links. Returns null if the bot can't reach the channel/guild.
   *
   * Guild path: returns the cached channel (may be undefined if not in cache —
   * the caller's thread-fetch fallback handles that case via
   * `client.channels.fetch`, which also resolves threads).
   *
   * DM path: returns the result of `client.channels.fetch(channelId)` directly
   * (or null on error). The caller's thread-fetch fallback is a no-op retry
   * for this path — DM channels aren't threads, so a successful fetch yields a
   * non-null channel and the fallback is skipped; a failed fetch already logged
   * and returned null here, so the fallback's retry just produces the same
   * failure.
   */
  private async resolveSourceChannel(
    link: ParsedMessageLink,
    invokingMessage: Message
  ): Promise<Channel | null> {
    if (link.guildId === null) {
      try {
        return await invokingMessage.client.channels.fetch(link.channelId);
      } catch (fetchError) {
        logger.info(
          { channelId: link.channelId, messageId: link.messageId, err: fetchError },
          'DM channel not accessible for message link'
        );
        return null;
      }
    }

    let guild = invokingMessage.client.guilds.cache.get(link.guildId);
    if (!guild) {
      try {
        logger.debug(
          { guildId: link.guildId, messageId: link.messageId },
          'Guild not in cache, attempting fetch...'
        );
        guild = await invokingMessage.client.guilds.fetch(link.guildId);
        logger.info({ guildId: link.guildId, guildName: guild.name }, 'Successfully fetched guild');
      } catch (fetchError) {
        logger.info(
          { guildId: link.guildId, messageId: link.messageId, err: fetchError },
          'Guild not accessible for message link'
        );
        return null;
      }
    }
    return guild.channels.cache.get(link.channelId) ?? null;
  }

  /**
   * Check if channel is text-based and supports message fetching
   * @param channel - Discord channel
   * @returns True if channel is text-based
   */
  private isTextBasedChannel(channel: Channel | null): boolean {
    return channel !== null && channel.isTextBased() && 'messages' in channel;
  }

  /**
   * Verify the invoking user (author of `invokingMessage`) has access to
   * the channel that the link points at, not just the bot.
   *
   * Without this check, the bot's credentials would let anyone expand a
   * message link from a channel they cannot see, leaking private content
   * into the AI reply via conversation-context assembly.
   *
   * Decision tree:
   * - **DM link target**: allowed iff the invoker is the DM participant.
   *   DMs have no roles/permissions; the participant set is the access set.
   *   Covers the legitimate "I want to reference my own DM with the bot
   *   somewhere else" case.
   * - **Guild link target**: fetch the invoker's member record for the
   *   TARGET guild (which may differ from where they're invoking from —
   *   cross-guild link case). If the invoker isn't a member of the target
   *   guild, deny. If they are, check `permissionsFor(member).has(ViewChannel,
   *   ReadMessageHistory)` on the target channel.
   * - **Thread target**: threads inherit permissions from their parent,
   *   BUT private threads require explicit membership that `ViewChannel`
   *   on the parent does not imply. For private threads we additionally
   *   verify the user is in the thread's member list via `thread.members.fetch()`.
   *
   * **Fail closed**: if any lookup returns null/undefined unexpectedly
   * (e.g., member fetch rejects, thread membership fetch throws), deny.
   *
   * @param channel - The channel the link points at (NOT the invoking channel)
   * @param invokingMessage - The message containing the link. Its author is
   *   the user whose access is being verified.
   * @returns true if the invoker can access the channel the link points at
   */
  private async verifyInvokerCanAccessSource(
    channel: Channel,
    invokingMessage: Message
  ): Promise<boolean> {
    try {
      const invokerId = invokingMessage.author.id;

      // DM case — check DM participant.
      // Bots cannot participate in Group DMs (Discord restriction), so a bot's
      // DM channel is always 1-on-1 (`DMChannel` with a single `recipientId`,
      // never a `PartialGroupDMChannel`). The invoker is either THE recipient
      // or not — there's no third option we need to worry about.
      //
      // This is the primary access-verification path for DM-format links
      // (`/channels/@me/...`): `MessageLinkParser` parses such URLs with
      // `guildId: null`, `resolveSourceChannel` fetches the DM channel
      // directly, and execution lands here. The participant check enforces
      // that a user can only resolve DM links to DMs they themselves are in
      // — they can't paste another user's DM link and have it expanded.
      if (channel.isDMBased()) {
        const dmChannel = channel as DMChannel;
        return dmChannel.recipientId === invokerId;
      }

      // Guild case — invoker must be a member of the TARGET guild (which may
      // differ from invokingMessage.guild if this is a cross-guild link).
      // The `'guild' in channel` + null checks also serve to narrow `channel`
      // from the broad `Channel` type to a guild-channel variant so that
      // `channel.permissionsFor()` below is type-safe to call.
      if (!('guild' in channel) || channel.guild === null || channel.guild === undefined) {
        // Text-based but not a DM and no guild — unexpected. Fail closed.
        return false;
      }

      const sourceGuild = channel.guild;
      // Explicit type: `members.fetch(id)` returns `Promise<GuildMember>`, but
      // the no-args overload returns `Promise<Collection<string, GuildMember>>`.
      // Annotating prevents a future refactor of the fetch call from silently
      // widening the type through either overload. The diverging catch below
      // lets CFA narrow out the uninitialized case — no `| undefined` needed.
      let sourceMember: GuildMember;
      try {
        // Discord.js's single-ID `members.fetch(id)` is cache-first: it
        // returns the cached member without an API call when available, and
        // only falls back to `GET /guilds/{id}/members/{id}` on a miss.
        // With the `GuildMembers` intent enabled (see services/bot-client/src/index.ts),
        // `MESSAGE_CREATE` payloads auto-cache the message author on receipt,
        // so the invoker is typically cached for same-guild lookups. Cross-
        // guild lookups may incur one API call on first access, then cached.
        // Throws if the user isn't in the guild (caught → deny below).
        sourceMember = await sourceGuild.members.fetch(invokerId);
      } catch {
        // Invoker isn't a member of the source guild. Deny.
        return false;
      }

      // Check base channel permissions
      const permissions = channel.permissionsFor(sourceMember);
      if (permissions === null) {
        // Rare: permission calculation failed. Fail closed.
        return false;
      }
      const hasBaseAccess = permissions.has([
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.ReadMessageHistory,
      ]);
      if (!hasBaseAccess) {
        return false;
      }

      // Thread case — additionally verify private-thread membership.
      // Public threads inherit parent perms; private threads have an explicit
      // member list that `ViewChannel` on parent does NOT imply.
      if (channel.isThread()) {
        const thread = channel as ThreadChannel;
        // Private threads (type 12) have an explicit member list that
        // `ViewChannel` on the parent does NOT imply — they need the extra
        // check below. Public threads (type 11) and announcement threads
        // (type 10) inherit parent-channel access, so the base permission
        // check is sufficient and we skip the thread-membership lookup.
        const isPrivateThread = thread.type === ChannelType.PrivateThread;
        if (isPrivateThread) {
          try {
            // `thread.members.fetch(id)` throws if the user isn't a thread
            // member — it never returns null/undefined — so reaching the
            // line after the await is itself proof of membership.
            await thread.members.fetch(invokerId);
            return true;
          } catch {
            // Not a thread member. Deny.
            return false;
          }
        }
      }

      return true;
    } catch (error) {
      // Catch-all: any unexpected error during permission checks fails closed.
      logger.warn(
        { err: error, invokerId: invokingMessage.author.id, channelId: channel.id },
        'Unexpected error during access check — failing closed'
      );
      return false;
    }
  }
}
