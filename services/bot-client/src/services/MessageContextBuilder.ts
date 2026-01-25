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
  GuildMemberInfo,
} from '@tzurot/common-types';
import type { GuildMember } from 'discord.js';
import type { MessageContext } from '../types.js';
import { extractDiscordEnvironment } from '../utils/discordContext.js';
import { buildMessageContent } from '../utils/MessageContentBuilder.js';
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

/** Result of fetching extended context from Discord */
interface ExtendedContextResult {
  /** Merged conversation history (DB + Discord messages) */
  history: ConversationMessage[];
  /** Image attachments from extended context for proactive processing */
  attachments?: AttachmentMetadata[];
  /** Guild info for participants in extended context */
  participantGuildInfo?: Record<
    string,
    { roles: string[]; displayColor?: string; joinedAt?: string }
  >;
}

/** Parameters for extended context fetching */
interface ExtendedContextParams {
  message: Message;
  personality: LoadedPersonality;
  history: ConversationMessage[];
  contextEpoch: Date | undefined;
  options: ContextBuildOptions;
}

/** Result of resolving user, persona, and history */
interface UserContextResult {
  internalUserId: string;
  discordUserId: string;
  personaId: string;
  personaName: string | null;
  userTimezone: string | undefined;
  contextEpoch: Date | undefined;
  history: ConversationMessage[];
}

/** Result of extracting references and resolving mentions */
interface ReferencesAndMentionsResult {
  messageContent: string;
  referencedMessages: ReferencedMessage[];
  mentionedPersonas?: MentionedPersona[];
  referencedChannels?: ReferencedChannel[];
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
   * Extract guild member info (roles, color, join date) from a Discord member.
   * Returns undefined if member is null/undefined.
   */
  private extractGuildMemberInfo(
    member: GuildMember | null | undefined,
    guildId: string | undefined
  ): GuildMemberInfo | undefined {
    if (!member) {
      return undefined;
    }
    return {
      // Get role names (excluding @everyone which has same ID as guild)
      // Sort by position (highest first), limit per MESSAGE_LIMITS.MAX_GUILD_ROLES
      roles:
        member.roles !== undefined
          ? Array.from(member.roles.cache.values())
              .filter(r => r.id !== guildId)
              .sort((a, b) => b.position - a.position)
              .slice(0, MESSAGE_LIMITS.MAX_GUILD_ROLES)
              .map(r => r.name)
          : [],
      // Display color from highest colored role (#000000 is treated as transparent)
      displayColor: member.displayHexColor !== '#000000' ? member.displayHexColor : undefined,
      // When user joined the server
      joinedAt: member.joinedAt?.toISOString(),
    };
  }

  /**
   * Resolve user identity, persona, and fetch conversation history.
   */
  private async resolveUserContext(
    message: Message,
    personality: LoadedPersonality,
    displayName: string
  ): Promise<UserContextResult> {
    // Get internal user ID for database operations
    const internalUserId = await this.userService.getOrCreateUser(
      message.author.id,
      message.author.username,
      displayName,
      undefined,
      message.author.bot
    );

    if (internalUserId === null) {
      throw new Error('Cannot process messages from bots');
    }

    const discordUserId = message.author.id;
    const personaResult = await this.personaResolver.resolve(discordUserId, personality.id);
    const personaId = personaResult.config.personaId;
    const personaName = personaResult.config.preferredName;
    const userTimezone = await this.userService.getUserTimezone(internalUserId);

    logger.debug(
      { personaId, personaName, internalUserId, discordUserId, personalityId: personality.id },
      '[MessageContextBuilder] User persona lookup complete'
    );

    // Look up context epoch (STM clear feature)
    const historyConfig = await this.prisma.userPersonaHistoryConfig.findUnique({
      where: {
        userId_personalityId_personaId: {
          userId: internalUserId,
          personalityId: personality.id,
          personaId,
        },
      },
      select: { lastContextReset: true },
    });
    const contextEpoch = historyConfig?.lastContextReset ?? undefined;

    if (contextEpoch !== undefined && contextEpoch !== null) {
      logger.debug(
        { personaId, contextEpoch: contextEpoch.toISOString() },
        '[MessageContextBuilder] Applying context epoch filter (STM clear)'
      );
    }

    // Note: History fetching is deferred to buildContext which has access to options
    // This allows choosing between personality-filtered or full channel history
    // based on whether extended context is enabled.
    const history: ConversationMessage[] = [];

    return {
      internalUserId,
      discordUserId,
      personaId,
      personaName,
      userTimezone,
      contextEpoch,
      history,
    };
  }

  /**
   * Fetch conversation history from database.
   * When extended context is enabled, fetches ALL channel messages (not filtered by personality)
   * to align with Discord extended context and prevent duplication issues.
   */
  private async fetchDbHistory(
    channelId: string,
    personalityId: string,
    contextEpoch: Date | undefined,
    useChannelHistory: boolean
  ): Promise<ConversationMessage[]> {
    const history = useChannelHistory
      ? await this.conversationHistory.getChannelHistory(
          channelId,
          MESSAGE_LIMITS.MAX_HISTORY_FETCH,
          contextEpoch
        )
      : await this.conversationHistory.getRecentHistory(
          channelId,
          personalityId,
          MESSAGE_LIMITS.MAX_HISTORY_FETCH,
          contextEpoch
        );

    logger.debug(
      { channelId, personalityId, useChannelHistory, dbHistoryCount: history.length },
      '[MessageContextBuilder] Fetched conversation history from database'
    );

    return history;
  }

  /**
   * Fetch extended context from Discord channel and merge with history.
   */
  private async fetchExtendedContext(
    params: ExtendedContextParams
  ): Promise<ExtendedContextResult> {
    const { message, personality, history, contextEpoch, options } = params;
    let mergedHistory = history;
    let attachments: AttachmentMetadata[] | undefined;
    let participantGuildInfo: ExtendedContextResult['participantGuildInfo'];

    if (options.extendedContext?.enabled !== true || options.botUserId === undefined) {
      return { history: mergedHistory };
    }

    if (!isTypingChannel(message.channel)) {
      logger.debug(
        { channelId: message.channel.id, channelType: message.channel.type },
        '[MessageContextBuilder] Channel does not support extended context fetching'
      );
      return { history: mergedHistory };
    }

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
        limit: options.extendedContext.maxMessages,
        before: message.id,
        botUserId: options.botUserId,
        personalityName: personality.displayName,
        personalityId: personality.id,
        getTranscript: (discordMessageId, attachmentUrl) =>
          this.transcriptRetriever.retrieveTranscript(discordMessageId, attachmentUrl),
        contextEpoch,
        maxAge: options.extendedContext.maxAge,
      }
    );

    if (fetchResult.messages.length === 0) {
      return { history: mergedHistory };
    }

    // Merge Discord messages with DB history
    mergedHistory = this.channelFetcher.mergeWithHistory(fetchResult.messages, history);

    logger.info(
      {
        channelId: message.channel.id,
        discordMessages: fetchResult.filteredCount,
        dbMessages: history.length - fetchResult.messages.length + 1,
        totalMerged: mergedHistory.length,
      },
      '[MessageContextBuilder] Extended context merged with conversation history'
    );

    // Collect image attachments
    const maxImages = options.extendedContext.maxImages ?? 0;
    if (maxImages > 0 && fetchResult.imageAttachments && fetchResult.imageAttachments.length > 0) {
      attachments = fetchResult.imageAttachments.slice(0, maxImages);
      logger.debug(
        {
          channelId: message.channel.id,
          availableImages: fetchResult.imageAttachments.length,
          maxImages,
          selectedImages: attachments.length,
        },
        '[MessageContextBuilder] Collected extended context images for processing'
      );
    }

    // Capture participant guild info
    if (fetchResult.participantGuildInfo) {
      participantGuildInfo = fetchResult.participantGuildInfo;
      logger.debug(
        {
          channelId: message.channel.id,
          participantCount: Object.keys(participantGuildInfo).length,
        },
        '[MessageContextBuilder] Collected participant guild info from extended context'
      );
    }

    // Opportunistic sync (fire and forget)
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

    return { history: mergedHistory, attachments, participantGuildInfo };
  }

  /**
   * Extract referenced messages and resolve mentions.
   */
  private async extractReferencesAndMentions(
    message: Message,
    content: string,
    personality: LoadedPersonality,
    history: ConversationMessage[]
  ): Promise<ReferencesAndMentionsResult> {
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

    // Extract referenced messages
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

    if (referencedMessages.length > 0) {
      logger.info(
        {
          count: referencedMessages.length,
          referenceNumbers: referencedMessages.map(r => r.referenceNumber),
        },
        '[MessageContextBuilder] Extracted referenced messages (after deduplication)'
      );
    }

    let messageContent = updatedContent ?? content ?? '[no text content]';

    // Resolve all mentions
    const mentionResult = await this.mentionResolver.resolveAllMentions(
      messageContent,
      message,
      personality.id
    );
    messageContent = mentionResult.processedContent;

    let mentionedPersonas: MentionedPersona[] | undefined;
    let referencedChannels: ReferencedChannel[] | undefined;

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

    return { messageContent, referencedMessages, mentionedPersonas, referencedChannels };
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
    // Step 1: Fetch guild member for enriched participant context
    const member =
      message.member ?? (await message.guild?.members.fetch(message.author.id).catch(() => null));
    const displayName = member?.displayName ?? message.author.globalName ?? message.author.username;
    const guildMemberInfo = this.extractGuildMemberInfo(member, message.guild?.id);

    // Step 2: Resolve user identity, persona, and context epoch
    const userContext = await this.resolveUserContext(message, personality, displayName);
    const { internalUserId, discordUserId, personaId, personaName, userTimezone, contextEpoch } =
      userContext;

    // Step 3: Fetch conversation history from PostgreSQL
    const useChannelHistory = options.extendedContext?.enabled === true;
    const dbHistory = await this.fetchDbHistory(
      message.channel.id,
      personality.id,
      contextEpoch,
      useChannelHistory
    );

    // Step 4: Fetch extended context from Discord (if enabled) and merge with DB history
    const extendedContext = await this.fetchExtendedContext({
      message,
      personality,
      history: dbHistory,
      contextEpoch,
      options,
    });
    const history = extendedContext.history;
    const extendedContextAttachments = extendedContext.attachments;
    const participantGuildInfo = extendedContext.participantGuildInfo;

    // Step 5: Extract references and resolve mentions
    const refsAndMentions = await this.extractReferencesAndMentions(
      message,
      content,
      personality,
      history
    );
    const { messageContent, referencedMessages, mentionedPersonas, referencedChannels } =
      refsAndMentions;

    // Step 6: Convert conversation history to API format
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
      // AI personality info for multi-AI channel attribution
      // Allows correct attribution when multiple AI personalities respond in the same channel
      personalityId: msg.personalityId,
      personalityName: msg.personalityName,
      messageMetadata: msg.messageMetadata,
    }));

    // Extract attachments using unified buildMessageContent
    // This ensures forwarded message snapshot attachments are included (DRY principle)
    // Voice transcripts are handled upstream (passed in via content parameter)
    const { attachments: allAttachments } = await buildMessageContent(message, {
      includeEmbeds: false, // Embeds parsed by reference extraction, not needed here
      includeAttachments: false, // We only need attachment metadata, not text descriptions
    });
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
      participantGuildInfo, // Guild info for other participants (from extended context)
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
