const { WebhookClient, EmbedBuilder } = require('discord.js');

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
  if (webhookCache.has(channel.id)) {
    return webhookCache.get(channel.id);
  }

  try {
    // Try to find existing webhooks in the channel
    const webhooks = await channel.fetchWebhooks();
    
    console.log(`Found ${webhooks.size} webhooks in channel ${channel.name || channel.id}`);
    
    // Look for our bot's webhook - use simpler criteria
    let webhook = webhooks.find(wh => wh.name === 'Tzurot');

    // If no webhook found, create a new one
    if (!webhook) {
      console.log(`Creating new webhook in channel ${channel.name || ''} (${channel.id})`);
      webhook = await channel.createWebhook({
        name: 'Tzurot',
        avatar: 'https://i.imgur.com/your-default-avatar.png', // Replace with your bot's default avatar
        reason: 'Needed for personality proxying'
      });
    } else {
      console.log(`Found existing Tzurot webhook in channel ${channel.id}`);
    }

    // Create a webhook client for this webhook
    const webhookClient = new WebhookClient({ url: webhook.url });
    
    // Cache the webhook client
    webhookCache.set(channel.id, webhookClient);
    
    return webhookClient;
  } catch (error) {
    console.error(`Error getting or creating webhook for channel ${channel.id}:`, error);
    throw new Error('Failed to get or create webhook');
  }
}

/**
 * Send a message via webhook with a specific personality
 * @param {Object} channel - Discord.js channel object
 * @param {string} content - Message content to send
 * @param {Object} personality - Personality data (name, avatar)
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} The sent message data
 */
async function sendWebhookMessage(channel, content, personality, options = {}) {
  try {
    console.log(`Attempting to send webhook message in channel ${channel.id} as ${personality.displayName}`);
    
    // Generate a unique tracking ID for this message to prevent duplicates
    const messageTrackingId = `${channel.id}-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
    
    // Check if we're already sending a very similar message
    if (activeWebhooks.has(messageTrackingId)) {
      console.log(`Duplicate message detected with ID ${messageTrackingId} - preventing double send`);
      return null;
    }
    
    // Mark this message as being processed
    activeWebhooks.add(messageTrackingId);
    
    try {
      const webhook = await getOrCreateWebhook(channel);
      
      // Prepare message data
      const messageData = {
        content: content,
        username: personality.displayName,
        avatarURL: personality.avatarUrl,
        allowedMentions: { parse: ['users', 'roles'] }, // Allow mentions
        threadId: channel.isThread() ? channel.id : undefined, // Support for threads
      };

      // Add optional embed if provided
      if (options.embed) {
        messageData.embeds = [
          new EmbedBuilder(options.embed)
        ];
      }

      // Add optional files if provided
      if (options.files) {
        messageData.files = options.files;
      }
      
      // Send the message
      console.log(`Sending webhook message with data: ${JSON.stringify({
        username: messageData.username,
        hasContent: !!messageData.content,
        hasEmbeds: !!messageData.embeds?.length,
        threadId: messageData.threadId
      })}`);
      
      const sentMessage = await webhook.send(messageData);
      console.log(`Successfully sent webhook message with ID: ${sentMessage.id}`);
      
      // Remove this message from active tracking after a short delay
      setTimeout(() => {
        activeWebhooks.delete(messageTrackingId);
      }, 5000);
      
      return sentMessage;
    } catch (error) {
      // Make sure to clean up on error
      activeWebhooks.delete(messageTrackingId);
      throw error;
    }
  } catch (error) {
    console.error('Error sending webhook message:', error);
    
    // If webhook is invalid, remove it from cache
    if (error.code === 10015) { // Unknown Webhook
      console.log(`Removing invalid webhook from cache for channel ${channel.id}`);
      webhookCache.delete(channel.id);
    }
    
    throw error;
  }
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
  }
}

/**
 * Clear all webhook caches
 */
function clearAllWebhookCaches() {
  for (const [channelId, webhook] of webhookCache.entries()) {
    webhook.destroy(); // Close any open connections
    webhookCache.delete(channelId);
  }
}

/**
 * Register event listeners for the Discord client
 * @param {Object} discordClient - Discord.js client instance
 */
function registerEventListeners(discordClient) {
  discordClient.on('channelDelete', channel => {
    clearWebhookCache(channel.id);
  });
}

module.exports = {
  getOrCreateWebhook,
  sendWebhookMessage,
  clearWebhookCache,
  clearAllWebhookCaches,
  registerEventListeners
};