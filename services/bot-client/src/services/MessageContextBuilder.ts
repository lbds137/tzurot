/**
 * Message Context Builder
 *
 * Builds AI context from Discord messages.
 * Handles attachments, references, environment, and conversation history.
 * Supports extended context: fetching recent Discord channel messages.
 */

import type {
  PrismaClient,
  PersonaResolver,
  ResolvedExtendedContextSettings,
} from '@tzurot/common-types';
import type { Message } from 'discord.js';
import {
  ConversationHistoryService,
  ConversationSyncService,
  UserService,
  createLogger,
  MessageRole,
  CONTENT_TYPES,
  INTERVALS,
  MESSAGE_LIMITS,
  isTypingChannel,
} from '@tzurot/common-types';
import type {
  LoadedPersonality,
  MentionedPersona,
  ReferencedChannel,
  ReferencedMessage,
  ConversationMessage,
  AttachmentMetadata,
} from '@tzurot/common-types';
import type { MessageContext } from '../types.js';
import { extractDiscordEnvironment } from '../utils/discordContext.js';
import { extractAttachments } from '../utils/attachmentExtractor.js';
import { extractEmbedImages } from '../utils/embedImageExtractor.js';
import { MessageReferenceExtractor } from '../handlers/MessageReferenceExtractor.js';
import { MentionResolver } from './MentionResolver.js';
import { DiscordChannelFetcher, type FetchableChannel } from './DiscordChannelFetcher.js';
import { TranscriptRetriever } from '../handlers/references/TranscriptRetriever.js';

const logger = createLogger('MessageContextBuilder');

/**
 * Options for building message context
 */
export interface ContextBuildOptions {
  /**
   * Extended context settings: resolved settings for fetching recent Discord messages.
   * Includes enabled flag, maxMessages, maxAge, and maxImages limits.
   * When enabled, merges Discord messages with DB conversation history.
   */
  extendedContext?: ResolvedExtendedContextSettings;
  /**
   * Bot's Discord user ID (required for extended context to identify assistant messages)
   */
  botUserId?: string;
}

/**
 * Result of building message context
 */
export interface ContextBuildResult {
  /** Full AI context ready to send to api-gateway */
  context: MessageContext;
  /** User's database UUID */
  userId: string;
  /** Persona ID for this user+personality combination */
  personaId: string;
  /** Persona display name */
  personaName: string | null;
  /** Message content with Discord links replaced by [Reference N] */
  messageContent: string;
  /** Referenced messages (from replies and message links) */
  referencedMessages: ReferencedMessage[];
  /** Conversation history (for reference enrichment) */
  conversationHistory: ConversationMessage[];
}

/**
 * Builds AI context from Discord messages
 */
export class MessageContextBuilder {
  private conversationHistory: ConversationHistoryService;
  private conversationSync: ConversationSyncService;
  private userService: UserService;
  private mentionResolver: MentionResolver;
  private personaResolver: PersonaResolver;
  private channelFetcher: DiscordChannelFetcher;
  private transcriptRetriever: TranscriptRetriever;

  constructor(
    private prisma: PrismaClient,
    personaResolver: PersonaResolver
  ) {
    this.conversationHistory = new ConversationHistoryService(prisma);
    this.conversationSync = new ConversationSyncService(prisma);
    this.userService = new UserService(prisma);
    this.mentionResolver = new MentionResolver(prisma, personaResolver);
    this.personaResolver = personaResolver;
    this.channelFetcher = new DiscordChannelFetcher();
    this.transcriptRetriever = new TranscriptRetriever(this.conversationHistory);
  }

  /**
   * Build complete AI context from a Discord message
   *
   * Handles:
   * - User/persona lookup
   * - Conversation history retrieval
   * - Extended context (optional): fetches recent Discord channel messages
   * - Reference extraction (with deduplication)
   * - Attachment extraction
   * - Environment context
   *
   * @param message - The Discord message to process
   * @param personality - The target personality
   * @param content - Message content (may be voice transcript)
   * @param options - Additional options including extended context
   */
  async buildContext(
    message: Message,
    personality: LoadedPersonality,
    content: string,
    options: ContextBuildOptions = {}
  ): Promise<ContextBuildResult> {
    // Get or create user record (needed for conversation history query)
    const displayName =
      message.member?.displayName ?? message.author.globalName ?? message.author.username;

    // Extract guild member info for enriched participant context
    // Includes server roles, display color, and join date
    const member = message.member;
    const guildMemberInfo = member
      ? {
          // Get role names (excluding @everyone which has same ID as guild)
          // Limit to 10 roles for token efficiency
          roles:
            member.roles !== undefined
              ? Array.from(member.roles.cache.values())
                  .filter(r => r.id !== message.guild?.id)
                  .map(r => r.name)
                  .slice(0, 10)
              : [],
          // Display color from highest colored role (#000000 is treated as transparent)
          displayColor:
            member.displayHexColor !== '#000000' ? member.displayHexColor : undefined,
          // When user joined the server
          joinedAt: member.joinedAt?.toISOString(),
        }
      : undefined;

    // Get internal user ID for database operations (persona, history queries)
    // Pass isBot flag to prevent creating user records for bots
    const internalUserId = await this.userService.getOrCreateUser(
      message.author.id,
      message.author.username,
      displayName,
      undefined, // bio
      message.author.bot // isBot - bots return null
    );

    // Safety check: if user is a bot (shouldn't happen due to BotMessageFilter, but defense in depth)
    if (internalUserId === null) {
      throw new Error('Cannot process messages from bots');
    }

    // Discord ID is used for API context (BYOK resolution, etc.)
    const discordUserId = message.author.id;

    // Get persona for this user + personality combination
    // Uses PersonaResolver with proper cache invalidation via Redis pub/sub
    const personaResult = await this.personaResolver.resolve(discordUserId, personality.id);
    const personaId = personaResult.config.personaId;
    const personaName = personaResult.config.preferredName;

    // Get user's timezone preference
    const userTimezone = await this.userService.getUserTimezone(internalUserId);

    logger.debug(
      {
        personaId,
        personaName,
        internalUserId,
        discordUserId,
        personalityId: personality.id,
      },
      '[MessageContextBuilder] User persona lookup complete'
    );

    // Look up user's context epoch for this persona (STM clear feature)
    // Messages before this timestamp are excluded from AI context
    const historyConfig = await this.prisma.userPersonaHistoryConfig.findUnique({
      where: {
        userId_personalityId_personaId: {
          userId: internalUserId,
          personalityId: personality.id,
          personaId,
        },
      },
      select: {
        lastContextReset: true,
      },
    });
    const contextEpoch = historyConfig?.lastContextReset ?? undefined;

    if (contextEpoch !== undefined && contextEpoch !== null) {
      logger.debug(
        { personaId, contextEpoch: contextEpoch.toISOString() },
        '[MessageContextBuilder] Applying context epoch filter (STM clear)'
      );
    }

    // Get conversation history from PostgreSQL
    // Retrieve more than needed - AI worker will trim based on token budget
    // Apply context epoch filter if user has cleared history
    let history = await this.conversationHistory.getRecentHistory(
      message.channel.id,
      personality.id,
      MESSAGE_LIMITS.MAX_HISTORY_FETCH,
      contextEpoch
    );

    // Extended context: fetch recent messages from Discord channel
    // This provides broader context beyond just bot conversations stored in DB
    let extendedContextAttachments: AttachmentMetadata[] | undefined;

    if (options.extendedContext?.enabled === true && options.botUserId !== undefined) {
      // Check if channel supports message fetching
      if (isTypingChannel(message.channel)) {
        logger.debug(
          {
            channelId: message.channel.id,
            maxMessages: options.extendedContext.maxMessages,
            maxAge: options.extendedContext.maxAge,
            maxImages: options.extendedContext.maxImages,
          },
          '[MessageContextBuilder] Fetching extended context from Discord'
        );

        const fetchResult = await this.channelFetcher.fetchRecentMessages(
          message.channel as FetchableChannel,
          {
            limit: options.extendedContext.maxMessages, // Use resolved limit instead of constant
            before: message.id, // Exclude the triggering message
            botUserId: options.botUserId,
            personalityName: personality.displayName,
            personalityId: personality.id,
            // Provide transcript retriever for voice messages in extended context
            getTranscript: (discordMessageId, attachmentUrl) =>
              this.transcriptRetriever.retrieveTranscript(discordMessageId, attachmentUrl),
            // Apply context epoch filter (from /history clear)
            contextEpoch,
            // Apply max age filter if configured
            maxAge: options.extendedContext.maxAge,
          }
        );

        if (fetchResult.messages.length > 0) {
          // Merge Discord messages with DB history (deduplicated)
          history = this.channelFetcher.mergeWithHistory(fetchResult.messages, history);

          logger.info(
            {
              channelId: message.channel.id,
              discordMessages: fetchResult.filteredCount,
              dbMessages: history.length - fetchResult.messages.length + 1, // Approximate after dedup
              totalMerged: history.length,
            },
            '[MessageContextBuilder] Extended context merged with conversation history'
          );

          // Collect image attachments for proactive processing (maxImages limit)
          // Images are already sorted newest-first from DiscordChannelFetcher
          const maxImages = options.extendedContext.maxImages ?? 0;
          if (
            maxImages > 0 &&
            fetchResult.imageAttachments &&
            fetchResult.imageAttachments.length > 0
          ) {
            // Take top N newest images for proactive description
            extendedContextAttachments = fetchResult.imageAttachments.slice(0, maxImages);
            logger.debug(
              {
                channelId: message.channel.id,
                availableImages: fetchResult.imageAttachments.length,
                maxImages,
                selectedImages: extendedContextAttachments.length,
              },
              '[MessageContextBuilder] Collected extended context images for processing'
            );
          }

          // Opportunistic sync: detect edits and deletes in the background
          // This doesn't block message processing - fire and forget
          if (fetchResult.rawMessages) {
            this.channelFetcher
              .syncWithDatabase(
                fetchResult.rawMessages,
                message.channel.id,
                personality.id,
                this.conversationSync
              )
              .catch(err => {
                logger.warn(
                  { err, channelId: message.channel.id },
                  '[MessageContextBuilder] Opportunistic sync failed (non-blocking)'
                );
              });
          }
        }
      } else {
        logger.debug(
          { channelId: message.channel.id, channelType: message.channel.type },
          '[MessageContextBuilder] Channel does not support extended context fetching'
        );
      }
    }

    // Extract Discord message IDs and timestamps for deduplication
    const conversationHistoryMessageIds = history
      .flatMap(msg => msg.discordMessageId ?? [])
      .filter((id): id is string => id !== undefined && id !== null);

    const conversationHistoryTimestamps = history.map(msg => msg.createdAt);

    // Debug logging for voice message replies
    if (
      message.attachments.some(
        a =>
          (a.contentType?.startsWith(CONTENT_TYPES.AUDIO_PREFIX) ?? false) ||
          (a.duration !== null && a.duration !== undefined)
      )
    ) {
      const mostRecentAssistant = history
        .filter(m => m.role === MessageRole.Assistant)
        .slice(-1)[0];
      const mostRecentAssistantIds = mostRecentAssistant?.discordMessageId ?? [];

      logger.debug(
        {
          isReply: message.reference !== null,
          replyToMessageId: message.reference?.messageId,
          messageContent: content ?? '(empty - voice only)',
          historyCount: history.length,
          replyMatchesRecentAssistant: mostRecentAssistantIds.includes(
            message.reference?.messageId ?? ''
          ),
        },
        '[MessageContextBuilder] Processing voice message reply - deduplication data'
      );
    }

    // Extract referenced messages (from replies and message links)
    // Uses conversation history for deduplication
    logger.debug('[MessageContextBuilder] Extracting referenced messages with deduplication');
    const referenceExtractor = new MessageReferenceExtractor({
      prisma: this.prisma,
      maxReferences: MESSAGE_LIMITS.MAX_REFERENCED_MESSAGES,
      embedProcessingDelayMs: INTERVALS.EMBED_PROCESSING_DELAY,
      conversationHistoryMessageIds,
      conversationHistoryTimestamps,
    });

    const { references: referencedMessages, updatedContent } =
      await referenceExtractor.extractReferencesWithReplacement(message);

    // Log reference extraction results
    if (referencedMessages.length > 0) {
      logger.info(
        {
          count: referencedMessages.length,
          referenceNumbers: referencedMessages.map(r => r.referenceNumber),
        },
        '[MessageContextBuilder] Extracted referenced messages (after deduplication)'
      );
    }

    // Use updatedContent (with Discord links replaced by [Reference N])
    let messageContent = updatedContent ?? content ?? '[no text content]';

    // Resolve all mentions (users, channels, roles)
    let mentionedPersonas: MentionedPersona[] | undefined;
    let referencedChannels: ReferencedChannel[] | undefined;

    // Use resolveAllMentions to handle users, channels, and roles in one pass
    const mentionResult = await this.mentionResolver.resolveAllMentions(
      messageContent,
      message,
      personality.id
    );
    messageContent = mentionResult.processedContent;

    // Extract mentioned users as personas
    if (mentionResult.mentionedUsers.length > 0) {
      mentionedPersonas = mentionResult.mentionedUsers.map(u => ({
        personaId: u.personaId,
        personaName: u.personaName,
      }));
      logger.debug(
        { mentionedCount: mentionedPersonas.length },
        '[MessageContextBuilder] Resolved user mentions'
      );
    }

    // Extract referenced channels (for LTM scoping)
    if (mentionResult.mentionedChannels.length > 0) {
      referencedChannels = mentionResult.mentionedChannels.map(c => ({
        channelId: c.channelId,
        channelName: c.channelName,
        topic: c.topic,
        guildId: c.guildId,
      }));
      logger.debug(
        { channelCount: referencedChannels.length },
        '[MessageContextBuilder] Resolved channel mentions for LTM scoping'
      );
    }

    // Note: Role mentions are resolved in processedContent but not tracked separately
    // (they don't affect LTM scoping or context in the same way as channels)

    // Convert conversation history to API format
    // Include messageMetadata so referenced messages can be formatted at prompt time
    // Include tokenCount for accurate token budget calculations (avoids chars/4 fallback)
    // Include discordUsername for disambiguation when persona name matches personality name
    const conversationHistory = history.map(msg => ({
      id: msg.id,
      role: msg.role,
      content: msg.content,
      tokenCount: msg.tokenCount, // Pre-computed with tiktoken at message save time
      createdAt: msg.createdAt.toISOString(),
      personaId: msg.personaId,
      personaName: msg.personaName,
      discordUsername: msg.discordUsername, // For collision detection in prompt building
      messageMetadata: msg.messageMetadata,
    }));

    // Extract attachments (images, audio, etc) from direct attachments
    const regularAttachments = extractAttachments(message.attachments);

    // Extract images from embeds (e.g., Reddit links with images)
    const embedImages = extractEmbedImages(message.embeds);

    // Combine both types of attachments
    const allAttachments = [...(regularAttachments ?? []), ...(embedImages ?? [])];
    const attachments = allAttachments.length > 0 ? allAttachments : undefined;

    // Extract Discord environment context
    const environment = extractDiscordEnvironment(message);

    // Build complete context
    // Note: userId is the Discord ID (for BYOK resolution)
    // userInternalId is the internal UUID (for usage logging and database operations)
    // discordUsername is used for disambiguation when persona name matches personality name
    const context: MessageContext = {
      userId: discordUserId,
      userInternalId: internalUserId,
      userName: message.author.username,
      discordUsername: message.author.username, // For collision detection in prompt building
      userTimezone: userTimezone, // User's timezone preference for date/time formatting
      channelId: message.channel.id,
      serverId: message.guild?.id,
      messageContent,
      activePersonaId: personaId,
      activePersonaName: personaName ?? undefined,
      activePersonaGuildInfo: guildMemberInfo, // Guild-specific info (roles, color, join date)
      conversationHistory,
      attachments,
      extendedContextAttachments, // Images from extended context (limited by maxImages)
      environment,
      referencedMessages: referencedMessages.length > 0 ? referencedMessages : undefined,
      mentionedPersonas,
      referencedChannels,
    };

    logger.debug(
      {
        activePersonaId: context.activePersonaId,
        activePersonaName: context.activePersonaName,
        historyLength: conversationHistory.length,
        referencedMessagesCount: referencedMessages.length,
      },
      '[MessageContextBuilder] Context built successfully'
    );

    return {
      context,
      userId: internalUserId, // Internal UUID for database operations
      personaId,
      personaName,
      messageContent,
      referencedMessages,
      conversationHistory: history, // Return for reference enrichment
    };
  }
}
