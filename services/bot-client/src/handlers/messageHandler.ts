/**
 * Message Handler
 *
 * Clean, simple message routing for Discord messages.
 * Routes to either command processing or AI personality responses.
 */

import type { Message } from 'discord.js';
import { TextChannel, ThreadChannel } from 'discord.js';
import { GatewayClient } from '../gateway/client.js';
import { WebhookManager } from '../webhooks/manager.js';
import { ConversationHistoryService, PersonalityService, UserService, preserveCodeBlocks, createLogger } from '@tzurot/common-types';
import type { LoadedPersonality } from '@tzurot/common-types';
import type { MessageContext } from '../types.js';
import { storeWebhookMessage, getWebhookPersonality } from '../redis.js';

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

      // Check for replies to personality messages (best UX - no @mention needed)
      if (message.reference !== null) {
        const replyResult = await this.handleReply(message);
        if (replyResult) {
          return; // Reply was handled
        }
      }

      // Check for personality mentions (e.g., "@personality hello")
      const mentionMatch = this.findPersonalityMention(message.content);

      if (mentionMatch !== null) {
        // Load personality from database (with PersonalityService's cache)
        const personality = await this.personalityService.loadPersonality(mentionMatch.personalityName);

        if (personality !== null) {
          await this.handlePersonalityMessage(message, personality, mentionMatch.cleanContent);
        } else {
          await message.reply(`I don't know a personality called "${mentionMatch.personalityName}"`);
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
    try {
      // Show typing indicator
      if ('sendTyping' in message.channel) {
        await message.channel.sendTyping();
      }

      // Get or create user record (needed for foreign key)
      const userId = await this.userService.getOrCreateUser(
        message.author.id,
        message.author.username
      );

      // Get conversation history from PostgreSQL
      const historyLimit = personality.contextWindow || 20;
      const history = await this.conversationHistory.getRecentHistory(
        message.channel.id,
        personality.id,
        historyLimit
      );

      // Convert to format expected by AI gateway
      const conversationHistory = history.map(msg => ({
        id: msg.id, // Include UUID for deduplication in LTM
        role: msg.role,
        content: msg.content,
        createdAt: msg.createdAt.toISOString() // Include timestamp for context
      }));

      // Extract attachments if present (images, audio, etc)
      const attachments = message.attachments.size > 0
        ? Array.from(message.attachments.values()).map(attachment => ({
            url: attachment.url,
            contentType: attachment.contentType || 'application/octet-stream',
            name: attachment.name,
            size: attachment.size,
            // Discord.js v14 voice message metadata
            isVoiceMessage: attachment.duration !== null,
            duration: attachment.duration ?? undefined,
            waveform: attachment.waveform ?? undefined
          }))
        : undefined;

      // Build context with conversation history and attachments
      const context: MessageContext = {
        userId: userId, // Use database UUID, not Discord ID
        userName: message.author.username,
        channelId: message.channel.id,
        serverId: message.guild?.id,
        messageContent: content,
        conversationHistory,
        attachments
      };

      // Save user message to conversation history
      await this.conversationHistory.addMessage(
        message.channel.id,
        personality.id,
        userId,
        'user',
        content
      );

      // Call API Gateway for AI generation
      const response = await this.gatewayClient.generate(personality, context);

      // Save assistant response to conversation history
      await this.conversationHistory.addMessage(
        message.channel.id,
        personality.id,
        userId,
        'assistant',
        response
      );

      // Split response if needed (Discord 2000 char limit)
      const chunks = preserveCodeBlocks(response);

      // Send via webhook if in a guild text channel or thread
      const isWebhookChannel = message.guild !== null &&
        (message.channel instanceof TextChannel || message.channel instanceof ThreadChannel);

      if (isWebhookChannel) {
        for (const chunk of chunks) {
          const sentMessage = await this.webhookManager.sendAsPersonality(
            message.channel as TextChannel | ThreadChannel,
            personality,
            chunk
          );

          // Store webhook message in Redis for reply routing (7 day TTL)
          if (sentMessage) {
            await storeWebhookMessage(sentMessage.id, personality.name);
          }
        }
      } else {
        // DMs don't support webhooks - use formatted message with personality name
        for (const chunk of chunks) {
          const formattedContent = `**${personality.displayName}:** ${chunk}`;
          const sentMessage = await message.reply(formattedContent);
          // Store DM message in Redis for reply routing (7 day TTL)
          await storeWebhookMessage(sentMessage.id, personality.name);
        }
      }

      logger.info(`[MessageHandler] Response sent as ${personality.displayName} (with ${conversationHistory.length} history messages)`);

    } catch (error) {
      logger.error({ err: error }, '[MessageHandler] Error handling personality message');

      // Show the actual error to help with debugging
      const errorMessage = error instanceof Error ? error.message : String(error);
      await message.reply(`Error: ${errorMessage}`).catch(() => {});
    }
  }

  /**
   * Find personality mention in message content
   * Supports: @personality, &personality (for development)
   */
  private findPersonalityMention(content: string): { personalityName: string; cleanContent: string } | null {
    // Try @ mentions first
    const atMentionRegex = /@(\w+)/;
    const atMatch = content.match(atMentionRegex);

    if (atMatch !== null) {
      const personalityName = atMatch[1];
      const cleanContent = content.replace(atMentionRegex, '').trim();
      return { personalityName, cleanContent };
    }

    // Try & mentions (development)
    const ampMentionRegex = /&(\w+)/;
    const ampMatch = content.match(ampMentionRegex);

    if (ampMatch !== null) {
      const personalityName = ampMatch[1];
      const cleanContent = content.replace(ampMentionRegex, '').trim();
      return { personalityName, cleanContent };
    }

    return null;
  }
}
