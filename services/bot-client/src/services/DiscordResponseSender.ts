/**
 * Discord Response Sender
 *
 * Handles sending AI responses to Discord via webhooks or DMs.
 * Manages message chunking, model indicators, and webhook storage.
 */

import type { Message } from 'discord.js';
import { TextChannel, ThreadChannel } from 'discord.js';
import {
  splitMessage,
  createLogger,
  AI_ENDPOINTS,
  GUEST_MODE,
  DISCORD_LIMITS,
} from '@tzurot/common-types';
import type { LoadedPersonality } from '@tzurot/common-types';
import { WebhookManager } from '../utils/WebhookManager.js';
import { redisService } from '../redis.js';

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
  /** Whether response was generated in guest mode (free model, no API key) */
  isGuestMode?: boolean;
  /** Whether this is an auto-response from channel activation (not @mention) */
  isAutoResponse?: boolean;
  /** Whether focus mode was active (LTM retrieval skipped) */
  focusModeEnabled?: boolean;
  /** Whether incognito mode was active (LTM storage skipped) */
  incognitoModeActive?: boolean;
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
   * - Model indicator addition (appended to last chunk to preserve formatting)
   * - Message chunking (2000 char limit)
   * - Webhook vs DM routing
   * - Discord message ID tracking
   * - Redis webhook storage
   */
  async sendResponse(options: SendResponseOptions): Promise<DiscordSendResult> {
    const {
      content,
      personality,
      message,
      modelUsed,
      isGuestMode,
      isAutoResponse,
      focusModeEnabled,
      incognitoModeActive,
    } = options;

    // Build footer to append AFTER chunking (to preserve newline formatting)
    // The chunker's word-level splitting replaces \n with spaces, so we add footer post-chunk
    // Compact format: combine model + auto-response indicator on one line to minimize clutter
    let footer = '';
    if (modelUsed !== undefined && modelUsed.length > 0) {
      const modelUrl = `${AI_ENDPOINTS.OPENROUTER_MODEL_CARD_URL}/${modelUsed}`;
      footer += `\n-# Model: [${modelUsed}](<${modelUrl}>)`;

      // Append auto-response indicator to same line (compact format)
      if (isAutoResponse === true) {
        footer += ' • 📍 auto';
      }
    } else if (isAutoResponse === true) {
      // No model shown but still want to indicate auto-response
      footer += '\n-# 📍 auto-response';
    }
    if (isGuestMode === true) {
      footer += `\n-# ${GUEST_MODE.FOOTER_MESSAGE}`;
    }
    if (focusModeEnabled === true) {
      footer += '\n-# 🔒 Focus Mode • LTM retrieval disabled';
    }
    if (incognitoModeActive === true) {
      footer += '\n-# 👻 Incognito Mode • Memories not being saved';
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
        content,
        footer,
        chunkMessageIds
      );
    } else {
      // DM - send as bot with personality prefix
      await this.sendViaDM(message, personality, content, footer, chunkMessageIds);
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
   *
   * Footer is appended to the last chunk to preserve newline formatting.
   * If appending would exceed Discord's limit, footer becomes its own chunk.
   */
  private async sendViaWebhook(
    channel: TextChannel | ThreadChannel,
    personality: LoadedPersonality,
    content: string,
    footer: string,
    chunkMessageIds: string[]
  ): Promise<void> {
    const chunks = splitMessage(content);

    // Append footer to last chunk, or make it a new chunk if it would overflow
    if (chunks.length > 0 && footer.length > 0) {
      const lastIndex = chunks.length - 1;
      if (chunks[lastIndex].length + footer.length <= DISCORD_LIMITS.MESSAGE_LENGTH) {
        chunks[lastIndex] += footer;
      } else {
        // Footer would overflow - add as separate chunk (trim leading newline)
        chunks.push(footer.trimStart());
      }
    }

    for (const chunk of chunks) {
      const sentMessage = await this.webhookManager.sendAsPersonality(channel, personality, chunk);

      if (sentMessage !== null && sentMessage !== undefined) {
        // Store webhook message in Redis for reply routing (7 day TTL)
        // Store personality ID (not name) to avoid slug/name collisions
        await redisService.storeWebhookMessage(sentMessage.id, personality.id);
        chunkMessageIds.push(sentMessage.id);
      }
    }
  }

  /**
   * Send via DM (add personality prefix)
   *
   * Footer is appended to the last chunk to preserve newline formatting.
   * If appending would exceed Discord's limit, footer becomes its own chunk.
   */
  private async sendViaDM(
    message: Message,
    personality: LoadedPersonality,
    content: string,
    footer: string,
    chunkMessageIds: string[]
  ): Promise<void> {
    // Add personality prefix BEFORE chunking to respect 2000 char limit
    const dmContent = `**${personality.displayName}:** ${content}`;
    const chunks = splitMessage(dmContent);

    // Append footer to last chunk, or make it a new chunk if it would overflow
    if (chunks.length > 0 && footer.length > 0) {
      const lastIndex = chunks.length - 1;
      if (chunks[lastIndex].length + footer.length <= DISCORD_LIMITS.MESSAGE_LENGTH) {
        chunks[lastIndex] += footer;
      } else {
        // Footer would overflow - add as separate chunk (trim leading newline)
        chunks.push(footer.trimStart());
      }
    }

    for (const chunk of chunks) {
      const sentMessage = await message.reply(chunk);

      // Store DM message in Redis for reply routing (7 day TTL)
      // Store personality ID (not name) to avoid slug/name collisions
      await redisService.storeWebhookMessage(sentMessage.id, personality.id);
      chunkMessageIds.push(sentMessage.id);
    }
  }
}
