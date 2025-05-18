const { WebhookClient, EmbedBuilder } = require('discord.js');

// Cache to store webhook instances by channel ID
const webhookCache = new Map();

// Track all active webhooks to prevent duplicates
const activeWebhooks = new Set();

// Discord message size limits
const MESSAGE_CHAR_LIMIT = 2000;

/**
 * Split a long message into chunks at natural break points
 * @param {string} content - Message content to split
 * @returns {Array<string>} Array of message chunks
 */
function splitMessage(content) {
  // If message is within limits, return as is
  if (content.length <= MESSAGE_CHAR_LIMIT) {
    return [content];
  }

  const chunks = [];
  let currentChunk = '';
  
  // First try to split by paragraphs (double newlines)
  const paragraphs = content.split(/\n\s*\n/);
  
  for (const paragraph of paragraphs) {
    // If adding this paragraph exceeds the limit
    if (currentChunk.length + paragraph.length + 2 > MESSAGE_CHAR_LIMIT) {
      // If current paragraph itself is too long, need to split further
      if (paragraph.length > MESSAGE_CHAR_LIMIT) {
        // If we have content in currentChunk, push it first
        if (currentChunk.length > 0) {
          chunks.push(currentChunk);
          currentChunk = '';
        }
        
        // Split paragraph by single newlines
        const lines = paragraph.split(/\n/);
        let lineChunk = '';
        
        for (const line of lines) {
          // If adding this line exceeds the limit
          if (lineChunk.length + line.length + 1 > MESSAGE_CHAR_LIMIT) {
            // If the line itself is too long, need to split by sentences
            if (line.length > MESSAGE_CHAR_LIMIT) {
              // If we have content in lineChunk, push it first
              if (lineChunk.length > 0) {
                chunks.push(lineChunk);
                lineChunk = '';
              }
              
              // Split by sentences
              const sentences = line.split(/(?<=[.!?])\s+/);
              let sentenceChunk = '';
              
              for (const sentence of sentences) {
                // If adding this sentence exceeds the limit
                if (sentenceChunk.length + sentence.length + 1 > MESSAGE_CHAR_LIMIT) {
                  // If the sentence itself is too long, split by hard character limit
                  if (sentence.length > MESSAGE_CHAR_LIMIT) {
                    // If we have content in sentenceChunk, push it first
                    if (sentenceChunk.length > 0) {
                      chunks.push(sentenceChunk);
                      sentenceChunk = '';
                    }
                    
                    // Split by character limit at word boundaries if possible
                    let remainingSentence = sentence;
                    while (remainingSentence.length > 0) {
                      // Try to find last space within the limit
                      const chunkSize = Math.min(remainingSentence.length, MESSAGE_CHAR_LIMIT);
                      let splitIndex = remainingSentence.lastIndexOf(' ', chunkSize);
                      
                      // If no space found or it's too close to start, just split at limit
                      if (splitIndex <= chunkSize * 0.5) {
                        splitIndex = chunkSize;
                      }
                      
                      chunks.push(remainingSentence.substring(0, splitIndex));
                      
                      // Move to next chunk of the sentence
                      remainingSentence = remainingSentence.substring(splitIndex).trim();
                    }
                  } else {
                    // Sentence is within limit but combined is too long
                    chunks.push(sentenceChunk);
                    sentenceChunk = sentence;
                  }
                } else {
                  // Add sentence to current chunk
                  sentenceChunk = sentenceChunk.length > 0 
                    ? `${sentenceChunk} ${sentence}` 
                    : sentence;
                }
              }
              
              // Add any remaining sentence chunk
              if (sentenceChunk.length > 0) {
                chunks.push(sentenceChunk);
              }
            } else {
              // Line is within limit but combined is too long
              chunks.push(lineChunk);
              lineChunk = line;
            }
          } else {
            // Add line to current chunk
            lineChunk = lineChunk.length > 0 
              ? `${lineChunk}\n${line}` 
              : line;
          }
        }
        
        // Add any remaining line chunk
        if (lineChunk.length > 0) {
          chunks.push(lineChunk);
        }
      } else {
        // Paragraph is within limit but combined is too long
        chunks.push(currentChunk);
        currentChunk = paragraph;
      }
    } else {
      // Add paragraph to current chunk
      currentChunk = currentChunk.length > 0 
        ? `${currentChunk}\n\n${paragraph}` 
        : paragraph;
    }
  }
  
  // Add any remaining chunk
  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }
  
  return chunks;
}

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
      
      // Check if we need to split the message
      const contentChunks = typeof content === 'string' ? splitMessage(content) : [''];
      let firstSentMessage = null;
      
      // Track all sent message IDs in this conversation
      const sentMessageIds = [];
      
      // Now send each chunk as a separate message
      for (let i = 0; i < contentChunks.length; i++) {
        const isFirstChunk = i === 0;
        const isLastChunk = i === contentChunks.length - 1;
        
        // Use the chunk content as is, without adding continuation indicators
        let chunkContent = contentChunks[i];
        
        // Prepare message data for this chunk
        const messageData = {
          content: chunkContent,
          username: personality.displayName,
          avatarURL: personality.avatarUrl,
          allowedMentions: { parse: ['users', 'roles'] }, // Allow mentions
          threadId: channel.isThread() ? channel.id : undefined, // Support for threads
        };

        // Add optional embed if provided - only on the first chunk
        if (isFirstChunk && options.embed) {
          messageData.embeds = [
            new EmbedBuilder(options.embed)
          ];
        }

        // Add optional files if provided - only on the first chunk
        if (isFirstChunk && options.files) {
          messageData.files = options.files;
        }
        
        // Log what we're sending
        console.log(`Sending webhook message chunk ${i+1}/${contentChunks.length} with data: ${JSON.stringify({
          username: messageData.username,
          contentLength: messageData.content?.length,
          hasEmbeds: !!messageData.embeds?.length,
          threadId: messageData.threadId
        })}`);
        
        // Send the message
        try {
          const sentMessage = await webhook.send(messageData);
          console.log(`Successfully sent webhook message chunk ${i+1}/${contentChunks.length} with ID: ${sentMessage.id}`);
          
          // Track this message ID
          console.log(`Adding message ID to tracking: ${sentMessage.id}, webhook ID: ${sentMessage.webhookId || 'unknown'}`);
          sentMessageIds.push(sentMessage.id);
          
          // Keep track of the first message for returning
          if (isFirstChunk) {
            firstSentMessage = sentMessage;
            console.log(`Storing first message: ID=${sentMessage.id}, webhookId=${sentMessage.webhookId || 'unknown'}, channel=${channel.id}`);
          }
        } catch (innerError) {
          console.error(`Error sending message chunk ${i+1}/${contentChunks.length}:`, innerError);
          
          // If this is because of length, try to send a simpler message indicating the error
          if (innerError.code === 50035) { // Invalid Form Body
            try {
              await webhook.send({
                content: `*[Error: Message chunk was too long to send. Some content may be missing.]*`,
                username: personality.displayName,
                avatarURL: personality.avatarUrl,
                threadId: channel.isThread() ? channel.id : undefined,
              });
            } catch (finalError) {
              console.error('Failed to send error notification:', finalError);
            }
          }
          
          // If this is the first chunk and it failed, we need to propagate the error
          if (isFirstChunk) {
            throw innerError;
          }
        }
      }
      
      // Remove this message from active tracking after a short delay
      setTimeout(() => {
        activeWebhooks.delete(messageTrackingId);
      }, 5000);
      
      // Log return data for debugging
      console.log(`Returning webhook result with ${sentMessageIds.length} message IDs:`, sentMessageIds);
      
      // Add debugging info before returning
      console.log(`[Webhook] Returning result with: ${sentMessageIds.length} message IDs:`);
      sentMessageIds.forEach(id => console.log(`[Webhook] Message ID: ${id}`));
      
      // Return an object with the first message and all message IDs
      return {
        message: firstSentMessage,
        messageIds: sentMessageIds
      };
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