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
import { ConversationManager } from '../memory/ConversationManager.js';
import { preserveCodeBlocks, createLogger } from '@tzurot/common-types';
import type { BotPersonality, MessageContext } from '../types.js';

const logger = createLogger('MessageHandler');

/**
 * Message Handler - routes Discord messages to appropriate handlers
 */
export class MessageHandler {
  private gatewayClient: GatewayClient;
  private webhookManager: WebhookManager;
  private conversationManager: ConversationManager;
  private personalities: Map<string, BotPersonality>;

  constructor(
    gatewayClient: GatewayClient,
    webhookManager: WebhookManager,
    personalities: Map<string, BotPersonality>
  ) {
    this.gatewayClient = gatewayClient;
    this.webhookManager = webhookManager;
    this.conversationManager = new ConversationManager({
      maxMessagesPerThread: 20 // Keep last 20 messages indefinitely
    });
    this.personalities = personalities;
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
        await this.handlePersonalityMessage(message, mentionMatch.personality, mentionMatch.cleanContent);
        return;
      }

      // Check for bot mention
      if (message.mentions.has(message.client.user!)) {
        const defaultPersonality = this.personalities.get('default');
        if (defaultPersonality !== undefined) {
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
    personality: BotPersonality,
    content: string
  ): Promise<void> {
    try {
      // Show typing indicator
      if ('sendTyping' in message.channel) {
        await message.channel.sendTyping();
      }

      // Get conversation history
      const conversationHistory = this.conversationManager.getHistory(
        message.channel.id,
        personality.name
      );

      // Build context with conversation history
      const context: MessageContext = {
        userId: message.author.id,
        userName: message.author.username,
        channelId: message.channel.id,
        serverId: message.guild?.id,
        messageContent: content,
        conversationHistory // Add conversation history
      };

      // Add user message to conversation history
      this.conversationManager.addUserMessage(
        message.channel.id,
        personality.name,
        content
      );

      // Call API Gateway for AI generation
      const response = await this.gatewayClient.generate(personality, context);

      // Add assistant response to conversation history
      this.conversationManager.addAssistantMessage(
        message.channel.id,
        personality.name,
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
  private findPersonalityMention(content: string): { personality: BotPersonality; cleanContent: string } | null {
    // Try @ mentions first
    const atMentionRegex = /@(\w+)/;
    const atMatch = content.match(atMentionRegex);

    if (atMatch !== null) {
      const personalityName = atMatch[1].toLowerCase();
      const personality = this.personalities.get(personalityName);

      if (personality !== undefined) {
        const cleanContent = content.replace(atMentionRegex, '').trim();
        return { personality, cleanContent };
      }
    }

    // Try & mentions (development)
    const ampMentionRegex = /&(\w+)/;
    const ampMatch = content.match(ampMentionRegex);

    if (ampMatch !== null) {
      const personalityName = ampMatch[1].toLowerCase();
      const personality = this.personalities.get(personalityName);

      if (personality !== undefined) {
        const cleanContent = content.replace(ampMentionRegex, '').trim();
        return { personality, cleanContent };
      }
    }

    return null;
  }
}
