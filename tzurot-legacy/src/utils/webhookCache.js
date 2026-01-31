/**
 * Webhook Cache Manager
 *
 * This module manages caching of Discord webhook clients to reduce API calls
 * and improve performance. It handles both regular channel webhooks and
 * thread-specific webhooks.
 *
 * Now uses LRUCache to prevent unbounded memory growth.
 */

const { WebhookClient } = require('discord.js');
const logger = require('../logger');
const LRUCache = require('./LRUCache');

// Cache to store webhook instances by channel ID
// Using LRU cache with a reasonable limit for webhook clients
const webhookCache = new LRUCache({
  maxSize: 100, // 100 webhooks should be enough for most servers
  ttl: 24 * 60 * 60 * 1000, // 24 hours TTL
  onEvict: (channelId, webhook) => {
    logger.debug(`[WebhookCache] Evicting webhook for channel ${channelId}`);
    // Important: Destroy the webhook client to close connections
    if (webhook && typeof webhook.destroy === 'function') {
      webhook.destroy();
    }
  },
});

// Track all active webhooks to prevent duplicates
const activeWebhooks = new Set();

/**
 * Get webhook name based on the bot's username
 * @returns {string} The webhook name to use
 */
function getWebhookName() {
  // Use global client if available, otherwise fallback to 'Tzurot'
  if (global.tzurotClient && global.tzurotClient.user) {
    // Extract just the base name without discriminator
    const botName = global.tzurotClient.user.username.split(' | ')[0];
    logger.debug(`[WebhookCache] Using dynamic webhook name: ${botName}`);
    return botName;
  }
  logger.debug('[WebhookCache] Client not available, using default webhook name: Tzurot');
  return 'Tzurot';
}

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
      let webhook;

      try {
        logger.info(`[WebhookCache] Getting webhooks for parent channel ${parentChannel.id}`);
        const webhooks = await parentChannel.fetchWebhooks();

        logger.info(
          `[WebhookCache] Found ${webhooks.size} webhooks in parent channel ${parentChannel.id}`
        );

        // Look for our bot's webhook
        const webhookName = getWebhookName();
        webhook = webhooks.find(wh => wh.name === webhookName);

        // If no webhook found, create a new one
        if (!webhook) {
          logger.info(
            `[WebhookCache] Creating new webhook for parent channel ${parentChannel.id} (${parentChannel.name || 'unnamed'})`
          );
          webhook = await parentChannel.createWebhook({
            name: webhookName,
            avatar: null, // Will be set when sending messages
            reason: 'Bot webhook for personality messages',
          });
        }
      } catch (error) {
        logger.error(
          `[WebhookCache] Failed to fetch/create webhook for parent channel ${parentChannel.id}: ${error.message}`
        );
        if (error.code === 50013) {
          throw new Error(
            `Missing permissions to manage webhooks in parent channel ${parentChannel.name || parentChannel.id}`
          );
        }
        throw error;
      }

      // Validate webhook has required properties
      if (!webhook.id || !webhook.token) {
        logger.error(
          `[WebhookCache] Invalid webhook data for parent channel ${parentChannel.id}: ` +
            `id=${webhook.id}, token=${webhook.token ? 'present' : 'missing'}`
        );
        throw new Error('Webhook missing required id or token');
      }

      // Create a webhook client
      parentWebhookClient = new WebhookClient({ id: webhook.id, token: webhook.token });

      // Cache the webhook for the parent channel
      webhookCache.set(parentChannel.id, parentWebhookClient);
      logger.info(`[WebhookCache] Cached webhook for parent channel ${parentChannel.id}`);
    }

    // Now create a thread-specific webhook client using the parent webhook's credentials
    // We need to get the actual webhook data from the parent client to create a thread version

    // Validate parent webhook client has required properties
    if (!parentWebhookClient.id || !parentWebhookClient.token) {
      logger.error(
        `[WebhookCache] Invalid parent webhook client for thread ${channelId}: ` +
          `id=${parentWebhookClient.id}, token=${parentWebhookClient.token ? 'present' : 'missing'}`
      );
      throw new Error('Parent webhook client missing required id or token');
    }

    const threadWebhookClient = new WebhookClient({
      id: parentWebhookClient.id,
      token: parentWebhookClient.token,
    });

    // Cache this thread-specific webhook client
    webhookCache.set(threadSpecificCacheKey, threadWebhookClient);
    logger.info(
      `[WebhookCache] Created and cached thread-specific webhook for thread ${channelId}`
    );

    return threadWebhookClient;
  }

  // For regular channels, check cache first
  if (webhookCache.has(channelId)) {
    return webhookCache.get(channelId);
  }

  let webhook;

  try {
    // Get all webhooks for the channel
    const webhooks = await channel.fetchWebhooks();

    // Look for our bot's webhook
    const webhookName = getWebhookName();
    webhook = webhooks.find(wh => wh.name === webhookName);

    // If no webhook found, create a new one
    if (!webhook) {
      logger.info(`[WebhookCache] Creating new webhook for channel ${channel.name || channelId}`);
      webhook = await channel.createWebhook({
        name: webhookName,
        avatar: null, // Will be set when sending messages
        reason: 'Bot webhook for personality messages',
      });
    }
  } catch (error) {
    logger.error(
      `[WebhookCache] Failed to fetch/create webhook for channel ${channel.name || channelId}: ${error.message}`
    );
    if (error.code === 50013) {
      throw new Error(
        `Missing permissions to manage webhooks in channel ${channel.name || channelId}`
      );
    }
    throw error;
  }

  // Validate webhook has required properties
  if (!webhook.id || !webhook.token) {
    logger.error(
      `[WebhookCache] Invalid webhook data for channel ${channel.name || channelId}: ` +
        `id=${webhook.id}, token=${webhook.token ? 'present' : 'missing'}`
    );
    throw new Error('Webhook missing required id or token');
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
  // The LRUCache will call the onEvict callback which handles destroy()
  if (webhookCache.has(channelId)) {
    webhookCache.delete(channelId);
    logger.info(`[WebhookCache] Cleared webhook cache for channel ${channelId}`);
  }

  // Also clear thread-specific cache if it exists
  const threadKey = `thread-${channelId}`;
  if (webhookCache.has(threadKey)) {
    webhookCache.delete(threadKey);
    logger.info(`[WebhookCache] Cleared thread webhook cache for ${threadKey}`);
  }
}

/**
 * Clear all webhook caches
 */
function clearAllWebhookCaches() {
  logger.info(`[WebhookCache] Clearing all webhook caches (${webhookCache.size} entries)`);

  // LRUCache.clear() will call onEvict for each entry, which handles destroy()
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
  discordClient.on('channelDelete', channel => {
    const channelId = String(channel.id);
    if (webhookCache.has(channelId)) {
      logger.info(`[WebhookCache] Channel ${channelId} deleted, clearing webhook cache`);
      clearWebhookCache(channelId);
    }

    // Also clean up any thread-specific webhooks for this channel
    const threadKey = `thread-${channelId}`;
    if (webhookCache.has(threadKey)) {
      logger.info(`[WebhookCache] Thread ${channelId} deleted, clearing thread webhook cache`);
      clearWebhookCache(channelId);
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
  _activeWebhooks: activeWebhooks,
};
