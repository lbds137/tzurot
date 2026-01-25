/**
 * Webhook Manager
 *
 * Manages Discord webhooks for personality avatars.
 * Clean implementation ported from v2 webhookManager.js patterns.
 */

import { createLogger, INTERVALS, DISCORD_LIMITS } from '@tzurot/common-types';
import { ChannelType, Client } from 'discord.js';
import type { TextChannel, ThreadChannel, ForumChannel, Webhook, Message } from 'discord.js';
import type { LoadedPersonality } from '../types.js';

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
  private readonly cacheTimeout = INTERVALS.WEBHOOK_CACHE_TTL;
  private readonly maxCacheSize = DISCORD_LIMITS.WEBHOOK_CACHE_SIZE;
  private cleanupInterval?: NodeJS.Timeout;
  private client: Client;
  private botSuffix: string | null = null;

  constructor(client: Client) {
    this.client = client;
    this.startCleanup();
  }

  /**
   * Get bot suffix from bot tag
   * Format: "BotName | suffix" -> " | suffix"
   * Or: "BotName" -> " | BotName"
   */
  private getBotSuffix(): string {
    if (this.botSuffix !== null) {
      return this.botSuffix;
    }

    const clientUser = this.client.user;
    if (!clientUser) {
      logger.warn({}, '[WebhookManager] Client user not available for suffix extraction');
      this.botSuffix = '';
      return '';
    }

    const botTag = clientUser.tag;
    logger.debug(`[WebhookManager] Extracting suffix from bot tag: ${botTag}`);

    // Check if tag contains " | " delimiter
    if (botTag.includes(' | ')) {
      const parts = botTag.split(' | ');
      // Get the part after " | " and remove discriminator if present
      const suffix = parts[1].replace(/\s*#\d{4}$/, '').trim();
      this.botSuffix = ` | ${suffix}`;
    } else {
      // No delimiter - use full username (without discriminator) as suffix
      const username = botTag.replace(/\s*#\d{4}$/, '').trim();
      this.botSuffix = ` | ${username}`;
    }

    logger.debug(`[WebhookManager] Using bot suffix: "${this.botSuffix}"`);
    return this.botSuffix;
  }

  /**
   * Get standardized username with bot suffix
   *
   * Note: displayName is guaranteed to be set by mapToPersonality(), which uses
   * `db.displayName ?? db.name` to ensure it's never null/undefined.
   */
  private getStandardizedUsername(personality: LoadedPersonality): string {
    const suffix = this.getBotSuffix();
    return `${personality.displayName}${suffix}`;
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

      targetChannel = parent;
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
        reason: 'Multi-personality bot system',
      });
    }

    // Cache the webhook
    this.webhookCache.set(cacheKey, {
      webhook,
      lastUsed: Date.now(),
    });

    // Enforce size limit to prevent unbounded growth
    this.enforceCacheLimit();

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
    personality: LoadedPersonality,
    content: string
  ): Promise<Message> {
    const webhook = await this.getWebhook(channel);
    const standardizedName = this.getStandardizedUsername(personality);

    // Avatar URL already includes path-based cache-busting (timestamp in filename)
    // e.g., /avatars/cold-1705827727111.png
    // This is handled by deriveAvatarUrl() in PersonalityDefaults.ts
    // Discord's CDN treats different paths as unique resources, forcing a refresh
    const avatarURL = personality.avatarUrl;

    // Build webhook send options
    const webhookOptions: {
      content: string;
      username: string;
      avatarURL?: string;
      threadId?: string;
    } = {
      content,
      username: standardizedName,
      avatarURL,
    };

    // For threads, add threadId parameter (Discord.js v14 official API)
    if (channel.isThread()) {
      webhookOptions.threadId = channel.id;
      logger.info(`[WebhookManager] Sending to thread ${channel.id} as ${standardizedName}`);
    }

    // Debug logging for avatar URL (log the actual URL with cache-busting)
    logger.debug(`[WebhookManager] Sending with avatar: ${avatarURL ?? 'UNDEFINED'}`);

    // Send via webhook and return message
    const sentMessage = await webhook.send(webhookOptions);
    logger.info(`[WebhookManager] Sent message as ${standardizedName} in ${channel.id}`);
    return sentMessage;
  }

  /**
   * Start periodic cache cleanup
   */
  private startCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredCache();
    }, INTERVALS.WEBHOOK_CLEANUP);

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
   * Enforce cache size limit by removing least recently used entries
   */
  private enforceCacheLimit(): void {
    if (this.webhookCache.size <= this.maxCacheSize) {
      return;
    }

    // Sort entries by lastUsed (oldest first)
    const sortedEntries = Array.from(this.webhookCache.entries()).sort(
      (a, b) => a[1].lastUsed - b[1].lastUsed
    );

    // Remove oldest entries until we're under the limit
    const entriesToRemove = this.webhookCache.size - this.maxCacheSize;
    for (let i = 0; i < entriesToRemove; i++) {
      this.webhookCache.delete(sortedEntries[i][0]);
    }

    logger.debug(
      `[WebhookManager] Evicted ${entriesToRemove} least recently used webhook cache entries (limit: ${this.maxCacheSize})`
    );
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
