/**
 * Message Context Builder
 *
 * Builds AI context from Discord messages.
 * Helper modules extracted to contextBuilder/ subdirectory.
 */

import { MESSAGE_LIMITS } from '@tzurot/common-types/constants/message';
import { type ConversationMessage } from '@tzurot/common-types/types/conversationMessage';
import { isTypingChannel } from '@tzurot/common-types/types/discord-types';
import { type LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { Message } from 'discord.js';
import type { ServiceClient } from '@tzurot/clients';
import type { MessageContext } from '../types.js';
import { extractDiscordEnvironment } from '../utils/discordContext.js';
import { buildMessageContent } from '../utils/MessageContentBuilder.js';
import { buildBlockDeniedChecker } from './contextBuilder/blockDeniedChecker.js';
import { hasVoiceAttachments } from '../utils/forwardedMessageUtils.js';
import { MentionResolver } from './MentionResolver.js';
import { DiscordChannelFetcher, type FetchableChannel } from './DiscordChannelFetcher.js';
import { deriveBotSuffix } from '../utils/webhookNaming.js';
import { redisService } from '../redis.js';
import type { DenylistCache } from './DenylistCache.js';
import { TranscriptRetriever } from '../handlers/references/TranscriptRetriever.js';
import {
  extractGuildMemberInfo,
  resolveEffectiveMember,
  resolveUserContext,
} from './contextBuilder/index.js';
import type { ContextBuildOptions } from './contextBuilder/ContextBuildOptions.js';
import {
  buildRawAssemblyInputs,
  captureRawExtendedContext,
  type RawExtendedContextSnapshot,
} from './contextBuilder/RawEnvelopeBuilder.js';
import {
  extractReferencesAndMentions,
  type ReferencesAndMentionsResult,
} from './contextBuilder/ReferenceExtractor.js';

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
}

/** Result of fetching extended context from Discord */
interface ExtendedContextResult {
  history: ConversationMessage[];
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
  private mentionResolver: MentionResolver;
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
    private serviceClient: ServiceClient,
    denylistCache?: DenylistCache
  ) {
    // MentionResolver is now a stateless guild-cache rewriter (channel/role only);
    // user→persona resolution moved worker-side, so no Prisma/PersonaResolver here.
    this.mentionResolver = new MentionResolver();
    this.channelFetcher = new DiscordChannelFetcher();
    this.transcriptRetriever = new TranscriptRetriever();
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

  private async fetchExtendedContext(
    params: ExtendedContextParams
  ): Promise<ExtendedContextResult> {
    const { message, personality, history, contextEpoch, options } = params;
    let mergedHistory = history;

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
        // Chat mode anchors on the user's NEW message and reads the history
        // BEFORE it. Weigh-in ("read the room") anchors on the latest existing
        // message, which IS part of the room — so it must be INCLUDED, not
        // excluded. Omitting `before` fetches the most recent N (anchor and all).
        before: options.isWeighInMode === true ? undefined : message.id,
        botUserId: options.botUserId,
        botSuffix: this.getBotSuffix(message),
        personalityName: personality.displayName,
        personalityId: personality.id,
        getTranscript: (discordMessageId, attachmentUrl) =>
          this.transcriptRetriever.retrieveTranscript(discordMessageId, attachmentUrl),
        getOurPersonalityId: (discordMessageId: string) =>
          redisService.getWebhookPersonality(discordMessageId),
        contextEpoch,
        maxAge: options.extendedContext.maxAge,
        isBlockDenied: buildBlockDeniedChecker(this.denylistCache, message, personality.id),
      }
    );

    // Capture the raw envelope snapshot of the fetched messages for the worker
    // (which re-derives persona ids, guild info, and image attachments from it).
    const rawSnapshot = captureRawExtendedContext(fetchResult);

    // Extended-context users/reactors are NOT provisioned or persona-resolved
    // here — the worker re-runs the batch upsert + persona remap from the raw
    // snapshot (ContextAssembler.mergeExtendedContext) and re-derives guild info +
    // image attachments from it, so bot-client ships neither. bot-client's local
    // merged history keeps the raw author placeholders; only message ids +
    // timestamps feed the reference-dedup that still reads it.

    if (fetchResult.messages.length === 0) {
      return { history: mergedHistory, raw: rawSnapshot };
    }

    // Merge Discord messages with DB history
    mergedHistory = this.channelFetcher.mergeWithHistory(fetchResult.messages, history);

    logger.info(
      {
        channelId: message.channel.id,
        discordMessages: fetchResult.keptCount,
        dbMessages: history.length,
        totalMerged: mergedHistory.length,
      },
      'Extended context merged with conversation history'
    );

    // Opportunistic sync (fire and forget)
    // This is idempotent and safe for concurrent execution:
    // - Only updates EXISTING messages (no creates = no duplicate writes)
    // - Updates are idempotent (set content to X, set content to X again = same result)
    // - Deletes use soft-delete with timestamps (concurrent deletes are harmless)
    if (fetchResult.rawMessages) {
      this.channelFetcher
        .syncWithDatabase(fetchResult.rawMessages, message.channel.id, personality.id)
        .catch(err => {
          logger.warn(
            { err, channelId: message.channel.id },
            'Opportunistic sync failed (non-blocking)'
          );
        });
    }

    return { history: mergedHistory, raw: rawSnapshot };
  }

  /** Extract referenced messages and resolve mentions - delegates to ReferenceExtractor */
  private async extractRefsAndMentions(opts: {
    message: Message;
    content: string;
    history: ConversationMessage[];
    isWeighInMode?: boolean;
    maxReferences?: number;
  }): Promise<ReferencesAndMentionsResult> {
    return extractReferencesAndMentions({
      mentionResolver: this.mentionResolver,
      message: opts.message,
      content: opts.content,
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
      { serviceClient: this.serviceClient }
    );
    const { internalUserId, discordUserId, personaId, personaName, userTimezone } = userContext;
    // An incognito (anonymous) summon must NOT bound the shared channel history
    // by the invoking user's persona-scoped STM-reset epoch (a recent
    // /conversation reset would otherwise silently truncate it). A personal
    // summon keeps the epoch. Mirror of the worker-side
    // ContextAssembler.resolvePersonaContext incognito handling.
    const contextEpoch =
      (options.incognito ?? options.isWeighInMode) === true ? undefined : userContext.contextEpoch;

    // Step 3: Fetch extended context from Discord (if enabled).
    // bot-client no longer reads channel history from Postgres — the worker's
    // ContextAssembler re-fetches and re-merges it from the thin envelope. The
    // base history passed here is empty: it now feeds ONLY the local
    // reference-dedup, whose output is vestigial — the shipped rawReferences +
    // rewritten content are dedup-invariant (locked by
    // MessageReferenceExtractor.test.ts), and the Discord fetch's raw snapshot
    // (the only reference data that ships) is captured independently of it.
    const extendedContext = await this.fetchExtendedContext({
      message,
      personality,
      history: [],
      contextEpoch,
      options,
    });
    const history = extendedContext.history;

    // Cross-channel history is re-derived worker-side (ContextAssembler queries
    // the DB + gates on the persona/incognito state itself). bot-client only
    // ships the cached channel-environment names (via rawAssemblyInputs) so the
    // worker can decorate its groups — see buildKnownChannelEnvironments.

    // Step 4: Extract references and resolve mentions
    // maxReferences shares the same budget as maxMessages (no additive surprise)
    const refsAndMentions = await this.extractRefsAndMentions({
      message,
      content,
      history,
      isWeighInMode: options.isWeighInMode,
      maxReferences: options.extendedContext?.maxMessages,
    });
    const { messageContent, referencedMessages } = refsAndMentions;

    // Step 5: Convert conversation history to API format
    // Include messageMetadata so referenced messages can be formatted at prompt time
    // Include tokenCount for accurate token budget calculations (avoids chars/4 fallback)
    // Extract attachments using unified buildMessageContent
    // This ensures forwarded message snapshot attachments are included (DRY principle)
    // Voice transcripts are handled upstream (passed in via content parameter)
    const { attachments: allAttachments } = await buildMessageContent(message, {
      includeEmbeds: false, // Embeds parsed by reference extraction, not needed here
      includeAttachments: false, // We only need attachment metadata, not text descriptions
    });

    // Raw-envelope assembly inputs: the Discord-origin source the worker's
    // ContextAssembler re-derives the whole message context from. Always built.
    const rawAssemblyInputs = buildRawAssemblyInputs(message, extendedContext.raw, {
      rawReferencedMessages: refsAndMentions.rawReferencedMessages,
      rawMentionedChannels: refsAndMentions.rawMentionedChannels,
      rawMentionedRoles: refsAndMentions.rawMentionedRoles,
      rawAuthorDisplayName: displayName,
      rawActiveGuildMemberInfo: guildMemberInfo,
    });

    // Thin envelope is the only payload shape: kind:'envelope' carries none of
    // the re-derivable fields (conversationHistory, referencedMessages,
    // mentions, the guild/attachment surfaces) — the worker assembles them all
    // from rawAssemblyInputs.
    const variant = { kind: 'envelope' as const };

    // Build complete context
    // Note: userId is the Discord ID (for BYOK resolution)
    // userInternalId is the internal UUID (for usage logging and database operations)
    // discordUsername is used for disambiguation when persona name matches personality name
    // effectiveUser is either overrideUser (slash commands) or message.author (@mentions)
    const context: MessageContext = {
      // Just kind:'envelope' — the re-derivable fields never ship; the worker
      // assembles them from rawAssemblyInputs below.
      ...variant,
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
      attachments: allAttachments.length > 0 ? allAttachments : undefined,
      environment: extractDiscordEnvironment(message),
      // crossChannelHistory is absent: the worker assembles cross-channel groups
      // itself (ContextAssembler.assembleCrossChannel queries the DB directly).
      // Detect voice messages for TTS voice-only mode
      isVoiceMessage: hasVoiceAttachments(message),
      rawAssemblyInputs,
    };

    logger.debug(
      {
        activePersonaId: context.activePersonaId,
        activePersonaName: context.activePersonaName,
        historyLength: history.length,
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
    };
  }
}
