/**
 * Webhook Manager
 *
 * Manages Discord webhooks for personality avatars.
 * Clean implementation ported from v2 webhookManager.js patterns.
 */

import { DISCORD_LIMITS } from '@tzurot/common-types/constants/discord';
import { INTERVALS } from '@tzurot/common-types/constants/timing';
import { createLogger } from '@tzurot/common-types/utils/logger';
import {
  ChannelType,
  Client,
  type TextChannel,
  type ThreadChannel,
  type ForumChannel,
  type NewsChannel,
  type Webhook,
  type Message,
} from 'discord.js';
import { deriveBotSuffix } from './webhookNaming.js';
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
   * Get bot suffix from bot tag. Cached on first call. Delegates to the
   * shared `deriveBotSuffix` utility so all webhook-username consumers
   * (WebhookManager, ReplyResolutionService, DiscordChannelFetcher) agree
   * on the format.
   */
  private getBotSuffix(): string {
    if (this.botSuffix !== null) {
      return this.botSuffix;
    }

    const clientUser = this.client.user;
    if (!clientUser) {
      logger.warn('Client user not available for suffix extraction');
      this.botSuffix = '';
      return '';
    }

    this.botSuffix = deriveBotSuffix(clientUser.tag);
    logger.debug({ botTag: clientUser.tag, suffix: this.botSuffix }, 'Derived bot suffix');
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
   * Get or create a webhook for a channel (or thread's parent channel).
   * Supports TextChannel, NewsChannel (announcement channels), ThreadChannel
   * (including announcement-threads + forum threads), and ForumChannel
   * (which only fires on threads parented by it).
   *
   * Throws if webhook creation fails or the parent type is unsupported.
   */
  async getWebhook(channel: TextChannel | NewsChannel | ThreadChannel): Promise<Webhook> {
    // For threads, we need to get the webhook from the parent channel.
    // NewsChannel-parented threads (announcement threads) take this branch
    // and resolve to their NewsChannel parent.
    let targetChannel: TextChannel | NewsChannel | ForumChannel;

    if (channel.isThread()) {
      const parent = channel.parent;

      if (!parent) {
        throw new Error(`Thread ${channel.id} has no parent channel`);
      }

      // Threads can be parented by Text, Announcement (News), or Forum channels.
      if (
        parent.type !== ChannelType.GuildText &&
        parent.type !== ChannelType.GuildAnnouncement &&
        parent.type !== ChannelType.GuildForum
      ) {
        throw new Error(`Thread ${channel.id} has unsupported parent channel type: ${parent.type}`);
      }

      targetChannel = parent;
    } else {
      // channel is TextChannel | NewsChannel since it's not a thread.
      // The cast preserves the existing pattern; narrowing through
      // `isThread()` is not always reliable across discord.js versions.
      targetChannel = channel as TextChannel | NewsChannel;
    }

    // Check cache first (cache by parent channel ID for threads)
    const cacheKey = targetChannel.id;
    const cached = this.webhookCache.get(cacheKey);
    if (cached !== undefined && Date.now() - cached.lastUsed < this.cacheTimeout) {
      logger.debug({ channelId: cacheKey }, 'Using cached webhook');
      cached.lastUsed = Date.now();
      return cached.webhook;
    }

    // Fetch existing webhooks
    const webhooks = await targetChannel.fetchWebhooks();
    let webhook = webhooks.find((wh: Webhook) => wh.owner?.id === targetChannel.client.user?.id);

    // Create new webhook if none exists
    if (webhook === undefined) {
      logger.info({ channelId: cacheKey }, 'Creating new webhook');
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
    channel: TextChannel | NewsChannel | ThreadChannel,
    personality: LoadedPersonality,
    content: string,
    files?: { attachment: Buffer; name: string }[]
  ): Promise<Message> {
    const webhook = await this.getWebhook(channel);
    const standardizedName = this.getStandardizedUsername(personality);

    // Avatar URL already includes path-based cache-busting (timestamp in filename)
    // e.g., /avatars/cold-1705827727111.png
    // This is handled by deriveAvatarUrl() in PersonalityDefaults.ts
    // Discord's CDN treats different paths as unique resources, forcing a refresh
    const avatarURL = personality.avatarUrl;

    // Build webhook send options
    // Webhooks don't inherit Client's allowedMentions — must be set explicitly
    // to prevent AI-generated @everyone/@here/@role pings
    const webhookOptions: {
      content: string;
      username: string;
      avatarURL?: string;
      threadId?: string;
      allowedMentions: { parse: [] };
      files?: { attachment: Buffer; name: string }[];
    } = {
      content,
      username: standardizedName,
      avatarURL,
      allowedMentions: { parse: [] },
    };

    // Attach files (e.g., TTS audio) if provided
    if (files !== undefined && files.length > 0) {
      webhookOptions.files = files;
    }

    // For threads, add threadId parameter (Discord.js v14 official API)
    if (channel.isThread()) {
      webhookOptions.threadId = channel.id;
      logger.info({ threadId: channel.id, username: standardizedName }, 'Sending to thread');
    }

    // Debug logging for avatar URL (log the actual URL with cache-busting)
    logger.debug({ avatarURL: avatarURL ?? null }, 'Sending with avatar');

    // Send via webhook and return message
    const sentMessage = await webhook.send(webhookOptions);
    logger.info(
      { username: standardizedName, channelId: channel.id },
      'Sent message as personality'
    );
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
      logger.debug({ count: cleanedCount }, 'Cleaned up expired webhook cache entries');
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
      { evicted: entriesToRemove, limit: this.maxCacheSize },
      'Evicted least recently used webhook cache entries'
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
