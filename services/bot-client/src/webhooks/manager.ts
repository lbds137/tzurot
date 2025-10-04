/**
 * Webhook Manager
 *
 * Manages Discord webhooks for personality avatars.
 * Clean implementation ported from v2 webhookManager.js patterns.
 */

import { createLogger } from '@tzurot/common-types';
import { ChannelType } from 'discord.js';
import type { TextChannel, ThreadChannel, ForumChannel, Webhook } from 'discord.js';
import type { BotPersonality } from '../types.js';

const logger = createLogger('WebhookManager');

/**
 * Cached webhook info
 */
interface CachedWebhook {
  webhook: Webhook;
  lastUsed: number;
}

/**
 * Webhook Manager - handles webhook creation and caching
 */
export class WebhookManager {
  private webhookCache = new Map<string, CachedWebhook>();
  private readonly cacheTimeout = 10 * 60 * 1000; // 10 minutes
  private cleanupInterval?: NodeJS.Timeout;

  constructor() {
    this.startCleanup();
  }

  /**
   * Get or create a webhook for a channel (or thread's parent channel)
   * Throws an error if webhook creation fails
   * Supports TextChannel, ThreadChannel (including forum threads), and ForumChannel
   */
  async getWebhook(channel: TextChannel | ThreadChannel): Promise<Webhook> {
    // For threads, we need to get the webhook from the parent channel
    let targetChannel: TextChannel | ForumChannel;

    if (channel.isThread()) {
      const parent = channel.parent;

      // Forum threads have ForumChannel parents, regular threads have TextChannel parents
      if (!parent) {
        throw new Error(`Thread ${channel.id} has no parent channel`);
      }

      if (parent.type !== ChannelType.GuildText && parent.type !== ChannelType.GuildForum) {
        throw new Error(`Thread ${channel.id} has unsupported parent channel type: ${parent.type}`);
      }

      targetChannel = parent as TextChannel | ForumChannel;
    } else {
      // channel is TextChannel since it's not a thread
      targetChannel = channel as TextChannel;
    }

    // Check cache first (cache by parent channel ID for threads)
    const cacheKey = targetChannel.id;
    const cached = this.webhookCache.get(cacheKey);
    if (cached !== undefined && Date.now() - cached.lastUsed < this.cacheTimeout) {
      logger.debug(`[WebhookManager] Using cached webhook for channel ${cacheKey}`);
      cached.lastUsed = Date.now();
      return cached.webhook;
    }

    // Fetch existing webhooks
    const webhooks = await targetChannel.fetchWebhooks();
    let webhook = webhooks.find((wh: Webhook) => wh.owner?.id === targetChannel.client.user?.id);

    // Create new webhook if none exists
    if (webhook === undefined) {
      logger.info(`[WebhookManager] Creating new webhook for channel ${cacheKey}`);
      webhook = await targetChannel.createWebhook({
        name: 'Tzurot Personalities',
        reason: 'Multi-personality bot system'
      });
    }

    // Cache the webhook
    this.webhookCache.set(cacheKey, {
      webhook,
      lastUsed: Date.now()
    });

    return webhook;
  }

  /**
   * Send a message via webhook with personality avatar/name
   * Handles both regular channels and threads
   * Returns the sent message for tracking purposes
   *
   * NOTE: This will throw if webhook creation/sending fails.
   * DM handling should be done in the message handler, not here.
   */
  async sendAsPersonality(
    channel: TextChannel | ThreadChannel,
    personality: BotPersonality,
    content: string
  ): Promise<any> {
    const webhook = await this.getWebhook(channel);

    // Build webhook send options
    const webhookOptions: {
      content: string;
      username: string;
      avatarURL?: string;
      threadId?: string;
    } = {
      content,
      username: personality.displayName,
      avatarURL: personality.avatarUrl
    };

    // For threads, add threadId parameter (Discord.js v14 official API)
    if (channel.isThread()) {
      webhookOptions.threadId = channel.id;
      logger.info(`[WebhookManager] Sending to thread ${channel.id} as ${personality.displayName}`);
    }

    // Send via webhook and return message
    const sentMessage = await webhook.send(webhookOptions);
    logger.info(`[WebhookManager] Sent message as ${personality.displayName} in ${channel.id}`);
    return sentMessage;
  }

  /**
   * Start periodic cache cleanup
   */
  private startCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredCache();
    }, 60000); // Clean up every minute

    // Allow Node.js to exit even with active interval
    this.cleanupInterval.unref();
  }

  /**
   * Clean up expired cache entries
   */
  private cleanupExpiredCache(): void {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [channelId, cached] of this.webhookCache.entries()) {
      if (now - cached.lastUsed > this.cacheTimeout) {
        this.webhookCache.delete(channelId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      logger.debug(`[WebhookManager] Cleaned up ${cleanedCount} expired webhook cache entries`);
    }
  }

  /**
   * Stop cleanup interval
   */
  destroy(): void {
    if (this.cleanupInterval !== undefined) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
    this.webhookCache.clear();
  }
}
