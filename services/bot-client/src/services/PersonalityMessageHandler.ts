/**
 * Personality Message Handler
 *
 * Handles the core logic for processing messages directed at AI personalities.
 * Coordinates context building, job submission, and result handling.
 * Used by multiple processors (Reply, Mention, etc.)
 */

import type { Message, SendableChannels } from 'discord.js';
import type { LoadedPersonality } from '@tzurot/common-types';
import { createLogger, isTypingChannel } from '@tzurot/common-types';
import { GatewayClient } from '../utils/GatewayClient.js';
import { JobTracker } from './JobTracker.js';
import { MessageContextBuilder } from './MessageContextBuilder.js';
import { ConversationPersistence } from './ConversationPersistence.js';
import { ReferenceEnrichmentService } from './ReferenceEnrichmentService.js';
import { ExtendedContextResolver } from './ExtendedContextResolver.js';
import { handleNsfwVerification, sendVerificationConfirmation } from '../utils/nsfwVerification.js';

const logger = createLogger('PersonalityMessageHandler');

/**
 * Handles personality message processing
 */
export class PersonalityMessageHandler {
  // eslint-disable-next-line max-params -- Pre-existing: refactor to options object tracked in tech debt
  constructor(
    private readonly gatewayClient: GatewayClient,
    private readonly jobTracker: JobTracker,
    private readonly contextBuilder: MessageContextBuilder,
    private readonly persistence: ConversationPersistence,
    private readonly referenceEnricher: ReferenceEnrichmentService,
    private readonly extendedContextResolver: ExtendedContextResolver
  ) {}

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

      // Handle NSFW verification (auto-verify in NSFW channels, block unverified DMs)
      const verificationResult = await handleNsfwVerification(message, 'PersonalityMessageHandler');
      if (!verificationResult.allowed) {
        return;
      }

      // Show confirmation message on first-time verification (self-destructs after 10s)
      if (verificationResult.wasNewVerification) {
        void sendVerificationConfirmation(channel as SendableChannels);
      }

      // Resolve all extended context settings for this channel + personality
      const extendedContextSettings = await this.extendedContextResolver.resolveAll(
        message.channel.id,
        personality
      );

      if (extendedContextSettings.enabled) {
        logger.debug(
          {
            channelId: message.channel.id,
            personalityId: personality.id,
            maxMessages: extendedContextSettings.maxMessages,
            maxAge: extendedContextSettings.maxAge,
            maxImages: extendedContextSettings.maxImages,
            sources: extendedContextSettings.sources,
          },
          '[PersonalityMessageHandler] Extended context enabled for this request'
        );
      }

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

      // Capture timestamp for chronological ordering
      const userMessageTime = new Date();

      // Submit job to api-gateway (ASYNC PATTERN - returns immediately with jobId)
      // Include trigger message ID for diagnostic lookup
      const { jobId } = await this.gatewayClient.generate(personality, {
        ...context,
        triggerMessageId: message.id,
      });

      // Verify channel type is compatible with JobTracker (TextChannel, DMChannel, or NewsChannel)
      if (!isTypingChannel(channel)) {
        logger.warn(
          { channelType: channel.type },
          '[PersonalityMessageHandler] Unsupported channel type for AI interactions'
        );
        throw new Error('This channel type is not supported for AI interactions');
      }

      // Start typing indicator and store job context (managed by JobTracker)
      // TypeScript knows channel is TextChannel | DMChannel | NewsChannel after type guard
      this.jobTracker.trackJob(jobId, channel, {
        message,
        personality,
        personaId,
        userMessageContent: messageContent,
        userMessageTime,
        isAutoResponse: options.isAutoResponse,
      });

      logger.info(
        {
          jobId,
          personalityName: personality.displayName,
          historyLength: context.conversationHistory?.length ?? 0,
        },
        '[PersonalityMessageHandler] Job submitted successfully, awaiting async result'
      );
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
}
