/**
 * Webhook Manager
 *
 * Manages Discord webhooks for personality avatars.
 * Clean implementation ported from v2 webhookManager.js patterns.
 */

import { DISCORD_LIMITS } from '@tzurot/common-types/constants/discord';
import { INTERVALS } from '@tzurot/common-types/constants/timing';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { TTLCache } from '@tzurot/common-types/utils/TTLCache';
import {
  ChannelType,
  DiscordAPIError,
  type Client,
  type TextChannel,
  type ThreadChannel,
  type ForumChannel,
  type NewsChannel,
  type Webhook,
  type Message,
} from 'discord.js';
import { adjustRefusedWebhookUsername, deriveBotSuffix } from './webhookNaming.js';
import type { LoadedPersonality } from '../types.js';

const logger = createLogger('WebhookManager');

/** Discord's code for an invalid form body; a refused webhook username arrives under it. */
const DISCORD_INVALID_FORM_BODY = 50035;

/** How long an adjusted username is reused for a persona after Discord refused the plain one. */
const ADJUSTED_USERNAME_TTL_MS = 24 * 60 * 60 * 1000;

/** Upper bound on remembered adjusted usernames. */
const ADJUSTED_USERNAME_MAX_ENTRIES = 1000;

/** Options passed to `webhook.send` for a personality message. */
interface WebhookSendOptions {
  content: string;
  username: string;
  avatarURL?: string;
  threadId?: string;
  allowedMentions: { parse: [] };
  files?: { attachment: Buffer; name: string }[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * The first refusal code Discord reports for the username field, or `null`
 * when the error is not a username refusal. A refusal is a 50035 whose
 * `errors` object carries a `username` object.
 */
function usernameRefusalCode(error: unknown): string | null {
  if (!(error instanceof DiscordAPIError) || error.code !== DISCORD_INVALID_FORM_BODY) {
    return null;
  }
  const raw: unknown = error.rawError;
  const errors: unknown = isRecord(raw) ? raw.errors : undefined;
  const username: unknown = isRecord(errors) ? errors.username : undefined;
  if (!isRecord(username)) {
    return null;
  }
  const list: unknown = username._errors;
  const first: unknown = Array.isArray(list) ? list[0] : undefined;
  return isRecord(first) && typeof first.code === 'string' ? first.code : 'unknown';
}

/**
 * Whether a send error is Discord refusing the webhook username (code 50035
 * with an `errors.username` object). Any other error returns false.
 */
export function isRefusedUsernameError(error: unknown): boolean {
  return usernameRefusalCode(error) !== null;
}

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
  /** Adjusted usernames keyed by the standard name Discord refused. */
  private adjustedUsernames = new TTLCache<string>({
    ttl: ADJUSTED_USERNAME_TTL_MS,
    maxSize: ADJUSTED_USERNAME_MAX_ENTRIES,
  });

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
      // Brand from the bot's own identity (dev = Rotzot, prod = Tzurot) —
      // webhook lookup above matches by owner id, not name, so existing
      // webhooks keep working regardless of the name they were created with.
      webhook = await targetChannel.createWebhook({
        name: `${targetChannel.client.user?.username ?? 'Bot'} Personalities`,
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
    // A persona whose plain name Discord refused is sent under its adjusted name
    const username = this.adjustedUsernames.get(standardizedName) ?? standardizedName;

    // Avatar URL already includes path-based cache-busting (timestamp in filename)
    // e.g., /avatars/cold-1705827727111.png
    // This is handled by deriveAvatarUrl() in PersonalityDefaults.ts
    // Discord's CDN treats different paths as unique resources, forcing a refresh
    const avatarURL = personality.avatarUrl;

    // Build webhook send options
    // Webhooks don't inherit Client's allowedMentions — must be set explicitly
    // to prevent AI-generated @everyone/@here/@role pings
    const webhookOptions: WebhookSendOptions = {
      content,
      username,
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
      logger.info({ threadId: channel.id, username }, 'Sending to thread');
    }

    // Debug logging for avatar URL (log the actual URL with cache-busting)
    logger.debug({ avatarURL: avatarURL ?? null }, 'Sending with avatar');

    // Send via webhook and return message
    let sent: { message: Message; username: string };
    try {
      sent = { message: await webhook.send(webhookOptions), username };
    } catch (error) {
      sent = await this.retryRefusedUsername(
        error,
        webhook,
        webhookOptions,
        personality,
        channel.id
      );
    }
    logger.info({ username: sent.username, channelId: channel.id }, 'Sent message as personality');
    return sent.message;
  }

  /**
   * Handle a failed send. When Discord refused the username, retry once with the
   * adjusted name and remember it for this persona once that send is accepted.
   * Any other error, and a refusal of a name that was already adjusted,
   * propagates unchanged.
   */
  private async retryRefusedUsername(
    error: unknown,
    webhook: Webhook,
    options: WebhookSendOptions,
    personality: LoadedPersonality,
    channelId: string
  ): Promise<{ message: Message; username: string }> {
    const standardizedName = this.getStandardizedUsername(personality);
    const refusal = usernameRefusalCode(error);
    if (refusal === null) {
      throw error;
    }
    if (options.username !== standardizedName) {
      // A cached adjusted name was refused: forget it so the next send starts from the plain name
      this.adjustedUsernames.delete(standardizedName);
      throw error;
    }

    const adjusted = adjustRefusedWebhookUsername(personality.displayName, this.getBotSuffix());
    // Nothing to adjust (no refused word, fits the cap): a retry would resend the same refused name
    if (adjusted === standardizedName) {
      throw error;
    }
    logger.warn(
      { personalityId: personality.id, channelId, refusal },
      'Webhook username refused, retrying with adjusted name'
    );

    const message = await webhook.send({ ...options, username: adjusted });
    // Cache only after the adjusted send is accepted; a refused retry leaves the plain name in charge
    this.adjustedUsernames.set(standardizedName, adjusted);
    return { message, username: adjusted };
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
