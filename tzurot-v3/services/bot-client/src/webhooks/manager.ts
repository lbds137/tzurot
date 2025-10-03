/**
 * Webhook Manager
 *
 * Manages Discord webhooks for personality avatars.
 * Clean implementation ported from v2 webhookManager.js patterns.
 */

import { pino } from 'pino';
import type { TextChannel, Webhook } from 'discord.js';
import type { BotPersonality } from '../types.js';

const logger = pino({
  transport: {
    target: 'pino-pretty',
    options: { colorize: true }
  }
});

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
   * Get or create a webhook for a channel
   */
  async getWebhook(channel: TextChannel): Promise<Webhook | null> {
    try {
      // Check cache first
      const cached = this.webhookCache.get(channel.id);
      if (cached !== undefined && Date.now() - cached.lastUsed < this.cacheTimeout) {
        logger.debug(`[WebhookManager] Using cached webhook for channel ${channel.id}`);
        cached.lastUsed = Date.now();
        return cached.webhook;
      }

      // Fetch existing webhooks
      const webhooks = await channel.fetchWebhooks();
      let webhook = webhooks.find(wh => wh.owner?.id === channel.client.user?.id);

      // Create new webhook if none exists
      if (webhook === undefined) {
        logger.info(`[WebhookManager] Creating new webhook for channel ${channel.id}`);
        webhook = await channel.createWebhook({
          name: 'Tzurot Personalities',
          reason: 'Multi-personality bot system'
        });
      }

      // Cache the webhook
      this.webhookCache.set(channel.id, {
        webhook,
        lastUsed: Date.now()
      });

      return webhook;

    } catch (error) {
      logger.error(`[WebhookManager] Failed to get/create webhook for channel ${channel.id}:`, error);
      return null;
    }
  }

  /**
   * Send a message via webhook with personality avatar/name
   */
  async sendAsPersonality(
    channel: TextChannel,
    personality: BotPersonality,
    content: string
  ): Promise<void> {
    try {
      const webhook = await this.getWebhook(channel);

      if (webhook === null) {
        // Fallback to regular channel send if webhook fails
        logger.warn(`[WebhookManager] Webhook unavailable, using channel.send fallback`);
        await channel.send(`**${personality.displayName}:** ${content}`);
        return;
      }

      // Send via webhook with personality identity
      await webhook.send({
        content,
        username: personality.displayName,
        avatarURL: personality.avatarUrl
      });

      logger.info(`[WebhookManager] Sent message as ${personality.displayName} in ${channel.id}`);

    } catch (error) {
      logger.error(`[WebhookManager] Failed to send webhook message:`, error);

      // Fallback to regular send
      try {
        await channel.send(`**${personality.displayName}:** ${content}`);
      } catch (fallbackError) {
        logger.error(`[WebhookManager] Fallback send also failed:`, fallbackError);
      }
    }
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
