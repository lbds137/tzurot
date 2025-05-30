/**
 * Webhook Cache Manager
 * 
 * This module manages caching of Discord webhook clients to reduce API calls
 * and improve performance. It handles both regular channel webhooks and
 * thread-specific webhooks.
 */

const { WebhookClient } = require('discord.js');
const logger = require('../logger');

// Cache to store webhook instances by channel ID
const webhookCache = new Map();

// Track all active webhooks to prevent duplicates
const activeWebhooks = new Set();

/**
 * Get or create a webhook for a specific channel
 * @param {Object} channel - Discord.js channel object
 * @returns {Promise<WebhookClient>} The webhook client
 */
async function getOrCreateWebhook(channel) {
  // Check if we already have a cached webhook for this channel
  const isThread = channel.isThread();
  const channelId = channel.id;

  // If this is a thread, we need special handling
  if (isThread) {
    logger.info(`[WebhookCache] Getting webhook for thread ${channelId}`);

    // For threads, we need to:
    // 1. Get a webhook for the parent channel
    // 2. Then create a thread-specific instance of that webhook

    // First, check if we already have a thread-specific webhook cached
    const threadSpecificCacheKey = `thread-${channelId}`;
    if (webhookCache.has(threadSpecificCacheKey)) {
      logger.info(`[WebhookCache] Using cached thread-specific webhook for thread ${channelId}`);
      return webhookCache.get(threadSpecificCacheKey);
    }

    // Get the parent channel
    const parentChannel = channel.parent;

    if (!parentChannel) {
      throw new Error(`Cannot find parent channel for thread ${channelId}`);
    }

    logger.info(
      `[WebhookCache] Thread ${channelId} has parent channel ${parentChannel.id} (${parentChannel.name || 'unnamed'})`
    );

    // Get or create a webhook for the parent channel
    // First check if we have already cached the parent channel's webhook
    let parentWebhookClient;
    if (webhookCache.has(parentChannel.id)) {
      logger.info(`[WebhookCache] Using cached webhook for parent channel ${parentChannel.id}`);
      parentWebhookClient = webhookCache.get(parentChannel.id);
    } else {
      // Need to create or find a webhook for the parent channel
      logger.info(`[WebhookCache] Getting webhooks for parent channel ${parentChannel.id}`);
      const webhooks = await parentChannel.fetchWebhooks();

      logger.info(
        `[WebhookCache] Found ${webhooks.size} webhooks in parent channel ${parentChannel.id}`
      );

      // Look for our bot's webhook
      let webhook = webhooks.find(wh => wh.name === 'Tzurot');

      // If no webhook found, create a new one
      if (!webhook) {
        logger.info(
          `[WebhookCache] Creating new webhook for parent channel ${parentChannel.id} (${parentChannel.name || 'unnamed'})`
        );
        webhook = await parentChannel.createWebhook({
          name: 'Tzurot',
          avatar: null, // Will be set when sending messages
          reason: 'Bot webhook for personality messages',
        });
      }

      // Create a webhook client
      parentWebhookClient = new WebhookClient({ id: webhook.id, token: webhook.token });

      // Cache the webhook for the parent channel
      webhookCache.set(parentChannel.id, parentWebhookClient);
      logger.info(`[WebhookCache] Cached webhook for parent channel ${parentChannel.id}`);
    }

    // Now create a thread-specific webhook client using the parent webhook's credentials
    // We need to get the actual webhook data from the parent client to create a thread version
    const threadWebhookClient = new WebhookClient({
      id: parentWebhookClient.id,
      token: parentWebhookClient.token,
    });

    // Cache this thread-specific webhook client
    webhookCache.set(threadSpecificCacheKey, threadWebhookClient);
    logger.info(`[WebhookCache] Created and cached thread-specific webhook for thread ${channelId}`);

    return threadWebhookClient;
  }

  // For regular channels, check cache first
  if (webhookCache.has(channelId)) {
    return webhookCache.get(channelId);
  }

  // Get all webhooks for the channel
  const webhooks = await channel.fetchWebhooks();

  // Look for our bot's webhook
  let webhook = webhooks.find(wh => wh.name === 'Tzurot');

  // If no webhook found, create a new one
  if (!webhook) {
    logger.info(`[WebhookCache] Creating new webhook for channel ${channel.name || channelId}`);
    webhook = await channel.createWebhook({
      name: 'Tzurot',
      avatar: null, // Will be set when sending messages
      reason: 'Bot webhook for personality messages',
    });
  }

  // Create a webhook client
  const webhookClient = new WebhookClient({ id: webhook.id, token: webhook.token });

  // Cache the webhook
  webhookCache.set(channelId, webhookClient);

  return webhookClient;
}

/**
 * Clear webhook cache for a specific channel
 * @param {string} channelId - Discord channel ID
 */
function clearWebhookCache(channelId) {
  if (webhookCache.has(channelId)) {
    const webhook = webhookCache.get(channelId);
    webhook.destroy(); // Close any open connections
    webhookCache.delete(channelId);
    logger.info(`[WebhookCache] Cleared webhook cache for channel ${channelId}`);
  }
  
  // Also clear thread-specific cache if it exists
  const threadKey = `thread-${channelId}`;
  if (webhookCache.has(threadKey)) {
    const webhook = webhookCache.get(threadKey);
    webhook.destroy();
    webhookCache.delete(threadKey);
    logger.info(`[WebhookCache] Cleared thread webhook cache for ${threadKey}`);
  }
}

/**
 * Clear all webhook caches
 */
function clearAllWebhookCaches() {
  logger.info(`[WebhookCache] Clearing all webhook caches (${webhookCache.size} entries)`);
  
  for (const [_channelId, webhook] of webhookCache.entries()) {
    webhook.destroy(); // Close any open connections
  }
  
  webhookCache.clear();
  activeWebhooks.clear();
  
  logger.info('[WebhookCache] All webhook caches cleared');
}

/**
 * Get the size of the webhook cache
 * @returns {number} Number of cached webhooks
 */
function getCacheSize() {
  return webhookCache.size;
}

/**
 * Check if a webhook is cached for a channel
 * @param {string} channelId - Discord channel ID
 * @returns {boolean} Whether a webhook is cached
 */
function hasWebhook(channelId) {
  return webhookCache.has(channelId) || webhookCache.has(`thread-${channelId}`);
}

/**
 * Get active webhooks tracker
 * @returns {Set} The set of active webhook IDs
 */
function getActiveWebhooks() {
  return activeWebhooks;
}

/**
 * Register event listeners for Discord client to handle webhook cleanup
 * @param {Client} discordClient - Discord.js client instance
 */
function registerEventListeners(discordClient) {
  // Clean up webhooks when channels are deleted
  discordClient.on('channelDelete', (channel) => {
    if (webhookCache.has(channel.id)) {
      logger.info(`[WebhookCache] Channel ${channel.id} deleted, clearing webhook cache`);
      clearWebhookCache(channel.id);
    }
    
    // Also clean up any thread-specific webhooks for this channel
    const threadKey = `thread-${channel.id}`;
    if (webhookCache.has(threadKey)) {
      logger.info(`[WebhookCache] Thread ${channel.id} deleted, clearing thread webhook cache`);
      clearWebhookCache(threadKey);
    }
  });
  
  logger.info('[WebhookCache] Event listeners registered for webhook cleanup');
}

module.exports = {
  getOrCreateWebhook,
  clearWebhookCache,
  clearAllWebhookCaches,
  getCacheSize,
  hasWebhook,
  getActiveWebhooks,
  registerEventListeners,
  // Expose for testing purposes
  _webhookCache: webhookCache,
  _activeWebhooks: activeWebhooks
};