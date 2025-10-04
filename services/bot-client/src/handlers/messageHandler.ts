/**
 * Message Handler
 *
 * Clean, simple message routing for Discord messages.
 * Routes to either command processing or AI personality responses.
 */

import type { Message } from 'discord.js';
import { TextChannel } from 'discord.js';
import { GatewayClient } from '../gateway/client.js';
import { WebhookManager } from '../webhooks/manager.js';
import { ConversationHistoryService, PersonalityService, UserService, preserveCodeBlocks, createLogger } from '@tzurot/common-types';
import type { LoadedPersonality } from '@tzurot/common-types';
import type { MessageContext } from '../types.js';

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

      // Ignore empty messages
      if (message.content.length === 0) {
        return;
      }

      logger.debug(`[MessageHandler] Processing message from ${message.author.tag}`);

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
      logger.error('[MessageHandler] Error processing message:', error);

      // Try to send error message to user
      await message.reply('Sorry, I encountered an error processing your message.').catch(() => {
        // Ignore errors when sending error message
      });
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
        role: msg.role,
        content: msg.content,
        createdAt: msg.createdAt.toISOString() // Include timestamp for context
      }));

      // Build context with conversation history
      const context: MessageContext = {
        userId: userId, // Use database UUID, not Discord ID
        userName: message.author.username,
        channelId: message.channel.id,
        serverId: message.guild?.id,
        messageContent: content,
        conversationHistory
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

      // Send via webhook if in a guild text channel
      if (message.guild !== null && message.channel instanceof TextChannel) {
        for (const chunk of chunks) {
          await this.webhookManager.sendAsPersonality(
            message.channel as TextChannel,
            personality,
            chunk
          );
        }
      } else {
        // DMs don't support webhooks, use regular reply
        for (const chunk of chunks) {
          await message.reply(chunk);
        }
      }

      logger.info(`[MessageHandler] Response sent as ${personality.displayName} (with ${conversationHistory.length} history messages)`);

    } catch (error) {
      logger.error('[MessageHandler] Error handling personality message:', error);
      await message.reply('Sorry, I couldn\'t generate a response right now.').catch(() => {
        // Ignore errors
      });
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
