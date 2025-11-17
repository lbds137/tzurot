/**
 * Discord Response Sender
 *
 * Handles sending AI responses to Discord via webhooks or DMs.
 * Manages message chunking, model indicators, and webhook storage.
 */

import type { Message } from 'discord.js';
import { TextChannel, ThreadChannel } from 'discord.js';
import { preserveCodeBlocks, createLogger, AI_ENDPOINTS } from '@tzurot/common-types';
import type { LoadedPersonality } from '@tzurot/common-types';
import { WebhookManager } from '../utils/WebhookManager.js';
import { storeWebhookMessage } from '../redis.js';

const logger = createLogger('DiscordResponseSender');

/**
 * Result of sending a Discord response
 */
export interface DiscordSendResult {
  /** Discord message IDs for all chunks sent */
  chunkMessageIds: string[];
  /** Number of chunks sent */
  chunkCount: number;
}

/**
 * Options for sending a Discord response
 */
export interface SendResponseOptions {
  /** The AI response content */
  content: string;
  /** The personality to send as */
  personality: LoadedPersonality;
  /** The original user message (for context and replies) */
  message: Message;
  /** Model name used for generation (optional, adds indicator) */
  modelUsed?: string;
}

/**
 * Sends AI responses to Discord channels via webhooks or DMs
 */
export class DiscordResponseSender {
  private webhookManager: WebhookManager;

  constructor(webhookManager: WebhookManager) {
    this.webhookManager = webhookManager;
  }

  /**
   * Send AI response to Discord
   *
   * Handles:
   * - Model indicator addition
   * - Message chunking (2000 char limit)
   * - Webhook vs DM routing
   * - Discord message ID tracking
   * - Redis webhook storage
   */
  async sendResponse(options: SendResponseOptions): Promise<DiscordSendResult> {
    const { content, personality, message, modelUsed } = options;

    // Add model indicator if provided
    let contentWithIndicator = content;
    if (modelUsed !== undefined && modelUsed.length > 0) {
      const modelUrl = `${AI_ENDPOINTS.OPENROUTER_MODEL_CARD_URL}/${modelUsed}`;
      contentWithIndicator += `\n-# Model: [\`${modelUsed}\`](<${modelUrl}>)`;
    }

    // Determine if this is a webhook-capable channel
    const isWebhookChannel =
      message.guild !== null &&
      (message.channel instanceof TextChannel || message.channel instanceof ThreadChannel);

    const chunkMessageIds: string[] = [];

    if (isWebhookChannel) {
      // Guild channel - send via webhook
      await this.sendViaWebhook(
        message.channel as TextChannel | ThreadChannel,
        personality,
        contentWithIndicator,
        chunkMessageIds
      );
    } else {
      // DM - send as bot with personality prefix
      await this.sendViaDM(message, personality, contentWithIndicator, chunkMessageIds);
    }

    logger.debug(
      {
        chunks: chunkMessageIds.length,
        isWebhook: isWebhookChannel,
        personalityName: personality.name,
      },
      '[DiscordResponseSender] Response sent successfully'
    );

    return {
      chunkMessageIds,
      chunkCount: chunkMessageIds.length,
    };
  }

  /**
   * Send via webhook (guild channels)
   */
  private async sendViaWebhook(
    channel: TextChannel | ThreadChannel,
    personality: LoadedPersonality,
    content: string,
    chunkMessageIds: string[]
  ): Promise<void> {
    const chunks = preserveCodeBlocks(content);

    for (const chunk of chunks) {
      const sentMessage = await this.webhookManager.sendAsPersonality(channel, personality, chunk);

      if (sentMessage !== null && sentMessage !== undefined) {
        // Store webhook message in Redis for reply routing (7 day TTL)
        await storeWebhookMessage(sentMessage.id, personality.name);
        chunkMessageIds.push(sentMessage.id);
      }
    }
  }

  /**
   * Send via DM (add personality prefix)
   */
  private async sendViaDM(
    message: Message,
    personality: LoadedPersonality,
    content: string,
    chunkMessageIds: string[]
  ): Promise<void> {
    // Add personality prefix BEFORE chunking to respect 2000 char limit
    const dmContent = `**${personality.displayName}:** ${content}`;
    const chunks = preserveCodeBlocks(dmContent);

    for (const chunk of chunks) {
      const sentMessage = await message.reply(chunk);

      // Store DM message in Redis for reply routing (7 day TTL)
      await storeWebhookMessage(sentMessage.id, personality.name);
      chunkMessageIds.push(sentMessage.id);
    }
  }
}
