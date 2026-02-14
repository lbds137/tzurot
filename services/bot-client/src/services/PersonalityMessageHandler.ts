/**
 * Personality Message Handler
 *
 * Handles the core logic for processing messages directed at AI personalities.
 * Coordinates context building, job submission, and result handling.
 * Used by multiple processors (Reply, Mention, etc.)
 */

import type { Message, SendableChannels } from 'discord.js';
import type { LoadedPersonality, ConfigResolutionResult } from '@tzurot/common-types';
import { createLogger, isBotOwner, isTypingChannel, MESSAGE_LIMITS } from '@tzurot/common-types';
import { GatewayClient } from '../utils/GatewayClient.js';
import { callGatewayApi, GATEWAY_TIMEOUTS } from '../utils/userGatewayClient.js';
import { JobTracker } from './JobTracker.js';
import { MessageContextBuilder } from './MessageContextBuilder.js';
import { ConversationPersistence } from './ConversationPersistence.js';
import { ReferenceEnrichmentService } from './ReferenceEnrichmentService.js';
import { handleNsfwVerification, sendVerificationConfirmation } from '../utils/nsfwVerification.js';
import type { MessageContext } from '../types.js';
import type { DenylistCache } from './DenylistCache.js';

const logger = createLogger('PersonalityMessageHandler');

export interface PersonalityMessageHandlerDeps {
  gatewayClient: GatewayClient;
  jobTracker: JobTracker;
  contextBuilder: MessageContextBuilder;
  persistence: ConversationPersistence;
  referenceEnricher: ReferenceEnrichmentService;
  denylistCache?: DenylistCache;
}

/**
 * Handles personality message processing
 */
export class PersonalityMessageHandler {
  private readonly gatewayClient: GatewayClient;
  private readonly jobTracker: JobTracker;
  private readonly contextBuilder: MessageContextBuilder;
  private readonly persistence: ConversationPersistence;
  private readonly referenceEnricher: ReferenceEnrichmentService;
  private readonly denylistCache?: DenylistCache;

  constructor(deps: PersonalityMessageHandlerDeps) {
    this.gatewayClient = deps.gatewayClient;
    this.jobTracker = deps.jobTracker;
    this.contextBuilder = deps.contextBuilder;
    this.persistence = deps.persistence;
    this.referenceEnricher = deps.referenceEnricher;
    this.denylistCache = deps.denylistCache;
  }

  /**
   * Resolve LLM config from gateway, applying user overrides.
   * Falls back to personality defaults on error.
   */
  private async resolveConfig(
    userId: string,
    personality: LoadedPersonality
  ): Promise<ConfigResolutionResult> {
    const result = await callGatewayApi<ConfigResolutionResult>('/user/llm-config/resolve', {
      method: 'POST',
      userId,
      body: {
        personalityId: personality.id,
        personalityConfig: personality,
      },
      timeout: GATEWAY_TIMEOUTS.AUTOCOMPLETE, // Fast timeout for pre-processing step
    });

    if (!result.ok) {
      logger.warn(
        { userId, personalityId: personality.id, error: result.error },
        '[PersonalityMessageHandler] Failed to resolve config, using personality defaults'
      );
      // Fall back to personality defaults with hardcoded fallbacks for safety
      // These ensure valid values even if personality has no config
      return {
        config: {
          model: personality.model,
          maxMessages: personality.maxMessages ?? MESSAGE_LIMITS.DEFAULT_MAX_MESSAGES,
          maxAge: personality.maxAge ?? null,
          maxImages: personality.maxImages ?? MESSAGE_LIMITS.DEFAULT_MAX_IMAGES,
        },
        source: 'personality',
      };
    }

    return result.data;
  }

  /**
   * Build extended context settings from resolved config.
   * Extended context is always enabled — these settings control the limits.
   */
  private buildExtendedContextSettings(
    _personality: LoadedPersonality,
    resolvedConfig: ConfigResolutionResult
  ): {
    maxMessages: number;
    maxAge: number | null;
    maxImages: number;
    sources: {
      maxMessages: 'personality' | 'user-personality' | 'user-default';
      maxAge: 'personality' | 'user-personality' | 'user-default';
      maxImages: 'personality' | 'user-personality' | 'user-default';
    };
  } {
    const { config, source } = resolvedConfig;
    return {
      maxMessages: config.maxMessages ?? MESSAGE_LIMITS.DEFAULT_MAX_MESSAGES,
      maxAge: config.maxAge ?? null,
      maxImages: config.maxImages ?? 10,
      sources: {
        maxMessages: source,
        maxAge: source,
        maxImages: source,
      },
    };
  }

  /**
   * Handle a message directed at a personality
   *
   * @param message - Discord message
   * @param personality - Target personality
   * @param content - Message content (may be voice transcript)
   * @param options - Additional options
   * @param options.isAutoResponse - If true, this is an auto-response from channel activation
   */
  async handleMessage(
    message: Message,
    personality: LoadedPersonality,
    content: string,
    options: { isAutoResponse?: boolean } = {}
  ): Promise<void> {
    try {
      const { channel } = message;

      // Check personality-scoped denial (silent deny)
      if (
        this.denylistCache !== undefined &&
        !isBotOwner(message.author.id) &&
        this.denylistCache.isPersonalityDenied(message.author.id, personality.id)
      ) {
        logger.debug(
          { userId: message.author.id, personalityId: personality.id },
          '[PersonalityMessageHandler] User denied for this personality, ignoring'
        );
        return;
      }

      // Handle NSFW verification (auto-verify in NSFW channels, block unverified DMs)
      const verificationResult = await handleNsfwVerification(message, 'PersonalityMessageHandler');
      if (!verificationResult.allowed) {
        return;
      }

      // Show confirmation message on first-time verification (self-destructs after 10s)
      if (verificationResult.wasNewVerification) {
        void sendVerificationConfirmation(channel as SendableChannels);
      }

      // Resolve LLM config from gateway (applies user overrides for context settings)
      const resolvedConfig = await this.resolveConfig(message.author.id, personality);

      // Build extended context settings from resolved config
      const extendedContextSettings = this.buildExtendedContextSettings(
        personality,
        resolvedConfig
      );

      logger.debug(
        {
          channelId: message.channel.id,
          personalityId: personality.id,
          maxMessages: extendedContextSettings.maxMessages,
          maxAge: extendedContextSettings.maxAge,
          maxImages: extendedContextSettings.maxImages,
          sources: extendedContextSettings.sources,
        },
        '[PersonalityMessageHandler] Extended context settings for this request'
      );

      // Build AI context (user lookup, history, references, attachments, environment)
      // Pass extended context settings to enable Discord channel message fetching
      // Get bot user ID from the message's client (available after login)
      const botUserId = message.client.user?.id;
      const buildResult = await this.contextBuilder.buildContext(message, personality, content, {
        extendedContext: extendedContextSettings,
        botUserId,
      });
      const { context, personaId, messageContent, referencedMessages, conversationHistory } =
        buildResult;

      // Enrich referenced messages with persona names (requires conversation history)
      if (referencedMessages.length > 0) {
        await this.referenceEnricher.enrichWithPersonaNames(
          referencedMessages,
          conversationHistory,
          personality.id
        );
      }

      // Save user message with placeholder descriptions (BEFORE AI processing)
      await this.persistence.saveUserMessage({
        message,
        personality,
        personaId,
        messageContent,
        attachments: context.attachments,
        referencedMessages: context.referencedMessages,
      });

      // Submit job and start tracking
      await this.submitAndTrackJob(message, personality, context, {
        personaId,
        messageContent,
        isAutoResponse: options.isAutoResponse,
      });
    } catch (error) {
      logger.error(
        { err: error },
        '[PersonalityMessageHandler] Error handling personality message'
      );

      const errorMessage = error instanceof Error ? error.message : String(error);
      await message.reply(`Error: ${errorMessage}`).catch(replyError => {
        logger.warn(
          { err: replyError, messageId: message.id },
          '[PersonalityMessageHandler] Failed to send error message to user'
        );
      });
    }
  }

  /** Submit AI job to gateway and start typing/tracking */
  private async submitAndTrackJob(
    message: Message,
    personality: LoadedPersonality,
    context: MessageContext,
    jobMeta: { personaId: string; messageContent: string; isAutoResponse?: boolean }
  ): Promise<void> {
    const userMessageTime = new Date();
    const { channel } = message;

    const { jobId } = await this.gatewayClient.generate(personality, {
      ...context,
      triggerMessageId: message.id,
    });

    if (!isTypingChannel(channel)) {
      logger.warn(
        { channelType: channel.type },
        '[PersonalityMessageHandler] Unsupported channel type for AI interactions'
      );
      throw new Error('This channel type is not supported for AI interactions');
    }

    this.jobTracker.trackJob(jobId, channel, {
      message,
      personality,
      personaId: jobMeta.personaId,
      userMessageContent: jobMeta.messageContent,
      userMessageTime,
      isAutoResponse: jobMeta.isAutoResponse,
    });

    logger.info(
      {
        jobId,
        personalityName: personality.displayName,
        historyLength: context.conversationHistory?.length ?? 0,
      },
      '[PersonalityMessageHandler] Job submitted successfully, awaiting async result'
    );
  }
}
