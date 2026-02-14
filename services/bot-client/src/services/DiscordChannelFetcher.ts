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
  DISCORD_ID_PREFIX,
  ConversationSyncService,
} from '@tzurot/common-types';
import type {
  ConversationMessage,
  AttachmentMetadata,
  MessageReaction,
  StoredReferencedMessage,
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
import { executeDatabaseSync } from './channelFetcher/SyncExecutor.js';

export type { FetchableChannel } from './channelFetcher/types.js';

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
      let resolvedReferences: Map<string, StoredReferencedMessage[]> | undefined;
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
        resolvedReferences = linkResult.resolvedReferences;
      }

      // Filter and convert messages (async for transcript retrieval)
      const processResult = await this.processMessages(
        messagesToProcess,
        options,
        resolvedReferences
      );

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
  // eslint-disable-next-line complexity, max-lines-per-function, max-statements, sonarjs/cognitive-complexity -- Cohesive message processing pipeline with sequential filters, voice transcript fallback, and participant collection
  private async processMessages(
    messages: Message[],
    options: FetchOptions,
    resolvedReferences?: Map<string, StoredReferencedMessage[]>
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
      if (!hasMessageContent(msg) && resolvedReferences?.has(msg.id) !== true) {
        continue;
      }
      if (isBotTranscriptReply(msg, options.botUserId)) {
        continue;
      }
      if (isThinkingBlockMessage(msg)) {
        continue;
      }
      // Filter BLOCK-denied users from extended context
      if (options.isBlockDenied?.(msg.author.id) === true) {
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
      const conversionResult = await this.convertMessage(
        msg,
        { ...options, getTranscript: getTranscriptWithFallback },
        resolvedReferences
      );

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
  // eslint-disable-next-line complexity -- Message type conversion branches for role detection, content building, attachment handling, reference resolution, and forwarded message extraction
  private async convertMessage(
    msg: Message,
    options: FetchOptions,
    resolvedReferences?: Map<string, StoredReferencedMessage[]>
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
    const hasLinkedRefs = resolvedReferences?.has(msg.id) === true;
    const hasProcessableContent =
      hasTextContent ||
      hasAttachments ||
      hasVoiceTranscripts ||
      hasEmbeds ||
      isForwarded ||
      hasLinkedRefs;

    if (!hasProcessableContent) {
      return null;
    }

    const content = rawContent;
    const hasMetadata = embedsXml !== undefined || voiceTranscripts !== undefined;
    let messageMetadata: ConversationMessage['messageMetadata'] = hasMetadata
      ? { embedsXml, voiceTranscripts }
      : undefined;

    // Store forwarded attachment descriptions as fallback for when vision isn't available
    if (isForwarded && attachments.length > 0) {
      const imageLines = attachments
        .filter(a => a.contentType?.startsWith('image/'))
        .map(a => `[${a.contentType}: ${a.name ?? 'image'}]`);
      if (imageLines.length > 0) {
        messageMetadata = messageMetadata ?? {};
        messageMetadata.forwardedAttachmentLines = imageLines;
      }
    }

    // Merge resolved link references into messageMetadata
    const linkedRefs = resolvedReferences?.get(msg.id);
    if (linkedRefs !== undefined && linkedRefs.length > 0) {
      messageMetadata = messageMetadata ?? {};
      messageMetadata.referencedMessages = [
        ...(messageMetadata.referencedMessages ?? []),
        ...linkedRefs,
      ];
    }

    const message: ConversationMessage = {
      id: msg.id,
      role,
      content,
      createdAt: msg.createdAt,
      personaId: role === MessageRole.User ? `${DISCORD_ID_PREFIX}${msg.author.id}` : 'assistant',
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
  async syncWithDatabase(
    discordMessages: Collection<string, Message>,
    channelId: string,
    personalityId: string,
    conversationSync: ConversationSyncService
  ): Promise<SyncResult> {
    return executeDatabaseSync(discordMessages, channelId, personalityId, conversationSync);
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
