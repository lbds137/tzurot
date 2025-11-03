/**
 * Message Handler
 *
 * Clean, simple message routing for Discord messages.
 * Routes to either command processing or AI personality responses.
 */

import type { Message } from 'discord.js';
import { TextChannel, ThreadChannel } from 'discord.js';
import { GatewayClient } from '../gateway/GatewayClient.js';
import { WebhookManager } from '../webhooks/WebhookManager.js';
import { ConversationHistoryService, PersonalityService, UserService, preserveCodeBlocks, createLogger, getConfig, INTERVALS } from '@tzurot/common-types';
import type { LoadedPersonality } from '@tzurot/common-types';
import type { MessageContext } from '../types.js';
import { storeWebhookMessage, getWebhookPersonality, storeVoiceTranscript } from '../redis.js';
import { extractDiscordEnvironment } from '../utils/discordContext.js';
import { findPersonalityMention } from '../utils/personalityMentionParser.js';
import { MessageReferenceExtractor } from '../context/MessageReferenceExtractor.js';
import { extractAttachments } from '../utils/attachmentExtractor.js';
import { formatReferencesForDatabase } from '../utils/referenceFormatter.js';

const logger = createLogger('MessageHandler');

/**
 * Message Handler - routes Discord messages to appropriate handlers
 */
export class MessageHandler {
  private gatewayClient: GatewayClient;
  private webhookManager: WebhookManager;
  private conversationHistory: ConversationHistoryService;
  private personalityService: PersonalityService;
  private userService: UserService;

  constructor(
    gatewayClient: GatewayClient,
    webhookManager: WebhookManager
  ) {
    this.gatewayClient = gatewayClient;
    this.webhookManager = webhookManager;
    this.conversationHistory = new ConversationHistoryService();
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
      const hasVoiceAttachment = message.attachments.some(a =>
        a.contentType?.startsWith('audio/') || a.duration !== null
      );

      if (hasVoiceAttachment && config.AUTO_TRANSCRIBE_VOICE === 'true') {
        // ALWAYS transcribe and send transcript as bot first
        logger.debug('[MessageHandler] Auto-transcribing voice message');
        await this.handleVoiceTranscription(message);

        // Check if this message ALSO targets a personality
        const isReply = message.reference !== null;
        const mentionCheck = await findPersonalityMention(message.content, getConfig().BOT_MENTION_CHAR, this.personalityService);
        const hasMention = mentionCheck !== null || message.mentions.has(message.client.user!);

        if (!isReply && !hasMention) {
          // Voice-only: Transcription already sent, we're done
          return;
        }

        // Voice + personality mention: Continue to personality handler
        // The transcript will be included in the attachment descriptions
        logger.debug('[MessageHandler] Voice message with personality mention - continuing to personality handler');
      }

      // Check for replies to personality messages (best UX - no @mention needed)
      if (message.reference !== null) {
        const replyResult = await this.handleReply(message);
        if (replyResult) {
          return; // Reply was handled
        }
      }

      // Check for personality mentions (e.g., "@personality hello")
      const mentionMatch = await findPersonalityMention(message.content, getConfig().BOT_MENTION_CHAR, this.personalityService);

      if (mentionMatch !== null) {
        // Load personality from database (with PersonalityService's cache)
        const personality = await this.personalityService.loadPersonality(mentionMatch.personalityName);

        if (personality !== null) {
          await this.handlePersonalityMessage(message, personality, mentionMatch.cleanContent);
        } else {
          // Silently ignore unknown personality mentions (likely typos or non-bot mentions)
          logger.debug(`[MessageHandler] Unknown personality mentioned: ${mentionMatch.personalityName}`);
        }
        return;
      }

      // Check for bot mention - use default personality if configured
      if (message.mentions.has(message.client.user!)) {
        const defaultPersonality = await this.personalityService.loadPersonality('default');
        if (defaultPersonality !== null) {
          const cleanContent = message.content.replace(/<@!?\d+>/g, '').trim();
          await this.handlePersonalityMessage(message, defaultPersonality, cleanContent);
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
  private async handleReply(message: Message): Promise<boolean> {
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
      if (referencedMessage.applicationId && referencedMessage.applicationId !== message.client.user!.id) {
        logger.debug(`[MessageHandler] Ignoring reply to webhook from different bot instance. Webhook applicationId: ${referencedMessage.applicationId}, Current bot ID: ${message.client.user!.id}`);
        return false;
      }

      // Try Redis lookup first
      let personalityName = await getWebhookPersonality(referencedMessage.id);

      // Fallback: Parse webhook username if Redis lookup fails
      if (!personalityName && referencedMessage.author) {
        const webhookUsername = referencedMessage.author.username;
        logger.debug(`[MessageHandler] Redis lookup failed, parsing webhook username: ${webhookUsername}`);

        // Extract personality name by removing bot suffix
        // Format: "Personality | suffix" -> "Personality"
        if (webhookUsername.includes(' | ')) {
          personalityName = webhookUsername.split(' | ')[0].trim();
          logger.debug(`[MessageHandler] Extracted personality name from webhook username: ${personalityName}`);
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
      await this.handlePersonalityMessage(message, personality, message.content);
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
    let typingInterval: NodeJS.Timeout | null = null;

    try {
      // Start typing indicator and keep it active until response is ready
      // Discord's typing indicator lasts ~10 seconds, so refresh every 8 seconds
      if ('sendTyping' in message.channel) {
        await message.channel.sendTyping();
        typingInterval = setInterval(async () => {
          try {
            if ('sendTyping' in message.channel) {
              await message.channel.sendTyping();
            }
          } catch (error) {
            // Channel might be deleted or inaccessible - stop trying
            logger.debug({ err: error }, '[MessageHandler] Typing indicator error, clearing interval');
            if (typingInterval) {
              clearInterval(typingInterval);
              typingInterval = null;
            }
          }
        }, INTERVALS.TYPING_INDICATOR_REFRESH);
      }

      // Get or create user record FIRST (needed for conversation history query)
      // Use display name: server nickname > global display name > username
      const displayName = message.member?.displayName || message.author.globalName || message.author.username;

      // Note: Discord API doesn't expose user bios to bots (privacy restriction)
      // Bio parameter left undefined, so persona content will be empty
      const userId = await this.userService.getOrCreateUser(
        message.author.id,
        message.author.username,
        displayName
      );

      // Get the persona for this user + personality combination
      const personaId = await this.userService.getPersonaForUser(userId, personality.id);
      const personaName = await this.userService.getPersonaName(personaId);

      logger.debug(`[MessageHandler] User persona lookup: personaId=${personaId}, personaName=${personaName}, userId=${userId}, personalityId=${personality.id}`);

      // Get conversation history from PostgreSQL (needed for reference deduplication)
      const historyLimit = personality.contextWindow || 20;
      const history = await this.conversationHistory.getRecentHistory(
        message.channel.id,
        personality.id,
        historyLimit
      );

      // Extract Discord message IDs and time range for deduplication
      const conversationHistoryMessageIds = history
        .map(msg => msg.discordMessageId)
        .filter((id): id is string => id !== undefined);

      const conversationHistoryTimeRange = history.length > 0 ? {
        oldest: history[0].createdAt,
        newest: history[history.length - 1].createdAt
      } : undefined;

      // Extract referenced messages (from replies and message links)
      // This waits 2-3 seconds for Discord to process embeds
      // Uses conversation history for deduplication
      // Also replaces Discord message links with [Reference N] placeholders
      logger.debug('[MessageHandler] Extracting referenced messages with deduplication and link replacement');
      const referenceExtractor = new MessageReferenceExtractor({
        maxReferences: 10,
        embedProcessingDelayMs: 2500, // 2.5 seconds to allow Discord to process embeds
        conversationHistoryMessageIds,
        conversationHistoryTimeRange
      });
      const { references: referencedMessages, updatedContent } = await referenceExtractor.extractReferencesWithReplacement(message);

      if (referencedMessages.length > 0) {
        logger.info({
          count: referencedMessages.length,
          referenceNumbers: referencedMessages.map(r => r.referenceNumber),
          authors: referencedMessages.map(r => r.authorUsername)
        }, `[MessageHandler] Extracted ${referencedMessages.length} referenced messages (after deduplication)`);
      }

      // Use updatedContent (with Discord links replaced by [Reference N]) for the AI context
      // Use nullish coalescing to preserve empty strings (e.g., message with only a link)
      const messageContentForAI = updatedContent ?? content ?? '[no text content]';

      // Convert to format expected by AI gateway
      // Include persona info so AI knows which persona is speaking in each message
      const conversationHistory = history.map(msg => ({
        id: msg.id, // Include UUID for deduplication in LTM
        role: msg.role,
        content: msg.content,
        createdAt: msg.createdAt.toISOString(), // Include timestamp for context
        personaId: msg.personaId,
        personaName: msg.personaName // Persona's name for context
      }));

      // Debug: check how many messages have personaName
      const messagesWithPersonaName = conversationHistory.filter(m => m.personaName).length;
      logger.debug(`[MessageHandler] Conversation history: ${conversationHistory.length} messages, ${messagesWithPersonaName} have personaName`);

      // Extract attachments if present (images, audio, etc)
      const attachments = extractAttachments(message.attachments);

      // Extract Discord environment context (DM vs guild, channel info, etc)
      const environment = extractDiscordEnvironment(message);

      // Build context with conversation history, attachments, and referenced messages
      const context: MessageContext = {
        userId: userId, // Use database UUID, not Discord ID
        userName: message.author.username,
        channelId: message.channel.id,
        serverId: message.guild?.id,
        messageContent: messageContentForAI, // Use content with links replaced by [Reference N]
        activePersonaId: personaId, // Current speaker's persona
        activePersonaName: personaName || undefined,
        conversationHistory,
        attachments,
        environment,
        referencedMessages: referencedMessages.length > 0 ? referencedMessages : undefined
      };

      logger.debug({
        activePersonaId: context.activePersonaId,
        activePersonaName: context.activePersonaName,
        historyLength: conversationHistory.length,
        hasReferencedMessages: !!context.referencedMessages,
        referencedMessagesCount: context.referencedMessages?.length || 0
      }, `[MessageHandler] Built context for AI request`);

      // Save user message to conversation history BEFORE calling AI
      // This ensures proper chronological ordering (user message timestamp < assistant response timestamp)
      // Include formatted reference data so it persists in conversation history
      const formattedReferences = formatReferencesForDatabase(referencedMessages);
      const contentWithReferences = (messageContentForAI || '[no text content]') + formattedReferences;

      await this.conversationHistory.addMessage(
        message.channel.id,
        personality.id,
        personaId,
        'user',
        contentWithReferences,
        message.guild?.id || null,
        message.id // Discord message ID for deduplication
      );

      // Call API Gateway for AI generation (this will process attachments and return descriptions)
      const response = await this.gatewayClient.generate(personality, context);

      // Update user message with rich attachment descriptions if available
      // The AI worker processes attachments and returns rich descriptions
      if (response.attachmentDescriptions || (attachments && attachments.length > 0)) {
        let enrichedContent = messageContentForAI || content; // Start with content that has [Reference N] markers

        if (response.attachmentDescriptions) {
          // Use rich descriptions from vision/transcription models
          enrichedContent = enrichedContent
            ? `${enrichedContent}\n\n${response.attachmentDescriptions}`
            : response.attachmentDescriptions;
        } else if (attachments) {
          // Fallback to simple placeholders if processing failed
          const attachmentDesc = attachments.map(a => {
            if (a.isVoiceMessage) {
              return `[voice message: ${a.duration}s]`;
            }
            if (a.contentType.startsWith('image/')) {
              return `[image: ${a.name || 'attachment'}]`;
            }
            if (a.contentType.startsWith('audio/')) {
              return `[audio: ${a.name || 'attachment'}]`;
            }
            return `[file: ${a.name || 'attachment'}]`;
          }).join(' ');

          enrichedContent = enrichedContent ? `${enrichedContent} ${attachmentDesc}` : attachmentDesc;
        }

        // Append formatted references to enriched content
        enrichedContent += formattedReferences;

        // Update the message we saved earlier with enriched content
        await this.conversationHistory.updateLastUserMessage(
          message.channel.id,
          personality.id,
          personaId,
          enrichedContent
        );
      }

      // Note: Assistant response is saved to conversation_history by ai-worker
      // during the storeInteraction() call, along with pending_memory tracking

      // Add model indicator to the message (for Discord display only, not in history)
      let contentWithIndicator = response.content;
      if (response.metadata?.modelUsed) {
        contentWithIndicator += `\n-# Model used: ${response.metadata.modelUsed}`;
      }

      // Send via webhook if in a guild text channel or thread
      const isWebhookChannel = message.guild !== null &&
        (message.channel instanceof TextChannel || message.channel instanceof ThreadChannel);

      let firstMessageId: string | null = null;

      if (isWebhookChannel) {
        // For webhooks, split content and send directly (no prefix needed)
        const chunks = preserveCodeBlocks(contentWithIndicator);

        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i];
          const sentMessage = await this.webhookManager.sendAsPersonality(
            message.channel as TextChannel | ThreadChannel,
            personality,
            chunk
          );

          // Store webhook message in Redis for reply routing (7 day TTL)
          if (sentMessage) {
            await storeWebhookMessage(sentMessage.id, personality.name);

            // Track first message ID for conversation history
            if (i === 0) {
              firstMessageId = sentMessage.id;
            }
          }
        }
      } else {
        // DMs don't support webhooks - add personality name prefix BEFORE splitting
        // This ensures chunks respect 2000 char limit including the prefix
        const dmContent = `**${personality.displayName}:** ${contentWithIndicator}`;
        const chunks = preserveCodeBlocks(dmContent);

        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i];
          const sentMessage = await message.reply(chunk);
          // Store DM message in Redis for reply routing (7 day TTL)
          await storeWebhookMessage(sentMessage.id, personality.name);

          // Track first message ID for conversation history
          if (i === 0) {
            firstMessageId = sentMessage.id;
          }
        }
      }

      // Update the assistant message in conversation history with Discord message ID
      // This enables deduplication when users reference recent assistant messages
      if (firstMessageId) {
        await this.conversationHistory.updateLastAssistantMessageId(
          message.channel.id,
          personality.id,
          personaId,
          firstMessageId
        );
      }

      logger.info(`[MessageHandler] Response sent as ${personality.displayName} (with ${conversationHistory.length} history messages)`);

    } catch (error) {
      logger.error({ err: error }, '[MessageHandler] Error handling personality message');

      // Show the actual error to help with debugging
      const errorMessage = error instanceof Error ? error.message : String(error);
      await message.reply(`Error: ${errorMessage}`).catch(() => {});
    } finally {
      // Always clear the typing indicator interval
      if (typingInterval) {
        clearInterval(typingInterval);
      }
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
        contentType: attachment.contentType || 'application/octet-stream',
        name: attachment.name,
        size: attachment.size,
        isVoiceMessage: attachment.duration !== null,
        duration: attachment.duration ?? undefined,
        waveform: attachment.waveform ?? undefined
      }));

      // Send transcribe job to api-gateway
      const response = await this.gatewayClient.transcribe(attachments);

      if (!response || !response.content) {
        throw new Error('No transcript returned from transcription service');
      }

      // Chunk the transcript (respecting 2000 char Discord limit)
      const chunks = preserveCodeBlocks(response.content);

      logger.info(`[MessageHandler] Transcription complete: ${response.content.length} chars, ${chunks.length} chunks`);

      // Send each chunk as a reply (these will appear BEFORE personality webhook response)
      for (const chunk of chunks) {
        await message.reply(chunk);
      }

      // Cache transcript in Redis to avoid re-transcribing if this voice message also targets a personality
      // Key by attachment URL with 5 min TTL (long enough for personality processing)
      const voiceAttachment = attachments[0]; // We know there's at least one
      if (voiceAttachment) {
        await storeVoiceTranscript(voiceAttachment.url, response.content);
        logger.debug(`[MessageHandler] Cached transcript for attachment: ${voiceAttachment.url.substring(0, 50)}...`);
      }

      return response.content;

    } catch (error) {
      logger.error({ err: error }, '[MessageHandler] Error transcribing voice message');
      await message.reply('Sorry, I couldn\'t transcribe that voice message.').catch(() => {});
      return undefined;
    }
  }
}
