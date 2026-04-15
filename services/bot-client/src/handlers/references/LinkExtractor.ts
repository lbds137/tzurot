/**
 * Link Extractor
 *
 * Extracts referenced messages from Discord message links
 */

import type {
  Message,
  Channel,
  TextChannel,
  ThreadChannel,
  DMChannel,
  GuildMember,
} from 'discord.js';
import { ChannelType, PermissionsBitField } from 'discord.js';
import { createLogger, INTERVALS } from '@tzurot/common-types';
import type { ReferencedMessage } from '@tzurot/common-types';
import { MessageLinkParser, type ParsedMessageLink } from '../../utils/MessageLinkParser.js';
import { MessageFormatter } from './MessageFormatter.js';
import { SnapshotFormatter } from './SnapshotFormatter.js';
import { isForwardedMessage } from './types.js';

const logger = createLogger('LinkExtractor');

/**
 * Service for extracting referenced messages from Discord message links
 */
export class LinkExtractor {
  constructor(
    private readonly messageFormatter: MessageFormatter,
    private readonly snapshotFormatter: SnapshotFormatter
  ) {}

  /**
   * Extract referenced messages from Discord message links in content
   * @param message - Source message containing links
   * @param extractedMessageIds - Set of already-extracted message IDs (from reply) to prevent duplicates
   * @param conversationHistoryMessageIds - Set of message IDs already in conversation history
   * @param conversationHistoryTimestamps - Timestamps of messages in conversation history
   * @param startNumber - Starting reference number
   * @returns Array of referenced messages and map of link URLs to reference numbers
   */
  // eslint-disable-next-line sonarjs/cognitive-complexity -- Link parsing with cross-guild fetch, deduplication, timestamp proximity checks, and error recovery per link
  async extractLinkReferences(
    message: Message,
    extractedMessageIds: Set<string>,
    conversationHistoryMessageIds: Set<string>,
    conversationHistoryTimestamps: Date[],
    startNumber: number
  ): Promise<[ReferencedMessage[], Map<string, number>]> {
    const links = MessageLinkParser.parseMessageLinks(message.content);
    const references: ReferencedMessage[] = [];
    const linkMap = new Map<string, number>(); // Map Discord URL to reference number

    let currentNumber = startNumber;

    for (const link of links) {
      const referencedMessage = await this.fetchMessageFromLink(link, message);
      if (referencedMessage) {
        // Skip if this exact message was already extracted (e.g., from reply)
        if (extractedMessageIds.has(referencedMessage.id)) {
          logger.debug(
            `[LinkExtractor] Skipping duplicate link reference ${referencedMessage.id} - already extracted from reply`
          );
          continue;
        }

        // Skip if message is already in conversation history
        if (
          !this.shouldIncludeReference(
            referencedMessage,
            conversationHistoryMessageIds,
            conversationHistoryTimestamps
          )
        ) {
          logger.debug(
            `[LinkExtractor] Skipping link reference ${referencedMessage.id} - already in conversation history`
          );
          continue;
        }

        // Check if this is a forwarded message with snapshots
        if (isForwardedMessage(referencedMessage)) {
          // Extract each snapshot from the forward
          for (const snapshot of referencedMessage.messageSnapshots.values()) {
            const snapshotReference = this.snapshotFormatter.formatSnapshot(
              snapshot,
              currentNumber,
              referencedMessage
            );
            references.push(snapshotReference);
            linkMap.set(link.fullUrl, currentNumber);
            currentNumber++;

            logger.info(
              {
                messageId: referencedMessage.id,
                snapshotContent: snapshot.content?.substring(0, 50),
                referenceNumber: currentNumber - 1,
              },
              '[LinkExtractor] Added snapshot from linked forward'
            );
          }

          extractedMessageIds.add(referencedMessage.id);
        } else {
          // Regular message (not a forward)
          references.push(
            await this.messageFormatter.formatMessage(referencedMessage, currentNumber)
          );
          linkMap.set(link.fullUrl, currentNumber);
          extractedMessageIds.add(referencedMessage.id);
          currentNumber++;
        }
      }
    }

    return [references, linkMap];
  }

  /**
   * Fetch a message from a parsed Discord link
   * @param link - Parsed message link (the link being expanded)
   * @param invokingMessage - Message that contains the link (its author is
   *   the user whose access is being verified). Named to disambiguate from
   *   the linked-to message, which is what this method FETCHES.
   * @returns Discord message or null if not accessible
   */
  // eslint-disable-next-line complexity, max-lines-per-function -- Discord API requires nested try-catch for guild→channel→message fetch chain with different error codes (10008, 50001, 50013). Extracting would obscure the sequential fetch flow and error handling context.
  async fetchMessageFromLink(
    link: ParsedMessageLink,
    invokingMessage: Message
  ): Promise<Message | null> {
    try {
      // Try to get guild from cache first
      let guild = invokingMessage.client.guilds.cache.get(link.guildId);

      // If not in cache, try to fetch it (bot might be in the guild but it's not cached)
      if (!guild) {
        try {
          logger.debug(
            {
              guildId: link.guildId,
              messageId: link.messageId,
            },
            '[LinkExtractor] Guild not in cache, attempting fetch...'
          );

          guild = await invokingMessage.client.guilds.fetch(link.guildId);

          logger.info(
            {
              guildId: link.guildId,
              guildName: guild.name,
            },
            '[LinkExtractor] Successfully fetched guild'
          );
        } catch (fetchError) {
          logger.info(
            {
              guildId: link.guildId,
              messageId: link.messageId,
              err: fetchError,
            },
            '[LinkExtractor] Guild not accessible for message link'
          );
          return null;
        }
      }

      // Try to get channel from cache first (works for regular channels)
      let channel: Channel | null = guild.channels.cache.get(link.channelId) ?? null;

      // If not in channels cache, it might be a thread - fetch it
      if (!channel) {
        try {
          logger.debug(
            {
              channelId: link.channelId,
              messageId: link.messageId,
            },
            '[LinkExtractor] Channel not in cache, fetching...'
          );

          channel = await invokingMessage.client.channels.fetch(link.channelId);

          logger.debug(
            {
              channelId: link.channelId,
              channelType: channel?.type,
              isThread: (channel?.isThread?.() ?? false) === true,
            },
            '[LinkExtractor] Channel fetched successfully'
          );
        } catch (fetchError) {
          logger.warn(
            {
              err: fetchError,
              channelId: link.channelId,
              messageId: link.messageId,
            },
            '[LinkExtractor] Failed to fetch channel'
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
      // Phase 2 of the Identity & Provisioning Hardening epic — see
      // docs/reference/architecture/epic-identity-hardening.md.
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
          '[LinkExtractor] Invoking user lacks access to source channel — skipping expansion'
        );
        return null;
      }

      const fetchedMessage = await (channel as TextChannel | ThreadChannel).messages.fetch(
        link.messageId
      );

      logger.info(
        {
          messageId: link.messageId,
          channelId: link.channelId,
          author: fetchedMessage.author.username,
        },
        '[LinkExtractor] Successfully fetched message from link'
      );

      return fetchedMessage;
    } catch (error) {
      // Differentiate between expected and unexpected errors
      const discordError = error as Error & { code?: number };
      const errorCode = discordError.code;

      if (errorCode === 10008) {
        // Unknown Message - deleted or never existed (expected)
        logger.debug(
          `[LinkExtractor] Message ${link.messageId} not found (deleted or inaccessible)`
        );
      } else if (errorCode === 50001 || errorCode === 50013) {
        // Missing Access / Missing Permissions (expected)
        logger.debug(`[LinkExtractor] No permission to access message ${link.messageId}`);
      } else {
        // Unexpected error - log at WARN level for investigation
        logger.warn(
          {
            err: error,
            messageId: link.messageId,
            guildId: link.guildId,
            channelId: link.channelId,
          },
          '[LinkExtractor] Unexpected error fetching message from link'
        );
      }
      return null;
    }
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
      // Note: `MessageLinkParser.MESSAGE_LINK_REGEX` requires `\d+` for the
      // guild segment, so DM-format links (`/channels/@me/...`) are pre-
      // filtered and never reach this method through normal user input. This
      // branch is defensive for edge cases where a DM channel could be
      // resolved via `client.channels.fetch()` fallback on a guild-format
      // link that happens to reference a DM channel ID.
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
        '[LinkExtractor] Unexpected error during access check — failing closed'
      );
      return false;
    }
  }

  /**
   * Check if a referenced message should be included
   * @param message - Discord message
   * @param conversationHistoryMessageIds - Set of message IDs in conversation history
   * @param conversationHistoryTimestamps - Timestamps of messages in conversation history
   * @returns True if message should be included
   */
  private shouldIncludeReference(
    message: Message,
    conversationHistoryMessageIds: Set<string>,
    conversationHistoryTimestamps: Date[]
  ): boolean {
    // Exact match: Check if Discord message ID is in conversation history
    if (conversationHistoryMessageIds.has(message.id)) {
      logger.info(
        {
          messageId: message.id,
          author: message.author.username,
          reason: 'exact Discord ID match',
        },
        '[LinkExtractor] Excluding reference - found in conversation history'
      );
      return false; // Exclude - already in conversation history
    }

    // Time-based fallback: If message is from bot/webhook and very recent,
    // check if timestamp matches any message in conversation history
    // This handles race condition where Discord message ID hasn't been stored in DB yet
    // Common with voice messages in threads where transcription adds significant delay
    if (
      (message.webhookId !== undefined &&
        message.webhookId !== null &&
        message.webhookId.length > 0) ||
      message.author.bot === true
    ) {
      const messageTime = message.createdAt.getTime();
      const now = Date.now();
      const ageMs = now - messageTime;

      // Only check recent messages (within last 60 seconds)
      // Voice messages with transcription can have longer processing windows
      if (ageMs < INTERVALS.MESSAGE_AGE_DEDUP_WINDOW) {
        for (const historyTimestamp of conversationHistoryTimestamps) {
          const historyTime = historyTimestamp.getTime();
          const timeDiff = Math.abs(messageTime - historyTime);

          // If timestamps match within 15 seconds, likely the same message
          // Generous tolerance accounts for:
          // - Voice transcription delays (several seconds)
          // - DB round-trip and transaction commit times
          // - Job queue processing delays
          if (timeDiff < INTERVALS.MESSAGE_TIMESTAMP_TOLERANCE) {
            logger.info(
              {
                messageId: message.id,
                author: message.author.username,
                reason: 'timestamp match with conversation history',
                messageAge: `${Math.round(ageMs / 1000)}s ago`,
                timeDiff: `${timeDiff}ms`,
              },
              '[LinkExtractor] Excluding reference - timestamp matches conversation history (time-based fallback)'
            );
            return false; // Exclude - timestamp matches recent conversation history
          }
        }
      }
    }

    logger.info(
      {
        messageId: message.id,
        author: message.author.username,
        isWebhook:
          message.webhookId !== undefined &&
          message.webhookId !== null &&
          message.webhookId.length > 0,
        isBot: message.author.bot,
        messageAge:
          message.createdAt !== undefined && message.createdAt !== null
            ? `${Math.round((Date.now() - message.createdAt.getTime()) / 1000)}s`
            : 'unknown',
        historyIdsCount: conversationHistoryMessageIds.size,
        historyTimestampsCount: conversationHistoryTimestamps.length,
      },
      '[LinkExtractor] Including reference - not found in conversation history (deduplication failed)'
    );

    return true; // Include - not found in conversation history
  }
}
