/**
 * Message Context Builder
 *
 * Builds AI context from Discord messages.
 * Helper modules extracted to contextBuilder/ subdirectory.
 */

import {
  type PrismaClient,
  type PersonaResolver,
  type LoadedPersonality,
  type ReferencedMessage,
  type ConversationMessage,
  type AttachmentMetadata,
  ConversationHistoryService,
  ConversationSyncService,
  UserService,
  createLogger,
  mapCrossChannelToApiFormat,
  MESSAGE_LIMITS,
  isTypingChannel,
} from '@tzurot/common-types';
import type { Message } from 'discord.js';
import type { MessageContext } from '../types.js';
import { extractDiscordEnvironment } from '../utils/discordContext.js';
import { buildMessageContent } from '../utils/MessageContentBuilder.js';
import { getThreadParentId } from '../utils/discordChannelTypes.js';
import { hasVoiceAttachments } from '../utils/forwardedMessageUtils.js';
import { selectContextVariant } from './contextBuilder/contextVariant.js';
import { MentionResolver } from './MentionResolver.js';
import { DiscordChannelFetcher, type FetchableChannel } from './DiscordChannelFetcher.js';
import { deriveBotSuffix } from '../utils/webhookNaming.js';
import type { DenylistCache } from './DenylistCache.js';
import { TranscriptRetriever } from '../handlers/references/TranscriptRetriever.js';
import {
  resolveExtendedContextPersonaIds,
  extractGuildMemberInfo,
  resolveEffectiveMember,
  resolveUserContext,
} from './contextBuilder/index.js';
import type { ContextBuildOptions } from './contextBuilder/ContextBuildOptions.js';
import {
  buildRawAssemblyInputs,
  captureRawExtendedContext,
  toApiConversationMessage,
  type RawExtendedContextSnapshot,
} from './contextBuilder/RawEnvelopeBuilder.js';
import {
  extractReferencesAndMentions,
  type ReferencesAndMentionsResult,
} from './contextBuilder/ReferenceExtractor.js';
import { fetchCrossChannelIfEnabled } from './CrossChannelHistoryFetcher.js';

const logger = createLogger('MessageContextBuilder');

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

type ParticipantGuildInfo = Record<
  string,
  { roles: string[]; displayColor?: string; joinedAt?: string }
>;

/** Result of fetching extended context from Discord */
interface ExtendedContextResult {
  history: ConversationMessage[];
  attachments?: AttachmentMetadata[];
  participantGuildInfo?: ParticipantGuildInfo;
  /**
   * Raw-envelope snapshot (present only when CONTEXT_RAW_ENVELOPE=true):
   * the Discord-fetched messages BEFORE persona-ID resolution mutates them
   * in place, plus the user lists feeding the batch upsert — exactly what
   * the worker-side shadow assembler needs to re-run that resolution.
   */
  raw?: RawExtendedContextSnapshot;
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
 * Builds AI context from Discord messages.
 *
 * **Post-login invariant**: callers must invoke this builder only after the
 * Discord gateway is ready. The `cachedBotSuffix` field lazily reads
 * `Client.user.tag` on first call; pre-login that field is `null` and the
 * cache would freeze at `''` for the service lifetime, breaking
 * personality-name attribution in extended-context fetches. Today this is
 * unreachable because the sole entry point (`fetchExtendedContext`) is
 * driven by message events, which only fire post-`ready`. If a new
 * non-message entry point is added, either thread the bot suffix in as a
 * constructor dependency or assert `Client.isReady()` here.
 */
export class MessageContextBuilder {
  private conversationHistory: ConversationHistoryService;
  private conversationSync: ConversationSyncService;
  private userService: UserService;
  private mentionResolver: MentionResolver;
  private personaResolver: PersonaResolver;
  private channelFetcher: DiscordChannelFetcher;
  private transcriptRetriever: TranscriptRetriever;
  private denylistCache?: DenylistCache;
  /**
   * Cached canonical bot suffix (e.g. ` · Tzurot`). The bot's Discord tag
   * doesn't change at runtime, so a single lookup per service instance is
   * sufficient. Lazily computed on first context build because the Discord
   * `Client` isn't fully populated until login completes.
   *
   * Safe against the pre-login edge case because `fetchExtendedContext` —
   * the sole entry point that triggers caching — is only reachable from
   * message-handler code that fires after the gateway is ready. If a future
   * caller invokes the builder before login, the cache would freeze at `''`
   * for the service lifetime; revisit then.
   */
  private cachedBotSuffix: string | null = null;

  constructor(
    private prisma: PrismaClient,
    personaResolver: PersonaResolver,
    denylistCache?: DenylistCache
  ) {
    this.conversationHistory = new ConversationHistoryService(prisma);
    this.conversationSync = new ConversationSyncService(prisma);
    this.userService = new UserService(prisma);
    this.mentionResolver = new MentionResolver(prisma, personaResolver);
    this.personaResolver = personaResolver;
    this.channelFetcher = new DiscordChannelFetcher();
    this.transcriptRetriever = new TranscriptRetriever(this.conversationHistory);
    this.denylistCache = denylistCache;
  }

  /**
   * Resolve the canonical bot suffix for webhook-username parsing, caching
   * the result for subsequent calls. The optional-chain dereferences live
   * here so `fetchExtendedContext` stays under its complexity budget.
   */
  private getBotSuffix(message: Message): string {
    if (this.cachedBotSuffix !== null) {
      return this.cachedBotSuffix;
    }
    this.cachedBotSuffix = deriveBotSuffix(message.client?.user?.tag ?? null);
    return this.cachedBotSuffix;
  }

  /**
   * Fetch extended context from Discord channel and merge with history.
   */
  // eslint-disable-next-line max-lines-per-function, sonarjs/cognitive-complexity -- Cohesive extended context workflow with guard clauses and optional feature checks
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
        'Channel does not support extended context fetching'
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
      'Fetching extended context from Discord'
    );

    const fetchResult = await this.channelFetcher.fetchRecentMessages(
      message.channel as FetchableChannel,
      {
        limit: options.extendedContext.maxMessages,
        before: message.id,
        botUserId: options.botUserId,
        botSuffix: this.getBotSuffix(message),
        personalityName: personality.displayName,
        personalityId: personality.id,
        getTranscript: (discordMessageId, attachmentUrl) =>
          this.transcriptRetriever.retrieveTranscript(discordMessageId, attachmentUrl),
        contextEpoch,
        maxAge: options.extendedContext.maxAge,
        isBlockDenied:
          this.denylistCache !== undefined
            ? (discordUserId: string) => {
                const cache = this.denylistCache;
                if (cache === undefined) {
                  return false;
                }
                return cache.isBlocked(
                  discordUserId,
                  message.guildId ?? undefined,
                  message.channelId,
                  personality.id,
                  getThreadParentId(message.channel) ?? undefined
                );
              }
            : undefined,
      }
    );

    // Snapshot must happen HERE — resolveExtendedContextPersonaIds below
    // mutates fetchResult.messages in place. See captureRawExtendedContext.
    const rawSnapshot = captureRawExtendedContext(fetchResult);

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
        'Batch created personas for extended context and reactor users'
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
          'Resolved extended context personaIds to UUIDs'
        );
      }
    }

    if (fetchResult.messages.length === 0) {
      return { history: mergedHistory, raw: rawSnapshot };
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
      'Extended context merged with conversation history'
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
        'Collected extended context images for processing'
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
        'Collected participant guild info from extended context'
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
            'Opportunistic sync failed (non-blocking)'
          );
        });
    }

    return { history: mergedHistory, attachments, participantGuildInfo, raw: rawSnapshot };
  }

  /** Extract referenced messages and resolve mentions - delegates to ReferenceExtractor */
  private async extractRefsAndMentions(opts: {
    message: Message;
    content: string;
    personality: LoadedPersonality;
    history: ConversationMessage[];
    isWeighInMode?: boolean;
    maxReferences?: number;
  }): Promise<ReferencesAndMentionsResult> {
    return extractReferencesAndMentions({
      prisma: this.prisma,
      mentionResolver: this.mentionResolver,
      message: opts.message,
      content: opts.content,
      personality: opts.personality,
      history: opts.history,
      isWeighInMode: opts.isWeighInMode ?? false,
      maxReferences: opts.maxReferences ?? MESSAGE_LIMITS.DEFAULT_MAX_MESSAGES,
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
    const { internalUserId, discordUserId, personaId, personaName, userTimezone } = userContext;
    // Weigh-in is an anonymous, channel-scoped summon: the invoking user's
    // persona-scoped STM-reset epoch must NOT bound the shared channel history
    // the personality is asked to comment on (a recent /conversation reset
    // would otherwise silently truncate it). Mirror of the worker-side
    // ContextAssembler.resolvePersonaContext weigh-in handling.
    const contextEpoch = options.isWeighInMode === true ? undefined : userContext.contextEpoch;

    // Step 3: Fetch conversation history from PostgreSQL
    // Always fetch complete channel history (not personality-filtered)
    // Use maxMessages from resolved LLM config or extended context settings
    // Hard cap at MAX_EXTENDED_CONTEXT (100) as defense-in-depth against API validation bypass
    // dbLimit caps the DB fetch to maxMessages from LlmConfig (hard cap MAX_EXTENDED_CONTEXT).
    // maxAge mirrors the DiscordChannelFetcher filter so stale DB rows don't leak past
    // the user's "forget after X" preference and starve cross-channel context.
    const dbLimit = Math.min(
      options.extendedContext?.maxMessages ?? MESSAGE_LIMITS.DEFAULT_MAX_MESSAGES,
      MESSAGE_LIMITS.MAX_EXTENDED_CONTEXT
    );
    const dbHistory = await this.conversationHistory.getChannelHistory(
      message.channel.id,
      dbLimit,
      contextEpoch,
      options.extendedContext?.maxAge
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

    // Step 4b: Fetch cross-channel history. Disabled in weigh-in mode (anonymous
    // poke that skips LTM and other-channel history for a fresh-perspective response).
    const crossChannelGroups = await fetchCrossChannelIfEnabled({
      enabled: options.crossChannelHistoryEnabled === true && options.isWeighInMode !== true,
      channelId: message.channel.id,
      personaId,
      personalityId: personality.id,
      dbLimit,
      discordClient: message.client,
      conversationHistoryService: this.conversationHistory,
      maxAge: options.extendedContext?.maxAge,
      contextEpoch,
    }).catch((err: unknown) => {
      logger.warn(
        { err, personaId, personalityId: personality.id, channelId: message.channel.id },
        'Cross-channel fetch failed, continuing without'
      );
      return undefined;
    });

    // Step 5: Extract references and resolve mentions
    // maxReferences shares the same budget as maxMessages (no additive surprise)
    const refsAndMentions = await this.extractRefsAndMentions({
      message,
      content,
      personality,
      history,
      isWeighInMode: options.isWeighInMode,
      maxReferences: options.extendedContext?.maxMessages,
    });
    const { messageContent, referencedMessages, mentionedPersonas, referencedChannels } =
      refsAndMentions;

    // Step 6: Convert conversation history to API format
    // Include messageMetadata so referenced messages can be formatted at prompt time
    // Include tokenCount for accurate token budget calculations (avoids chars/4 fallback)
    // Include discordUsername for disambiguation when persona name matches personality name
    // Include discordMessageId for quote deduplication (prevents duplicating quoted content in history)
    const conversationHistory = history.map(toApiConversationMessage);

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

    // Raw-envelope assembly inputs (worker-side shadow assembler burn-in);
    // undefined unless CONTEXT_RAW_ENVELOPE=true.
    const rawAssemblyInputs = buildRawAssemblyInputs(message, extendedContext.raw, {
      rawReferencedMessages: refsAndMentions.rawReferencedMessages,
      rawMentionedChannels: refsAndMentions.rawMentionedChannels,
      rawMentionedRoles: refsAndMentions.rawMentionedRoles,
      rawAuthorDisplayName: displayName,
      rawActiveGuildMemberInfo: guildMemberInfo,
    });

    // Thin payload: kind:'envelope' omits the four fields the worker
    // re-derives from rawAssemblyInputs; legacy keeps them. rawAssemblyInputs is
    // undefined unless CONTEXT_RAW_ENVELOPE=true, so its presence is the
    // envelope-enabled signal. See selectContextVariant.
    const variant = selectContextVariant({
      hasRawEnvelope: rawAssemblyInputs !== undefined,
      fields: { conversationHistory, referencedMessages, mentionedPersonas, referencedChannels },
      logger,
      channelId: message.channel.id,
    });

    // Build complete context
    // Note: userId is the Discord ID (for BYOK resolution)
    // userInternalId is the internal UUID (for usage logging and database operations)
    // discordUsername is used for disambiguation when persona name matches personality name
    // effectiveUser is either overrideUser (slash commands) or message.author (@mentions)
    const context: MessageContext = {
      ...variant, // kind + the re-derivable fields (legacy) or just kind (envelope)
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
      participantGuildInfo, // Guild info for other participants (from extended context) — KEPT (assembler can't re-derive yet)
      attachments,
      extendedContextAttachments, // Images from extended context — KEPT (no envelope source yet)
      environment,
      crossChannelHistory:
        crossChannelGroups !== undefined
          ? mapCrossChannelToApiFormat(crossChannelGroups)
          : undefined,
      // Detect voice messages for TTS voice-only mode
      isVoiceMessage: hasVoiceAttachments(message),
      rawAssemblyInputs,
    };

    logger.debug(
      {
        activePersonaId: context.activePersonaId,
        activePersonaName: context.activePersonaName,
        historyLength: conversationHistory.length,
        referencedMessagesCount: referencedMessages.length,
      },
      'Context built successfully'
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
