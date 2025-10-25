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
import { ConversationHistoryService, PersonalityService, UserService, preserveCodeBlocks, createLogger, getConfig } from '@tzurot/common-types';
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
        }, 8000);
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

      // Save user message to conversation history BEFORE calling AI
      // This ensures proper chronological ordering (user message timestamp < assistant response timestamp)
      // We'll update it later with rich attachment descriptions if needed
      await this.conversationHistory.addMessage(
        message.channel.id,
        personality.id,
        userId,
        'user',
        content || '[no text content]'
      );

      // Call API Gateway for AI generation (this will process attachments and return descriptions)
      const response = await this.gatewayClient.generate(personality, context);

      // Update user message with rich attachment descriptions if available
      // The AI worker processes attachments and returns rich descriptions
      if (response.attachmentDescriptions || (attachments && attachments.length > 0)) {
        let enrichedContent = content;

        if (response.attachmentDescriptions) {
          // Use rich descriptions from vision/transcription models
          enrichedContent = content
            ? `${content}\n\n${response.attachmentDescriptions}`
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

          enrichedContent = content ? `${content} ${attachmentDesc}` : attachmentDesc;
        }

        // Update the message we saved earlier with enriched content
        await this.conversationHistory.updateLastUserMessage(
          message.channel.id,
          personality.id,
          userId,
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

      if (isWebhookChannel) {
        // For webhooks, split content and send directly (no prefix needed)
        const chunks = preserveCodeBlocks(contentWithIndicator);

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
        // DMs don't support webhooks - add personality name prefix BEFORE splitting
        // This ensures chunks respect 2000 char limit including the prefix
        const dmContent = `**${personality.displayName}:** ${contentWithIndicator}`;
        const chunks = preserveCodeBlocks(dmContent);

        for (const chunk of chunks) {
          const sentMessage = await message.reply(chunk);
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
    } finally {
      // Always clear the typing indicator interval
      if (typingInterval) {
        clearInterval(typingInterval);
      }
    }
  }

  /**
   * Find personality mention in message content
   * Uses BOT_MENTION_CHAR from config (@ for prod, & for dev)
   */
  private findPersonalityMention(content: string): { personalityName: string; cleanContent: string } | null {
    const config = getConfig();
    const mentionChar = config.BOT_MENTION_CHAR;

    // Escape special regex characters
    const escapedChar = mentionChar.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const mentionRegex = new RegExp(`${escapedChar}(\\w+)`);
    const match = content.match(mentionRegex);

    if (match !== null) {
      const personalityName = match[1];

      // Ignore Discord user ID mentions (all digits)
      if (/^\d+$/.test(personalityName)) {
        logger.debug(`[MessageHandler] Ignoring Discord user ID mention: ${personalityName}`);
        return null;
      }

      const cleanContent = content.replace(mentionRegex, '').trim();
      return { personalityName, cleanContent };
    }

    return null;
  }
}
