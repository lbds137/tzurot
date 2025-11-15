/**
 * Message Handler
 *
 * Clean, simple message routing for Discord messages.
 * Routes to either command processing or AI personality responses.
 */

import type { Message } from 'discord.js';
import { GatewayClient } from '../utils/GatewayClient.js';
import { WebhookManager } from '../utils/WebhookManager.js';
import { JobTracker } from '../services/JobTracker.js';
import { DiscordResponseSender } from '../services/DiscordResponseSender.js';
import { MessageContextBuilder } from '../services/MessageContextBuilder.js';
import { ConversationPersistence } from '../services/ConversationPersistence.js';
import {
  PersonalityService,
  UserService,
  preserveCodeBlocks,
  createLogger,
  getConfig,
  CONTENT_TYPES,
} from '@tzurot/common-types';
import type {
  LoadedPersonality,
  ConversationMessage,
  ReferencedMessage,
} from '@tzurot/common-types';
import { getWebhookPersonality, storeVoiceTranscript } from '../redis.js';
import { findPersonalityMention } from '../utils/personalityMentionParser.js';

const logger = createLogger('MessageHandler');

/**
 * Context needed to handle async job results
 */
interface PendingJobContext {
  message: Message;
  personality: LoadedPersonality;
  personaId: string;
  userMessageContent: string;
  userMessageTime: Date;
}

/**
 * Message Handler - routes Discord messages to appropriate handlers
 */
export class MessageHandler {
  private gatewayClient: GatewayClient;
  private jobTracker: JobTracker;
  private responseSender: DiscordResponseSender;
  private contextBuilder: MessageContextBuilder;
  private persistence: ConversationPersistence;
  private personalityService: PersonalityService;
  private userService: UserService;
  private pendingJobs = new Map<string, PendingJobContext>();

  constructor(gatewayClient: GatewayClient, webhookManager: WebhookManager, jobTracker: JobTracker) {
    this.gatewayClient = gatewayClient;
    this.jobTracker = jobTracker;
    this.responseSender = new DiscordResponseSender(webhookManager);
    this.contextBuilder = new MessageContextBuilder();
    this.persistence = new ConversationPersistence();
    this.personalityService = new PersonalityService();
    this.userService = new UserService();
  }

  /**
   * Handle incoming Discord message
   */
  async handleMessage(message: Message): Promise<void> {
    try {
      // Ignore bot messages
      if (message.author.bot) {
        return;
      }

      // Ignore empty messages (but allow attachments without text)
      if (message.content.length === 0 && message.attachments.size === 0) {
        return;
      }

      logger.debug(`[MessageHandler] Processing message from ${message.author.tag}`);

      // Check for voice message auto-transcription (if enabled)
      const config = getConfig();
      const hasVoiceAttachment = message.attachments.some(
        a => a.contentType?.startsWith(CONTENT_TYPES.AUDIO_PREFIX) || a.duration !== null
      );

      // Store voice transcript for voice+personality messages
      let voiceTranscript: string | undefined;

      if (hasVoiceAttachment && config.AUTO_TRANSCRIBE_VOICE === 'true') {
        // ALWAYS transcribe and send transcript as bot first
        logger.debug('[MessageHandler] Auto-transcribing voice message');
        voiceTranscript = await this.handleVoiceTranscription(message);

        // Check if this message ALSO targets a personality
        const isReply = message.reference !== null;
        const mentionCheck = await findPersonalityMention(
          message.content,
          getConfig().BOT_MENTION_CHAR,
          this.personalityService
        );
        const hasMention = mentionCheck !== null || message.mentions.has(message.client.user!);

        if (!isReply && !hasMention) {
          // Voice-only: Transcription already sent, we're done
          return;
        }

        // Voice + personality mention: Continue to personality handler
        // Pass transcript as message content so it's stored in conversation history
        logger.debug(
          '[MessageHandler] Voice message with personality mention - continuing to personality handler with transcript'
        );
      }

      // Check for replies to personality messages (best UX - no @mention needed)
      if (message.reference !== null) {
        const replyResult = await this.handleReply(message, voiceTranscript);
        if (replyResult) {
          return; // Reply was handled
        }
      }

      // Check for personality mentions (e.g., "@personality hello")
      const mentionMatch = await findPersonalityMention(
        message.content,
        getConfig().BOT_MENTION_CHAR,
        this.personalityService
      );

      if (mentionMatch !== null) {
        // Load personality from database (with PersonalityService's cache)
        const personality = await this.personalityService.loadPersonality(
          mentionMatch.personalityName
        );

        if (personality !== null) {
          // For voice messages, use transcript instead of empty cleanContent
          const content = voiceTranscript || mentionMatch.cleanContent;
          await this.handlePersonalityMessage(message, personality, content);
        } else {
          // Silently ignore unknown personality mentions (likely typos or non-bot mentions)
          logger.debug(
            `[MessageHandler] Unknown personality mentioned: ${mentionMatch.personalityName}`
          );
        }
        return;
      }

      // Check for bot mention - use default personality if configured
      if (message.mentions.has(message.client.user!)) {
        const defaultPersonality = await this.personalityService.loadPersonality('default');
        if (defaultPersonality !== null) {
          const cleanContent = message.content.replace(/<@!?\d+>/g, '').trim();
          // For voice messages, use transcript instead of empty cleanContent
          const content = voiceTranscript || cleanContent;
          await this.handlePersonalityMessage(message, defaultPersonality, content);
        }
        return;
      }

      // Commands handled here in the future
      // For now, only respond to explicit mentions
    } catch (error) {
      logger.error({ err: error }, '[MessageHandler] Error processing message');

      // Try to send error message to user
      await message.reply('Sorry, I encountered an error processing your message.').catch(() => {
        // Ignore errors when sending error message
      });
    }
  }

  /**
   * Handle replies to webhook messages
   * Returns true if reply was handled, false otherwise
   */
  private async handleReply(
    message: Message,
    voiceTranscript?: string
  ): Promise<boolean> {
    try {
      // Fetch the message being replied to
      const referencedMessage = await message.channel.messages.fetch(message.reference!.messageId!);

      // Check if it's from a webhook (personality message)
      if (!referencedMessage.webhookId) {
        logger.debug('[MessageHandler] Reply is to a non-webhook message, skipping');
        return false;
      }

      // Check if this webhook belongs to the current bot instance
      // This prevents both dev and prod bots from responding to the same personality webhook
      if (
        referencedMessage.applicationId &&
        referencedMessage.applicationId !== message.client.user!.id
      ) {
        logger.debug(
          `[MessageHandler] Ignoring reply to webhook from different bot instance. Webhook applicationId: ${referencedMessage.applicationId}, Current bot ID: ${message.client.user!.id}`
        );
        return false;
      }

      // Try Redis lookup first
      let personalityName = await getWebhookPersonality(referencedMessage.id);

      // Fallback: Parse webhook username if Redis lookup fails
      if (!personalityName && referencedMessage.author) {
        const webhookUsername = referencedMessage.author.username;
        logger.debug(
          `[MessageHandler] Redis lookup failed, parsing webhook username: ${webhookUsername}`
        );

        // Extract personality name by removing bot suffix
        // Format: "Personality | suffix" -> "Personality"
        if (webhookUsername.includes(' | ')) {
          personalityName = webhookUsername.split(' | ')[0].trim();
          logger.debug(
            `[MessageHandler] Extracted personality name from webhook username: ${personalityName}`
          );
        }
      }

      if (!personalityName) {
        logger.debug('[MessageHandler] No personality found for webhook message, skipping');
        return false;
      }

      // Load the personality
      const personality = await this.personalityService.loadPersonality(personalityName);

      if (!personality) {
        logger.warn(`[MessageHandler] Personality ${personalityName} not found for reply`);
        return false;
      }

      logger.info(`[MessageHandler] Routing reply to ${personality.displayName}`);

      // Handle the message with the personality
      // For voice messages, use the transcript instead of empty message.content
      const content = voiceTranscript || message.content;
      await this.handlePersonalityMessage(message, personality, content);
      return true;
    } catch (error) {
      // If we can't fetch the referenced message, it might be deleted or inaccessible
      logger.debug({ err: error }, '[MessageHandler] Could not fetch referenced message');
      return false;
    }
  }

  /**
   * Handle message directed at a personality
   */
  private async handlePersonalityMessage(
    message: Message,
    personality: LoadedPersonality,
    content: string
  ): Promise<void> {
    try {
      // Build AI context (user lookup, history, references, attachments, environment)
      const buildResult = await this.contextBuilder.buildContext(message, personality, content);
      const { context, personaId, messageContent, referencedMessages, conversationHistory } =
        buildResult;

      // Enrich referenced messages with persona names (requires conversation history)
      if (referencedMessages.length > 0) {
        await this.enrichReferencesWithPersonaNames(
          referencedMessages,
          conversationHistory,
          personality.id
        );

        logger.info(
          {
            count: referencedMessages.length,
            referenceNumbers: referencedMessages.map(r => r.referenceNumber),
            personaNames: referencedMessages.map(r => r.authorDisplayName),
          },
          `[MessageHandler] Enriched ${referencedMessages.length} referenced messages with persona names`
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
      const { jobId } = await this.gatewayClient.generate(personality, context);

      // Store pending job context for when result arrives via Redis Stream
      this.pendingJobs.set(jobId, {
        message,
        personality,
        personaId,
        userMessageContent: messageContent,
        userMessageTime,
      });

      // Start typing indicator (managed by JobTracker until result arrives)
      this.jobTracker.trackJob(jobId, message.channel as any);

      logger.info(
        {
          jobId,
          personalityName: personality.displayName,
          historyLength: context.conversationHistory?.length || 0,
        },
        '[MessageHandler] Job submitted successfully, awaiting async result'
      );
    } catch (error) {
      logger.error({ err: error }, '[MessageHandler] Error handling personality message');

      const errorMessage = error instanceof Error ? error.message : String(error);
      await message.reply(`Error: ${errorMessage}`).catch(() => {});
    }
  }

  /**
   * Handle voice message transcription
   * Sends transcription job to api-gateway and replies with chunked transcript
   * Returns the transcript text for potential caching
   */
  private async handleVoiceTranscription(message: Message): Promise<string | undefined> {
    try {
      // Show typing indicator (if channel supports it)
      if ('sendTyping' in message.channel) {
        await message.channel.sendTyping();
      }

      // Extract voice attachment metadata
      const attachments = Array.from(message.attachments.values()).map(attachment => ({
        url: attachment.url,
        contentType: attachment.contentType || CONTENT_TYPES.BINARY,
        name: attachment.name,
        size: attachment.size,
        isVoiceMessage: attachment.duration !== null,
        duration: attachment.duration ?? undefined,
        waveform: attachment.waveform ?? undefined,
      }));

      // Send transcribe job to api-gateway
      const response = await this.gatewayClient.transcribe(attachments);

      if (!response || !response.content) {
        throw new Error('No transcript returned from transcription service');
      }

      // Chunk the transcript (respecting 2000 char Discord limit)
      const chunks = preserveCodeBlocks(response.content);

      logger.info(
        `[MessageHandler] Transcription complete: ${response.content.length} chars, ${chunks.length} chunks`
      );

      // Send each chunk as a reply (these will appear BEFORE personality webhook response)
      for (const chunk of chunks) {
        await message.reply(chunk);
      }

      // Cache transcript in Redis to avoid re-transcribing if this voice message also targets a personality
      // Key by attachment URL with 5 min TTL (long enough for personality processing)
      const voiceAttachment = attachments[0]; // We know there's at least one
      if (voiceAttachment) {
        await storeVoiceTranscript(voiceAttachment.url, response.content);
        logger.debug(
          `[MessageHandler] Cached transcript for attachment: ${voiceAttachment.url.substring(0, 50)}...`
        );
      }

      return response.content;
    } catch (error) {
      logger.error({ err: error }, '[MessageHandler] Error transcribing voice message');
      await message.reply("Sorry, I couldn't transcribe that voice message.").catch(() => {});
      return undefined;
    }
  }

  /**
   * Enrich referenced messages with persona names instead of Discord display names
   *
   * For each referenced message:
   * 1. Look up the user's persona for the current personality
   * 2. Check if that persona appears in conversation history
   * 3. If yes, use persona name from history; if no, fetch from database
   * 4. Update the authorDisplayName field
   *
   * **Conversation History Stability Assumption**:
   * This method receives a snapshot of conversation history at the time of the message
   * processing cycle. We assume that conversation history remains stable during a single
   * message processing cycle (typically <1 second). If conversation history is modified
   * elsewhere during processing, the persona name Map could be stale. However, this is
   * unlikely in practice since:
   * - Message processing is synchronous for a given channel
   * - Conversation history updates happen after AI response generation
   * - Reference extraction and enrichment occur before any history updates
   *
   * In the rare case of stale history, the worst outcome is fetching from the database
   * instead of using the cached name - no data corruption occurs.
   */
  private async enrichReferencesWithPersonaNames(
    referencedMessages: ReferencedMessage[],
    conversationHistory: ConversationMessage[],
    personalityId: string
  ): Promise<void> {
    // Build a map of personaId -> personaName from conversation history for fast lookup
    const personaNameMap = new Map<string, string>();
    for (const msg of conversationHistory) {
      if (msg.personaName) {
        personaNameMap.set(msg.personaId, msg.personaName);
      }
    }

    // Enrich each referenced message
    for (const reference of referencedMessages) {
      let userId: string | undefined;
      let personaId: string | undefined;

      try {
        // Check if this is a webhook message using dual detection:
        // 1. Redis cache: Stores bot's own webhooks with 7-day TTL (fast lookup for recent messages)
        // 2. Discord webhookId: Catches PluralKit, expired cache, cross-channel refs, or other bot instances
        // Skip persona creation for ALL webhooks (AI personalities, PluralKit, etc.)
        // We'll handle PluralKit personas properly when we implement that feature
        let webhookPersonality = null;
        try {
          webhookPersonality = await getWebhookPersonality(reference.discordMessageId);
        } catch (error) {
          logger.warn(
            { err: error, discordMessageId: reference.discordMessageId },
            '[MessageHandler] Redis lookup failed for webhook detection, falling back to webhookId'
          );
        }
        const isWebhook = webhookPersonality || reference.webhookId;

        if (isWebhook) {
          logger.debug(
            {
              referenceNumber: reference.referenceNumber,
              webhookId: reference.webhookId,
              cachedPersonality: webhookPersonality,
              authorDisplayName: reference.authorDisplayName,
            },
            '[MessageHandler] Skipping persona enrichment - message is from webhook'
          );
          continue; // Skip this reference, keep original display name
        }

        // Get or create the user record (creates default persona if needed)
        // Use the actual Discord display name from the reference (includes server nickname/global display name)
        userId = await this.userService.getOrCreateUser(
          reference.discordUserId,
          reference.authorUsername,
          reference.authorDisplayName // Preserve actual Discord display name in user record
        );

        // Get the persona for this user when interacting with this personality
        personaId = await this.userService.getPersonaForUser(userId, personalityId);

        // Check if this persona appears in conversation history
        let personaName = personaNameMap.get(personaId);

        if (!personaName) {
          // Not in history, fetch from database
          // Note: Convert null to undefined for TypeScript type compatibility
          // (Map returns string | undefined, getPersonaName returns string | null)
          personaName = (await this.userService.getPersonaName(personaId)) ?? undefined;
        }

        // Update the authorDisplayName with the persona name
        if (personaName) {
          reference.authorDisplayName = personaName;
          logger.debug(
            `[MessageHandler] Enriched reference ${reference.referenceNumber}: ${reference.authorUsername} -> ${personaName}`
          );
        } else {
          logger.warn(
            `[MessageHandler] Could not find persona name for reference ${reference.referenceNumber} (persona: ${personaId})`
          );
        }
      } catch (error) {
        logger.error(
          {
            err: error,
            referenceNumber: reference.referenceNumber,
            discordUserId: reference.discordUserId,
            authorUsername: reference.authorUsername,
            personalityId,
            userId: userId || 'unknown',
            personaId: personaId || 'unknown',
          },
          '[MessageHandler] Failed to enrich reference with persona name'
        );
        // Keep the original Discord display name on error
      }
    }
  }

  /**
   * Handle async job result when it arrives from ResultsListener
   * This is called from index.ts result handler
   */
  async handleJobResult(jobId: string, result: any): Promise<void> {
    // Get pending job context
    const jobContext = this.pendingJobs.get(jobId);
    if (!jobContext) {
      logger.warn({ jobId }, '[MessageHandler] Received result for unknown job - ignoring');
      return;
    }

    this.pendingJobs.delete(jobId);

    const { message, personality, personaId, userMessageContent, userMessageTime } = jobContext;

    try {
      // Upgrade user message from placeholders to rich descriptions
      await this.persistence.updateUserMessage(
        message,
        personality,
        personaId,
        userMessageContent,
        result.attachmentDescriptions,
        result.referencedMessagesDescriptions
      );

      // Send AI response to Discord
      const { chunkMessageIds } = await this.responseSender.sendResponse({
        content: result.content,
        personality,
        message,
        modelUsed: result.metadata?.modelUsed,
      });

      // Save assistant message to conversation history
      await this.persistence.saveAssistantMessage({
        message,
        personality,
        personaId,
        content: result.content,
        chunkMessageIds,
        userMessageTime,
      });

      logger.info(
        { jobId, chunks: chunkMessageIds.length },
        '[MessageHandler] Async job result delivered successfully'
      );
    } catch (error) {
      logger.error({ err: error, jobId }, '[MessageHandler] Error handling job result');
      throw error;
    }
  }
}
