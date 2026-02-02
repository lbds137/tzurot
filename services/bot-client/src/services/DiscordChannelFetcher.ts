/**
 * Discord Channel Fetcher
 *
 * Fetches recent messages from Discord channels for extended context.
 * Helper modules extracted to channelFetcher/ subdirectory.
 */

import type { Message, Collection } from 'discord.js';
import {
  createLogger,
  MessageRole,
  MESSAGE_LIMITS,
  ConversationSyncService,
} from '@tzurot/common-types';
import type {
  ConversationMessage,
  AttachmentMetadata,
  MessageReaction,
} from '@tzurot/common-types';
import { buildMessageContent, hasMessageContent } from '../utils/MessageContentBuilder.js';
import { isUserContentMessage } from '../utils/messageTypeUtils.js';
import { resolveHistoryLinks } from '../utils/HistoryLinkResolver.js';

import {
  isThinkingBlockMessage,
  isBotTranscriptReply,
} from './channelFetcher/messageTypeFilters.js';
import {
  extractGuildInfo,
  limitParticipants,
  collectReactorUsers as collectReactorUsersImpl,
} from './channelFetcher/ParticipantContextCollector.js';
import {
  processReactions,
  extractReactions as extractReactionsImpl,
} from './channelFetcher/ReactionProcessor.js';
import { mergeWithHistory } from './channelFetcher/HistoryMerger.js';
import {
  collateChunksForSync,
  contentsDiffer,
  getOldestTimestamp,
} from './channelFetcher/SyncValidator.js';

export type {
  ParticipantGuildInfo,
  ExtendedContextUser,
  FetchResult,
  FetchOptions,
  FetchableChannel,
  SyncResult,
} from './channelFetcher/types.js';

import type {
  ParticipantGuildInfo,
  ExtendedContextUser,
  FetchResult,
  FetchOptions,
  FetchableChannel,
  SyncResult,
} from './channelFetcher/types.js';

const logger = createLogger('DiscordChannelFetcher');

/** Extract personality display name from "DisplayName | Suffix" webhook format */
function extractPersonalityName(webhookName: string): string {
  const delimiterIndex = webhookName.indexOf(' | ');
  if (delimiterIndex > 0) {
    return webhookName.substring(0, delimiterIndex);
  }
  return webhookName;
}

/** Fetches and processes Discord channel messages for extended context */
export class DiscordChannelFetcher {
  /** Fetch recent messages from a Discord channel */
  async fetchRecentMessages(
    channel: FetchableChannel,
    options: FetchOptions
  ): Promise<FetchResult> {
    const limit = options.limit ?? MESSAGE_LIMITS.MAX_EXTENDED_CONTEXT;

    logger.debug(
      {
        channelId: channel.id,
        limit,
        before: options.before,
      },
      '[DiscordChannelFetcher] Fetching channel messages'
    );

    try {
      // Fetch messages from Discord API
      const fetchOptions: { limit: number; before?: string } = { limit };
      if (options.before !== undefined && options.before !== '') {
        fetchOptions.before = options.before;
      }

      const discordMessages = await channel.messages.fetch(fetchOptions);

      // Convert Collection to array for processing
      let messagesToProcess = [...discordMessages.values()];
      const shouldResolveLinks = options.resolveLinks !== false;

      if (shouldResolveLinks && messagesToProcess.length > 0) {
        const linkResult = await resolveHistoryLinks(messagesToProcess, {
          client: channel.client,
          budget: limit,
        });

        if (linkResult.resolvedCount > 0 || linkResult.trimmedCount > 0) {
          logger.debug(
            {
              channelId: channel.id,
              resolvedCount: linkResult.resolvedCount,
              failedCount: linkResult.failedCount,
              skippedCount: linkResult.skippedCount,
              trimmedCount: linkResult.trimmedCount,
            },
            '[DiscordChannelFetcher] History links resolved'
          );
        }

        messagesToProcess = linkResult.messages;
      }

      // Filter and convert messages (async for transcript retrieval)
      const processResult = await this.processMessages(messagesToProcess, options);

      const participantCount = Object.keys(processResult.participantGuildInfo).length;
      const userCount = processResult.extendedContextUsers.length;
      const reactorCount = processResult.reactorUsers.length;
      logger.info(
        {
          channelId: channel.id,
          fetchedCount: discordMessages.size,
          filteredCount: processResult.messages.length,
          imageAttachmentCount: processResult.imageAttachments.length,
          participantGuildInfoCount: participantCount,
          extendedContextUserCount: userCount,
          reactorUserCount: reactorCount,
        },
        '[DiscordChannelFetcher] Fetched and processed channel messages'
      );

      return {
        messages: processResult.messages,
        fetchedCount: discordMessages.size,
        filteredCount: processResult.messages.length,
        rawMessages: discordMessages, // For opportunistic sync
        imageAttachments:
          processResult.imageAttachments.length > 0 ? processResult.imageAttachments : undefined,
        participantGuildInfo: participantCount > 0 ? processResult.participantGuildInfo : undefined,
        extendedContextUsers: userCount > 0 ? processResult.extendedContextUsers : undefined,
        reactorUsers: reactorCount > 0 ? processResult.reactorUsers : undefined,
      };
    } catch (error) {
      logger.error(
        {
          channelId: channel.id,
          error: error instanceof Error ? error.message : String(error),
        },
        '[DiscordChannelFetcher] Failed to fetch channel messages'
      );

      // Return empty result on error (graceful degradation)
      return {
        messages: [],
        fetchedCount: 0,
        filteredCount: 0,
      };
    }
  }

  /**
   * Process and filter Discord messages
   */
  // eslint-disable-next-line complexity, max-lines-per-function, sonarjs/cognitive-complexity -- Cohesive message processing
  private async processMessages(
    messages: Message[],
    options: FetchOptions
  ): Promise<{
    messages: ConversationMessage[];
    imageAttachments: AttachmentMetadata[];
    participantGuildInfo: Record<string, ParticipantGuildInfo>;
    extendedContextUsers: ExtendedContextUser[];
    reactorUsers: ExtendedContextUser[];
  }> {
    const result: ConversationMessage[] = [];
    const collectedImageAttachments: AttachmentMetadata[] = [];
    const participantGuildInfo: Record<string, ParticipantGuildInfo> = {};
    const uniqueUsers = new Map<string, ExtendedContextUser>();
    const messageIdToIndex = new Map<string, number>();

    // Build fallback map: voiceMessageId → bot reply transcript
    const botTranscriptFallback = new Map<string, string>();
    for (const msg of messages) {
      if (isBotTranscriptReply(msg, options.botUserId)) {
        const voiceMessageId = msg.reference?.messageId;
        if (voiceMessageId !== undefined && msg.content.length > 0) {
          botTranscriptFallback.set(voiceMessageId, msg.content);
        }
      }
    }

    if (botTranscriptFallback.size > 0) {
      logger.debug(
        { count: botTranscriptFallback.size },
        '[DiscordChannelFetcher] Built bot transcript fallback map for voice messages'
      );
    }

    // Create wrapped getTranscript that tries DB first, then falls back to bot replies
    const getTranscriptWithFallback = async (
      discordMessageId: string,
      attachmentUrl: string
    ): Promise<string | null> => {
      if (options.getTranscript) {
        const dbTranscript = await options.getTranscript(discordMessageId, attachmentUrl);
        if (dbTranscript !== null && dbTranscript.length > 0) {
          return dbTranscript;
        }
      }
      const fallbackTranscript = botTranscriptFallback.get(discordMessageId);
      if (fallbackTranscript !== undefined) {
        logger.info(
          { messageId: discordMessageId },
          '[DiscordChannelFetcher] Using bot reply fallback for voice transcript (DB lookup failed)'
        );
        return fallbackTranscript;
      }
      return null;
    };

    // Sort by timestamp ascending (oldest first)
    const sortedMessages = [...messages].sort((a, b) => a.createdTimestamp - b.createdTimestamp);

    for (const msg of sortedMessages) {
      // Apply filters
      if (!isUserContentMessage(msg)) {
        continue;
      }
      if (!hasMessageContent(msg)) {
        continue;
      }
      if (isBotTranscriptReply(msg, options.botUserId)) {
        continue;
      }
      if (isThinkingBlockMessage(msg)) {
        continue;
      }
      if (options.contextEpoch !== undefined && msg.createdAt < options.contextEpoch) {
        continue;
      }
      if (options.maxAge !== undefined && options.maxAge !== null) {
        const cutoffTime = new Date(Date.now() - options.maxAge * 1000);
        if (msg.createdAt < cutoffTime) {
          continue;
        }
      }

      // Convert to ConversationMessage
      const conversionResult = await this.convertMessage(msg, {
        ...options,
        getTranscript: getTranscriptWithFallback,
      });

      if (conversionResult) {
        messageIdToIndex.set(msg.id, result.length);
        result.push(conversionResult.message);

        // Collect image attachments
        if (conversionResult.attachments.length > 0) {
          const images = conversionResult.attachments
            .filter(a => a.contentType?.startsWith('image/') && a.isVoiceMessage !== true)
            .map(img => ({ ...img, sourceDiscordMessageId: msg.id }));
          collectedImageAttachments.push(...images);
        }

        // Collect guild info for user participants
        const personaId = conversionResult.message.personaId;
        if (conversionResult.message.role === MessageRole.User && msg.member) {
          delete participantGuildInfo[personaId];
          participantGuildInfo[personaId] = extractGuildInfo(msg);
        }

        // Collect unique user info
        if (conversionResult.message.role === MessageRole.User) {
          const discordId = msg.author.id;
          if (!uniqueUsers.has(discordId)) {
            uniqueUsers.set(discordId, {
              discordId,
              username: msg.author.username,
              displayName: msg.member?.displayName ?? msg.author.globalName ?? undefined,
              isBot: msg.author.bot,
            });
          }
        }
      }
    }

    // Limit to most recent N participants
    const limitedParticipantGuildInfo = limitParticipants(participantGuildInfo);

    // Convert unique users map to array
    const extendedContextUsers = Array.from(uniqueUsers.values());

    // Extract reactions from recent messages and collect reactor users
    const existingUserIds = new Set(uniqueUsers.keys());
    const reactorUsers = await processReactions(
      sortedMessages,
      result,
      messageIdToIndex,
      existingUserIds
    );

    // Return messages in reverse order (newest first)
    return {
      messages: result.reverse(),
      imageAttachments: collectedImageAttachments,
      participantGuildInfo: limitedParticipantGuildInfo,
      extendedContextUsers,
      reactorUsers,
    };
  }

  /**
   * Convert a Discord message to ConversationMessage format
   */
  private async convertMessage(
    msg: Message,
    options: FetchOptions
  ): Promise<{ message: ConversationMessage; attachments: AttachmentMetadata[] } | null> {
    const isBot = msg.author.id === options.botUserId;
    const role = isBot ? MessageRole.Assistant : MessageRole.User;
    const authorName =
      msg.member?.displayName ?? msg.author.globalName ?? msg.author.username ?? 'Unknown';

    const {
      content: rawContent,
      isForwarded,
      attachments,
      embedsXml,
      voiceTranscripts,
    } = await buildMessageContent(msg, {
      includeEmbeds: true,
      includeAttachments: false,
      getTranscript: options.getTranscript,
    });

    const hasTextContent = rawContent !== undefined && rawContent.length > 0;
    const hasAttachments = attachments.length > 0;
    const hasVoiceTranscripts = voiceTranscripts !== undefined && voiceTranscripts.length > 0;
    const hasEmbeds = embedsXml !== undefined && embedsXml.length > 0;
    const hasProcessableContent =
      hasTextContent || hasAttachments || hasVoiceTranscripts || hasEmbeds || isForwarded;

    if (!hasProcessableContent) {
      return null;
    }

    const content = rawContent;
    const hasMetadata = embedsXml !== undefined || voiceTranscripts !== undefined;
    const messageMetadata = hasMetadata ? { embedsXml, voiceTranscripts } : undefined;

    const message: ConversationMessage = {
      id: msg.id,
      role,
      content,
      createdAt: msg.createdAt,
      personaId: role === MessageRole.User ? `discord:${msg.author.id}` : 'assistant',
      personaName: role === MessageRole.User ? authorName : undefined,
      discordUsername: msg.author.username,
      discordMessageId: [msg.id],
      isForwarded: isForwarded || undefined,
      messageMetadata,
      personalityName:
        role === MessageRole.Assistant ? extractPersonalityName(authorName) : undefined,
    };

    return { message, attachments };
  }

  /** Merge extended context with DB history - delegates to HistoryMerger */
  mergeWithHistory(
    extendedMessages: ConversationMessage[],
    dbHistory: ConversationMessage[]
  ): ConversationMessage[] {
    return mergeWithHistory(extendedMessages, dbHistory);
  }

  /** Perform opportunistic sync between Discord messages and database */
  // eslint-disable-next-line sonarjs/cognitive-complexity -- Sync logic has inherent complexity
  async syncWithDatabase(
    discordMessages: Collection<string, Message>,
    channelId: string,
    personalityId: string,
    conversationSync: ConversationSyncService
  ): Promise<SyncResult> {
    const result: SyncResult = { updated: 0, deleted: 0 };

    try {
      const discordMessageIds = [...discordMessages.keys()];
      if (discordMessageIds.length === 0) {
        return result;
      }

      const dbMessages = await conversationSync.getMessagesByDiscordIds(
        discordMessageIds,
        channelId,
        personalityId
      );

      if (dbMessages.size === 0) {
        logger.debug(
          { channelId, discordCount: discordMessageIds.length },
          '[DiscordChannelFetcher] No matching DB messages for sync'
        );
        return result;
      }

      // Check for edits - group Discord messages by their DB record first
      const dbRecordToChunks = new Map<
        string,
        { dbMsg: typeof dbMessages extends Map<string, infer V> ? V : never; chunks: Message[] }
      >();

      for (const [discordId, discordMsg] of discordMessages) {
        const dbMsg = dbMessages.get(discordId);
        if (dbMsg?.deletedAt === null) {
          const existing = dbRecordToChunks.get(dbMsg.id);
          if (existing) {
            existing.chunks.push(discordMsg);
          } else {
            dbRecordToChunks.set(dbMsg.id, { dbMsg, chunks: [discordMsg] });
          }
        }
      }

      // Process each unique DB record
      for (const [dbId, { dbMsg, chunks }] of dbRecordToChunks) {
        const collatedContent = collateChunksForSync(dbId, dbMsg, chunks);
        if (collatedContent === null) {
          continue;
        }

        if (contentsDiffer(collatedContent, dbMsg.content)) {
          const updated = await conversationSync.updateMessageContent(dbId, collatedContent);
          if (updated) {
            result.updated++;
            logger.debug(
              { messageId: dbId, chunkCount: chunks.length },
              '[DiscordChannelFetcher] Synced edited message'
            );
          }
        }
      }

      // Check for deletes
      const oldestDiscordTime = getOldestTimestamp(discordMessages);
      if (oldestDiscordTime) {
        const dbMessagesInWindow = await conversationSync.getMessagesInTimeWindow(
          channelId,
          personalityId,
          oldestDiscordTime
        );

        const discordIdSet = new Set(discordMessageIds);
        const deletedMessageIds: string[] = [];

        for (const dbMsg of dbMessagesInWindow) {
          const hasMatchingDiscordId = dbMsg.discordMessageId.some((id: string) =>
            discordIdSet.has(id)
          );
          if (!hasMatchingDiscordId) {
            deletedMessageIds.push(dbMsg.id);
          }
        }

        if (deletedMessageIds.length > 0) {
          const deleteCount = await conversationSync.softDeleteMessages(deletedMessageIds);
          result.deleted = deleteCount;
          logger.info(
            { channelId, deletedCount: deleteCount },
            '[DiscordChannelFetcher] Soft deleted messages not found in Discord'
          );
        }
      }

      if (result.updated > 0 || result.deleted > 0) {
        logger.info(
          { channelId, personalityId, updated: result.updated, deleted: result.deleted },
          '[DiscordChannelFetcher] Opportunistic sync completed'
        );
      }

      return result;
    } catch (error) {
      logger.error(
        { channelId, personalityId, error: error instanceof Error ? error.message : String(error) },
        '[DiscordChannelFetcher] Sync failed'
      );
      return result;
    }
  }

  /** Wrapper for backward compatibility - delegates to ReactionProcessor */
  extractReactions(msg: Message): Promise<MessageReaction[]> {
    return extractReactionsImpl(msg);
  }

  /** Wrapper for backward compatibility - delegates to ParticipantContextCollector */
  collectReactorUsers(
    reactions: MessageReaction[],
    existingUserIds: Set<string>
  ): ExtendedContextUser[] {
    return collectReactorUsersImpl(reactions, existingUserIds);
  }
}
