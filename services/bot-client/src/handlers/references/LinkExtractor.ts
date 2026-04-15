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
   * @param link - Parsed message link
   * @param sourceMessage - Original message (for guild access)
   * @returns Discord message or null if not accessible
   */
  // eslint-disable-next-line complexity, max-lines-per-function -- Discord API requires nested try-catch for guild→channel→message fetch chain with different error codes (10008, 50001, 50013). Extracting would obscure the sequential fetch flow and error handling context.
  async fetchMessageFromLink(
    link: ParsedMessageLink,
    sourceMessage: Message
  ): Promise<Message | null> {
    try {
      // Try to get guild from cache first
      let guild = sourceMessage.client.guilds.cache.get(link.guildId);

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

          guild = await sourceMessage.client.guilds.fetch(link.guildId);

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

          channel = await sourceMessage.client.channels.fetch(link.channelId);

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
      const invokerCanAccess = await this.verifyInvokerCanAccessSource(channel, sourceMessage);
      if (!invokerCanAccess) {
        logger.debug(
          {
            messageId: link.messageId,
            channelId: link.channelId,
            guildId: link.guildId,
            invokerId: sourceMessage.author.id,
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
   * Verify the invoking user (author of sourceMessage) has access to the
   * source channel of a message link, not just the bot.
   *
   * Without this check, the bot's credentials would let anyone expand a
   * message link from a channel they cannot see, leaking private content
   * into the AI reply via conversation-context assembly.
   *
   * Decision tree:
   * - **DM source**: allowed iff the invoker is one of the DM participants.
   *   DMs have no roles/permissions; the participant set is the access set.
   *   Covers the legitimate "I want to reference my own DM with the bot
   *   somewhere else" case.
   * - **Guild source**: fetch the invoker's member record for the SOURCE
   *   guild (which may differ from where they're invoking from). If the
   *   invoker isn't a member of the source guild, deny. If they are, check
   *   `permissionsFor(sourceMember).has(ViewChannel | ReadMessageHistory)`.
   * - **Thread source**: threads inherit permissions from their parent, BUT
   *   private threads require explicit access that `ViewChannel` on parent
   *   does not imply. For private threads we additionally verify the user
   *   can view the thread itself via `threadMembers.fetch()` presence (a
   *   private thread has an explicit member list).
   *
   * **Fail closed**: if any lookup returns null/undefined unexpectedly (e.g.,
   * member fetch rejects, thread membership fetch throws), deny access.
   *
   * @returns true if the invoker can access the source channel
   */
  private async verifyInvokerCanAccessSource(
    channel: Channel,
    sourceMessage: Message
  ): Promise<boolean> {
    try {
      const invokerId = sourceMessage.author.id;

      // DM case — check DM participant.
      // Bots cannot participate in Group DMs (Discord restriction), so a bot's
      // DM channel is always 1-on-1 (`DMChannel` with a single `recipientId`,
      // never a `PartialGroupDMChannel`). The invoker is either THE recipient
      // or not — there's no third option we need to worry about.
      if (channel.isDMBased()) {
        const dmChannel = channel as DMChannel;
        return dmChannel.recipientId === invokerId;
      }

      // Guild case — invoker must be a member of the SOURCE guild (which may
      // differ from sourceMessage.guild if this is a cross-guild link)
      if (!('guild' in channel) || channel.guild === null || channel.guild === undefined) {
        // Text-based but not a DM and no guild — unexpected. Fail closed.
        return false;
      }

      const sourceGuild = channel.guild;
      // Explicit type: `members.fetch(id)` returns `Promise<GuildMember>`, but
      // the no-args overload returns `Promise<Collection<string, GuildMember>>`.
      // Annotating prevents a future refactor of the fetch call from silently
      // widening the type through either overload.
      let sourceMember: GuildMember | undefined;
      try {
        // `fetch` with cache preference — returns cached member or falls back
        // to API call. Throws if the user isn't in the guild.
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
        // Private threads have an explicit member list; public and announcement
        // threads inherit parent-channel access.
        const isPrivateThread = thread.type === ChannelType.PrivateThread;
        if (isPrivateThread) {
          try {
            const threadMember = await thread.members.fetch(invokerId);
            return threadMember !== null && threadMember !== undefined;
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
        { err: error, invokerId: sourceMessage.author.id, channelId: channel.id },
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
