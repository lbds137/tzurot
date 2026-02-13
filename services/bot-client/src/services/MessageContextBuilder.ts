/**
 * Message Context Builder
 *
 * Builds AI context from Discord messages.
 * Helper modules extracted to contextBuilder/ subdirectory.
 */

import type {
  PrismaClient,
  PersonaResolver,
  ResolvedExtendedContextSettings,
} from '@tzurot/common-types';
import type { Message, User } from 'discord.js';
import {
  ConversationHistoryService,
  ConversationSyncService,
  UserService,
  createLogger,
  MESSAGE_LIMITS,
  isTypingChannel,
} from '@tzurot/common-types';
import type {
  LoadedPersonality,
  ReferencedMessage,
  ConversationMessage,
  AttachmentMetadata,
} from '@tzurot/common-types';
import type { GuildMember } from 'discord.js';
import type { MessageContext } from '../types.js';
import { extractDiscordEnvironment } from '../utils/discordContext.js';
import { buildMessageContent } from '../utils/MessageContentBuilder.js';
import { MentionResolver } from './MentionResolver.js';
import { DiscordChannelFetcher, type FetchableChannel } from './DiscordChannelFetcher.js';
import { TranscriptRetriever } from '../handlers/references/TranscriptRetriever.js';
import {
  resolveExtendedContextPersonaIds,
  extractGuildMemberInfo,
  resolveEffectiveMember,
  resolveUserContext,
} from './contextBuilder/index.js';
import {
  extractReferencesAndMentions,
  type ReferencesAndMentionsResult,
} from './contextBuilder/ReferenceExtractor.js';

const logger = createLogger('MessageContextBuilder');

/**
 * Options for building message context
 */
interface ContextBuildOptions {
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
}

/**
 * Result of building message context
 */
interface ContextBuildResult {
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
   * Fetch conversation history from database.
   * Always fetches ALL channel messages (not filtered by personality) to provide
   * complete conversation context and align with Discord extended context messages.
   *
   * The limit parameter caps the DB fetch to the maxMessages setting from LlmConfig,
   * preventing the DB lookup from going much farther back than necessary.
   */
  private async fetchDbHistory(
    channelId: string,
    _personalityId: string,
    contextEpoch: Date | undefined,
    limit: number = MESSAGE_LIMITS.DEFAULT_MAX_MESSAGES
  ): Promise<ConversationMessage[]> {
    // Always use getChannelHistory for complete conversation context
    // This prevents divergence between DB and Discord message views
    const history = await this.conversationHistory.getChannelHistory(
      channelId,
      limit,
      contextEpoch
    );

    logger.debug(
      { channelId, limit, dbHistoryCount: history.length },
      '[MessageContextBuilder] Fetched conversation history from database'
    );

    return history;
  }

  /**
   * Fetch extended context from Discord channel and merge with history.
   */
  // eslint-disable-next-line max-lines-per-function -- Cohesive extended context workflow
  private async fetchExtendedContext(
    params: ExtendedContextParams
  ): Promise<ExtendedContextResult> {
    const { message, personality, history, contextEpoch, options } = params;
    let mergedHistory = history;
    let attachments: AttachmentMetadata[] | undefined;
    let participantGuildInfo: ExtendedContextResult['participantGuildInfo'];

    if (options.extendedContext === undefined || options.botUserId === undefined) {
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

    // Create personas for extended context users AND reactor users
    // Combine both arrays to handle in a single batch (reactors are users who reacted to messages)
    const usersToResolve = [
      ...(fetchResult.extendedContextUsers ?? []),
      ...(fetchResult.reactorUsers ?? []),
    ];
    if (usersToResolve.length > 0) {
      const userMap = await this.userService.getOrCreateUsersInBatch(usersToResolve);
      logger.debug(
        {
          requested: usersToResolve.length,
          extendedContextCount: fetchResult.extendedContextUsers?.length ?? 0,
          reactorCount: fetchResult.reactorUsers?.length ?? 0,
          created: userMap.size,
        },
        '[MessageContextBuilder] Batch created personas for extended context and reactor users'
      );

      // Resolve personaIds for BOTH message authors AND reactors in one batch
      // Also remaps participantGuildInfo keys to use the new UUIDs
      const resolved = await resolveExtendedContextPersonaIds(
        fetchResult.messages,
        userMap,
        personality.id,
        this.personaResolver,
        fetchResult.participantGuildInfo
      );

      if (resolved.total > 0) {
        logger.debug(
          {
            messageCount: resolved.messageCount,
            reactorCount: resolved.reactorCount,
            total: resolved.total,
          },
          '[MessageContextBuilder] Resolved extended context personaIds to UUIDs'
        );
      }
    }

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
      attachments = fetchResult.imageAttachments.slice(-maxImages);
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
    // This is idempotent and safe for concurrent execution:
    // - Only updates EXISTING messages (no creates = no duplicate writes)
    // - Updates are idempotent (set content to X, set content to X again = same result)
    // - Deletes use soft-delete with timestamps (concurrent deletes are harmless)
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

  /** Extract referenced messages and resolve mentions - delegates to ReferenceExtractor */
  private async extractReferencesAndMentions(
    message: Message,
    content: string,
    personality: LoadedPersonality,
    history: ConversationMessage[],
    isWeighInMode = false
  ): Promise<ReferencesAndMentionsResult> {
    return extractReferencesAndMentions({
      prisma: this.prisma,
      mentionResolver: this.mentionResolver,
      message,
      content,
      personality,
      history,
      isWeighInMode,
    });
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
  // eslint-disable-next-line max-lines-per-function -- Coordinator method with 6 well-organized steps
  async buildContext(
    message: Message,
    personality: LoadedPersonality,
    content: string,
    options: ContextBuildOptions = {}
  ): Promise<ContextBuildResult> {
    // Step 1: Determine effective user and member
    // For slash commands, overrideUser/overrideMember specifies the command invoker
    // For @mentions, we use message.author (the actual message sender)
    const effectiveUser = options.overrideUser ?? message.author;
    const effectiveMember = await resolveEffectiveMember(message, options);
    const displayName =
      effectiveMember?.displayName ?? effectiveUser.globalName ?? effectiveUser.username;
    const guildMemberInfo = extractGuildMemberInfo(effectiveMember, message.guild?.id);

    // Step 2: Resolve user identity, persona, and context epoch
    // Pass effective user info (not message.author) for correct BYOK and persona resolution
    const userContext = await resolveUserContext(
      { id: effectiveUser.id, username: effectiveUser.username, bot: effectiveUser.bot },
      personality,
      displayName,
      {
        userService: this.userService,
        personaResolver: this.personaResolver,
        prisma: this.prisma,
      }
    );
    const { internalUserId, discordUserId, personaId, personaName, userTimezone, contextEpoch } =
      userContext;

    // Step 3: Fetch conversation history from PostgreSQL
    // Always fetch complete channel history (not personality-filtered)
    // Use maxMessages from resolved LLM config or extended context settings
    // Hard cap at MAX_EXTENDED_CONTEXT (100) as defense-in-depth against API validation bypass
    const dbLimit = Math.min(
      options.extendedContext?.maxMessages ?? MESSAGE_LIMITS.DEFAULT_MAX_MESSAGES,
      MESSAGE_LIMITS.MAX_EXTENDED_CONTEXT
    );
    const dbHistory = await this.fetchDbHistory(
      message.channel.id,
      personality.id,
      contextEpoch,
      dbLimit
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
      history,
      options.isWeighInMode ?? false
    );
    const { messageContent, referencedMessages, mentionedPersonas, referencedChannels } =
      refsAndMentions;

    // Step 6: Convert conversation history to API format
    // Include messageMetadata so referenced messages can be formatted at prompt time
    // Include tokenCount for accurate token budget calculations (avoids chars/4 fallback)
    // Include discordUsername for disambiguation when persona name matches personality name
    // Include discordMessageId for quote deduplication (prevents duplicating quoted content in history)
    const conversationHistory = history.map(msg => ({
      id: msg.id,
      role: msg.role,
      content: msg.content,
      tokenCount: msg.tokenCount, // Pre-computed with tiktoken at message save time
      createdAt: msg.createdAt.toISOString(),
      isForwarded: msg.isForwarded, // For XML attribute (forwarded="true")
      personaId: msg.personaId,
      personaName: msg.personaName,
      discordUsername: msg.discordUsername, // For collision detection in prompt building
      discordMessageId: msg.discordMessageId, // For quote deduplication in prompt building
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
    // effectiveUser is either overrideUser (slash commands) or message.author (@mentions)
    const context: MessageContext = {
      userId: discordUserId,
      userInternalId: internalUserId,
      userName: effectiveUser.username,
      discordUsername: effectiveUser.username, // For collision detection in prompt building
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
