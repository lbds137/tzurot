const { WebhookClient, EmbedBuilder } = require('discord.js');
const { client } = require('./bot');

// Cache to store webhook instances by channel ID
const webhookCache = new Map();

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
    
    // Look for our bot's webhook
    let webhook = webhooks.find(wh => 
      wh.owner && wh.owner.id === client.user.id && wh.name === 'Tzurot'
    );

    // If no webhook found, create a new one
    if (!webhook) {
      console.log(`Creating new webhook in channel ${channel.name} (${channel.id})`);
      webhook = await channel.createWebhook({
        name: 'Tzurot',
        avatar: 'https://i.imgur.com/your-default-avatar.png', // Replace with your bot's default avatar
        reason: 'Needed for personality proxying'
      });
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
    const sentMessage = await webhook.send(messageData);
    
    return sentMessage;
  } catch (error) {
    console.error('Error sending webhook message:', error);
    
    // If webhook is invalid, remove it from cache
    if (error.code === 10015) { // Unknown Webhook
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

// Set up event listeners for channel deletion
client.on('channelDelete', channel => {
  clearWebhookCache(channel.id);
});

module.exports = {
  getOrCreateWebhook,
  sendWebhookMessage,
  clearWebhookCache,
  clearAllWebhookCaches
};