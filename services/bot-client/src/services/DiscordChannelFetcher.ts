/**
 * Discord Channel Fetcher
 *
 * Fetches recent messages from Discord channels for extended context.
 * Helper modules extracted to channelFetcher/ subdirectory.
 */

import type { Message, Collection } from 'discord.js';
import { MessageRole, MESSAGE_LIMITS } from '@tzurot/common-types/constants/message';
import { INTERNAL_DISCORD_ID_PREFIX } from '@tzurot/common-types/constants/personaId';
import { computeHistoryCutoff } from '@tzurot/common-types/services/historyCutoff';
import { type ConversationMessage } from '@tzurot/common-types/types/conversationMessage';
import { type AttachmentMetadata } from '@tzurot/common-types/types/schemas/discord';
import {
  type MessageReaction,
  type StoredReferencedMessage,
} from '@tzurot/common-types/types/schemas/message';
import {
  normalizeMessageForContext,
  extractMessagePrefixName,
} from '@tzurot/common-types/utils/discord';
import { mergeWithHistory } from '@tzurot/common-types/utils/historyMerger';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { buildMessageContent, hasMessageContent } from '../utils/MessageContentBuilder.js';
import { isUserContentMessage } from '../utils/messageTypeUtils.js';
import { collectExtendedContextAttachments } from './channelFetcher/extendedContextAttachmentCollector.js';
import { resolveHistoryLinks } from '../utils/HistoryLinkResolver.js';
import { extractPersonalityName, stripBotSuffix } from '../utils/webhookNaming.js';

import {
  isBotTranscriptReply,
  isContextExcludedBotMessage,
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
      'Fetching channel messages'
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
            'History links resolved'
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
          keptCount: processResult.messages.length,
          imageAttachmentCount: processResult.imageAttachments.length,
          participantGuildInfoCount: participantCount,
          extendedContextUserCount: userCount,
          reactorUserCount: reactorCount,
        },
        'Fetched and processed channel messages'
      );

      return {
        messages: processResult.messages,
        fetchedCount: discordMessages.size,
        keptCount: processResult.messages.length,
        rawMessages: discordMessages, // For opportunistic sync
        imageAttachments:
          processResult.imageAttachments.length > 0 ? processResult.imageAttachments : undefined,
        voiceAttachments:
          processResult.voiceAttachments.length > 0 ? processResult.voiceAttachments : undefined,
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
        'Failed to fetch channel messages'
      );

      // Return empty result on error (graceful degradation)
      return {
        messages: [],
        fetchedCount: 0,
        keptCount: 0,
      };
    }
  }

  /**
   * Process and filter Discord messages
   */
  // eslint-disable-next-line complexity, max-lines-per-function, sonarjs/cognitive-complexity -- Cohesive message processing pipeline with sequential filters, voice transcript fallback, and participant collection
  private async processMessages(
    messages: Message[],
    options: FetchOptions,
    resolvedReferences?: Map<string, StoredReferencedMessage[]>
  ): Promise<{
    messages: ConversationMessage[];
    imageAttachments: AttachmentMetadata[];
    voiceAttachments: AttachmentMetadata[];
    participantGuildInfo: Record<string, ParticipantGuildInfo>;
    extendedContextUsers: ExtendedContextUser[];
    reactorUsers: ExtendedContextUser[];
  }> {
    const result: ConversationMessage[] = [];
    const collectedImageAttachments: AttachmentMetadata[] = [];
    const collectedVoiceAttachments: AttachmentMetadata[] = [];
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
        'Built bot transcript fallback map for voice messages'
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
          'Using bot reply fallback for voice transcript (DB lookup failed)'
        );
        return fallbackTranscript;
      }
      return null;
    };

    // Sort by timestamp ascending (oldest first)
    const sortedMessages = [...messages].sort((a, b) => a.createdTimestamp - b.createdTimestamp);

    // Single source of truth for the time-cutoff semantic, shared with the
    // Prisma queries in ConversationHistoryService. Computed once outside the
    // loop so a 200-message extended context doesn't re-compute Date.now() per
    // iteration. `null` maxAge collapses to undefined (no filter).
    const historyCutoff = computeHistoryCutoff(options.maxAge, options.contextEpoch);

    for (const msg of sortedMessages) {
      // Apply filters
      if (!isUserContentMessage(msg)) {
        continue;
      }
      if (!hasMessageContent(msg) && resolvedReferences?.has(msg.id) !== true) {
        continue;
      }
      if (isContextExcludedBotMessage(msg, options.botUserId)) {
        continue;
      }
      // Filter BLOCK-denied users from extended context
      if (options.isBlockDenied?.(msg.author.id) === true) {
        continue;
      }
      if (historyCutoff !== undefined && msg.createdAt < historyCutoff) {
        continue;
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

        collectExtendedContextAttachments(
          conversionResult,
          msg.id,
          collectedImageAttachments,
          collectedVoiceAttachments
        );

        // Collect guild info + unique user info for participant/persona
        // resolution — but ONLY for messages authored by a real (non-bot) user.
        // A relay-echo is now correctly role=User (Bug B), yet it's authored by
        // the PRIMARY bot; the user it represents has no resolvable Discord
        // identity on a bot-authored message, so sweeping `msg.author` here would
        // register the bot (or a PluralKit webhook id) as a bogus participant.
        const isRealUser = msg.author.bot !== true;

        // Collect guild info for user participants
        const personaId = conversionResult.message.personaId;
        if (conversionResult.message.role === MessageRole.User && isRealUser && msg.member) {
          delete participantGuildInfo[personaId];
          participantGuildInfo[personaId] = extractGuildInfo(msg);
        }

        // Collect unique user info
        if (conversionResult.message.role === MessageRole.User && isRealUser) {
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
      voiceAttachments: collectedVoiceAttachments,
      participantGuildInfo: limitedParticipantGuildInfo,
      extendedContextUsers,
      reactorUsers,
    };
  }

  /**
   * Classify a message's authorship for role + normalization decisions.
   *
   * Dual-detection: our-webhook registry primary, `webhookId` + bot-suffix as
   * fallback. Three "ours" outcomes drive downstream handling:
   *  - our guild webhook character reply → assistant
   *  - our DM personality response (primary bot, registered; webhooks don't work
   *    in DMs so it's sent as `**Personality:** …`) → assistant
   *  - our primary-bot relay-echo of USER input (`channel.send("**Name:** …")`,
   *    not registered) → user
   *
   * Everything else — real humans, PluralKit, unaffiliated webhooks — is not
   * ours: role=user, content left untouched.
   */
  private async classifyAuthorship(
    msg: Message,
    options: FetchOptions,
    authorName: string
  ): Promise<{
    isOurMessage: boolean;
    isOurAssistant: boolean;
    /** Resolved personality UUID (registry hit) — drives unique-name attribution. */
    registeredPersonalityId: string | null;
  }> {
    const isPrimaryBot = msg.author.id === options.botUserId;
    const hasWebhookId =
      msg.webhookId !== undefined && msg.webhookId !== null && msg.webhookId.length > 0;

    // Registry lookup only for potentially-ours messages; real human messages
    // (the majority) skip the Redis round-trip entirely.
    let registeredPersonalityId: string | null = null;
    if (isPrimaryBot || hasWebhookId) {
      registeredPersonalityId = (await options.getOurPersonalityId?.(msg.id)) ?? null;
    }

    // Bot-suffix fallback for guild webhooks whose registry key expired (TTL) or
    // was never stored (transient failure) — same tier-down as reply resolution.
    const suffixMatches =
      hasWebhookId &&
      options.botSuffix !== undefined &&
      options.botSuffix.length > 0 &&
      stripBotSuffix(authorName, options.botSuffix) !== null;

    const isOurWebhook = hasWebhookId && (registeredPersonalityId !== null || suffixMatches);
    const isOurDmResponse = isPrimaryBot && registeredPersonalityId !== null;
    const isOurRelayEcho = isPrimaryBot && registeredPersonalityId === null;

    return {
      isOurMessage: isOurWebhook || isOurDmResponse || isOurRelayEcho,
      isOurAssistant: isOurWebhook || isOurDmResponse,
      registeredPersonalityId,
    };
  }

  /**
   * Convert a Discord message to ConversationMessage format
   */
  // eslint-disable-next-line complexity, sonarjs/cognitive-complexity -- Message type conversion branches for content building, attachment handling, reference resolution, forwarded message extraction, and our-message normalization
  private async convertMessage(
    msg: Message,
    options: FetchOptions,
    resolvedReferences?: Map<string, StoredReferencedMessage[]>
  ): Promise<{ message: ConversationMessage; attachments: AttachmentMetadata[] } | null> {
    const authorName =
      msg.member?.displayName ?? msg.author.globalName ?? msg.author.username ?? 'Unknown';
    const { isOurMessage, isOurAssistant, registeredPersonalityId } = await this.classifyAuthorship(
      msg,
      options,
      authorName
    );
    const role = isOurAssistant ? MessageRole.Assistant : MessageRole.User;

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

    // Normalize ONLY messages WE authored: strip the bot-added `**Name:** `
    // relay/DM prefix and our `-#` subtext footers (model indicator,
    // incognito/focus mode, auto-response, transcription) so the model never
    // sees them in extended context and roleplays around them. Real users'
    // content is theirs — `-#`/`**…:**` text there is user-authored, left
    // intact. Single source of truth shared with the DB-sync path
    // (conversationSyncDiff) via normalizeMessageForContext so the two can't drift.
    const content = isOurMessage ? normalizeMessageForContext(rawContent) : rawContent;

    // Recover the attribution carried in our `**Name:** ` prefix before it's
    // stripped: for an assistant DM response it's the personality's display
    // name; for a relay-echo of user input it's the USER's display name. Scoped
    // to OUR messages so a real user typing literal `**foo:** bar` isn't
    // mis-attributed.
    const prefixName = isOurMessage ? extractMessagePrefixName(rawContent) : null;
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
      personaId:
        role === MessageRole.User ? `${INTERNAL_DISCORD_ID_PREFIX}${msg.author.id}` : 'assistant',
      personaName: role === MessageRole.User ? (prefixName ?? authorName) : undefined,
      discordUsername: msg.author.username,
      discordMessageId: [msg.id],
      isForwarded: isForwarded || undefined,
      messageMetadata,
      personalityName:
        role === MessageRole.Assistant
          ? (prefixName ?? extractPersonalityName(authorName, options.botSuffix ?? ''))
          : undefined,
      // The UUID lets ai-worker remap personalityName to the unique name, since
      // the webhook-derived name above is the (possibly-shared) display name.
      // Null when the registry missed — attribution falls back to the name above.
      personalityId:
        role === MessageRole.Assistant ? (registeredPersonalityId ?? undefined) : undefined,
      channelId: msg.channelId,
      guildId: msg.guildId,
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
    personalityId: string
  ): Promise<SyncResult> {
    return executeDatabaseSync(discordMessages, channelId, personalityId);
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
