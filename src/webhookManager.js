const { WebhookClient, EmbedBuilder } = require('discord.js');
const fetch = require('node-fetch');

// Cache to store webhook instances by channel ID
const webhookCache = new Map();

// Track all active webhooks to prevent duplicates
const activeWebhooks = new Set();

// Cache to track avatar URLs we've already warmed up
const avatarWarmupCache = new Set();

// Cache to track recently sent messages to prevent duplicates
const recentMessageCache = new Map();

// Map to track personality+channel combinations with pending messages
// This is critical to prevent the fast error/slow success issue
const pendingPersonalityMessages = new Map();

// Track the last time a webhook message was sent to each channel
const channelLastMessageTime = new Map();

// Set a timeout for message caching (10 minutes)
const MESSAGE_CACHE_TIMEOUT = 10 * 60 * 1000; // 10 minutes in milliseconds

// Minimum delay between sending messages to ensure proper order (3 seconds)
const MIN_MESSAGE_DELAY = 3000; // 3 seconds 

// Maximum time to wait for a real response before allowing error message (15 seconds)
const MAX_ERROR_WAIT_TIME = 15000; // 15 seconds

// Discord message size limits 
const MESSAGE_CHAR_LIMIT = 2000;

/**
 * Pre-load an avatar URL to ensure Discord caches it
 * This helps with the issue where avatars don't show on first message
 * @param {string} avatarUrl - The URL of the avatar to pre-load
 */
async function warmupAvatarUrl(avatarUrl) {
  // Skip if null or already warmed up
  if (!avatarUrl || avatarWarmupCache.has(avatarUrl)) {
    return;
  }
  
  console.log(`[WebhookManager] Warming up avatar URL: ${avatarUrl}`);
  
  try {
    // Make a GET request to ensure Discord caches the image
    // Use a timeout to prevent hanging on bad URLs
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    const response = await fetch(avatarUrl, { 
      method: 'GET',
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      console.warn(`[WebhookManager] Avatar URL returned non-OK status: ${response.status}`);
      return;
    }
    
    // Add to cache so we don't warm up the same URL multiple times
    avatarWarmupCache.add(avatarUrl);
    console.log(`[WebhookManager] Successfully warmed up avatar URL: ${avatarUrl}`);
  } catch (error) {
    console.error(`[WebhookManager] Error warming up avatar URL: ${error.message}`);
    // Continue despite error - not critical
  }
}

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
  // Minimize console output during webhook operations
  const originalConsoleLog = console.log;
  const originalConsoleWarn = console.warn;
  console.log = () => {};
  console.warn = () => {};
  try {
    console.log(`Attempting to send webhook message in channel ${channel.id} as ${personality.displayName}`);
    
    // Generate a unique tracking ID for this message to prevent duplicates
    const messageTrackingId = `${channel.id}-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
    
    // Check if we're already sending a very similar message
    if (activeWebhooks.has(messageTrackingId)) {
      console.log(`Duplicate message detected with ID ${messageTrackingId} - preventing double send`);
      return null;
    }
    
    // Check if this is likely an error message
    const isErrorMessage = content && (
      content.includes("I'm having trouble connecting") ||
      content.includes("ERROR_MESSAGE_PREFIX:") ||
      content.includes("trouble connecting to my brain") ||
      content.includes("technical issue") ||
      content.includes("Error ID:") ||
      content.includes("issue with my configuration") ||
      content.includes("issue with my response system") ||
      content.includes("momentary lapse") ||
      content.includes("try again later") ||
      (content.includes("connection") && content.includes("unstable")) ||
      content.includes("unable to formulate") ||
      content.includes("Please try again")
    );
    
    // CRITICAL: If this is an error message AND the personality has a pending message
    // in this channel, completely drop this error message
    if (isErrorMessage && personality.fullName && hasPersonalityPendingMessage(personality.fullName, channel.id)) {
      console.log(`[Webhook] CRITICAL: Blocking error message for ${personality.fullName} due to pending message`);
      return null; // Do not send error message at all
    }
    
    // If this isn't an error message, register it as pending
    if (!isErrorMessage && personality.fullName) {
      console.log(`[Webhook] Registering normal message as pending for ${personality.fullName}`);
      registerPendingMessage(personality.fullName, channel.id, content, false);
    } else if (isErrorMessage && personality.fullName) {
      console.log(`[Webhook] Detected error message for ${personality.fullName}`);
      registerPendingMessage(personality.fullName, channel.id, content, true);
    }
    
    // Calculate any delay needed to ensure proper message ordering
    const delayNeeded = calculateMessageDelay(channel.id);
    if (delayNeeded > 0) {
      console.log(`[Webhook] Delaying message by ${delayNeeded}ms for channel ${channel.id}`);
      await new Promise(resolve => setTimeout(resolve, delayNeeded));
    }
    
    // Mark this message as being processed
    activeWebhooks.add(messageTrackingId);
    
    try {
      // Pre-load the avatar URL to ensure Discord caches it
      // This helps with the issue where avatars don't show on first message
      if (personality.avatarUrl) {
        await warmupAvatarUrl(personality.avatarUrl);
      }
      
      // Get the appropriate webhook client - we use a STATIC webhook shared for all messages
      const webhook = await getOrCreateWebhook(channel);
      
      // CRITICAL FIX: Force consistent username and prevent duplicate messages
      // We MUST standardize the username completely - NEVER use fullName which causes duplicate displays
      const standardizedName = getStandardizedUsername(personality);
      console.log(`[Webhook] Using standardized username: ${standardizedName} for personality ${personality.fullName}`);
      
      // Check if we need to split the message
      let contentChunks = [''];
      try {
        // Ensure content is a valid string
        const safeContent = typeof content === 'string' ? content : String(content || '');
        contentChunks = splitMessage(safeContent);
        console.log(`[Webhook] Split message into ${contentChunks.length} chunks`);
      } catch (error) {
        console.error('[Webhook] Error splitting message content:', error);
        contentChunks = ['[Error processing message content]'];
      }
      
      let firstSentMessage = null;
      
      // Track all sent message IDs in this conversation
      const sentMessageIds = [];
      
      // Now send each chunk as a separate message
      for (let i = 0; i < contentChunks.length; i++) {
        const isFirstChunk = i === 0;
        const isLastChunk = i === contentChunks.length - 1;
        
        // Use the chunk content as is, without adding continuation indicators
        let chunkContent = contentChunks[i];
        
        // CRITICAL FIX: Check if this exact message was recently sent to prevent duplicates
        // This prevents the double message problem by checking content + username + channel
        if (isDuplicateMessage(chunkContent, standardizedName, channel.id)) {
          console.log(`[Webhook] Skipping message chunk ${i+1} due to duplicate detection`);
          continue; // Skip this chunk, move to the next one
        }
        
        // Update last message time for this channel to ensure proper ordering
        updateChannelLastMessageTime(channel.id);
        
        // Add a special prefix to error messages to make them easy to filter
        let finalContent = chunkContent || "";
        if (finalContent.includes("trouble connecting") || 
            finalContent.includes("technical issue") || 
            finalContent.includes("Error ID:") ||
            finalContent.includes("issue with my configuration") ||
            finalContent.includes("issue with my response system") ||
            finalContent.includes("momentary lapse") ||
            finalContent.includes("try again later") ||
            (finalContent.includes("connection") && finalContent.includes("unstable")) ||
            finalContent.includes("unable to formulate") ||
            finalContent.includes("Please try again")) {
          // Mark this as an error message by adding a special prefix that our bot will recognize
          console.log(`[Webhook] Detected error message, adding special prefix`);
          finalContent = "ERROR_MESSAGE_PREFIX: " + finalContent;
        }
        
        // Completely discard any messages with our hard block marker
        if (finalContent.includes("HARD_BLOCKED_RESPONSE_DO_NOT_DISPLAY")) {
          console.log(`[Webhook] Detected HARD_BLOCKED_RESPONSE_DO_NOT_DISPLAY marker, skipping this message entirely`);
          continue; // Skip to the next chunk
        }
        
        // Prepare message data for this chunk - using the STANDARDIZED username
        const messageData = {
          content: finalContent, // Use our potentially marked content
          username: standardizedName, // Use our standardized username function
          avatarURL: personality.avatarUrl || null,
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
              // Create a safe fallback message with proper error handling
              // Just use the display name without the full name
              const safeDisplayName = personality?.displayName || "Bot";
              const safeAvatarURL = personality?.avatarUrl || null;
              const safeThreadId = channel.isThread() ? channel.id : undefined;
              
              await webhook.send({
                content: `*[Error: Message chunk was too long to send. Some content may be missing.]*`,
                username: safeDisplayName,
                avatarURL: safeAvatarURL,
                threadId: safeThreadId,
              });
            } catch (finalError) {
              console.error('[Webhook] Failed to send error notification:', finalError);
            }
          } else {
            // Log all error properties for better debugging
            console.error('[Webhook] Webhook error details:', {
              code: innerError.code,
              message: innerError.message,
              name: innerError.name,
              stack: innerError.stack?.split("\n")[0] || "No stack trace"
            });
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
      
      // Clear pending message for this personality+channel since we've sent the message
      if (personality && personality.fullName) {
        clearPendingMessage(personality.fullName, channel.id);
      }
      
      // Log return data for debugging
      console.log(`Returning webhook result with ${sentMessageIds.length} message IDs:`, sentMessageIds);
      
      // Add debugging info before returning
      console.log(`[Webhook] Returning result with: ${sentMessageIds.length} message IDs:`);
      sentMessageIds.forEach(id => console.log(`[Webhook] Message ID: ${id}`));
      
      // Return an object with the first message and all message IDs
      // If we didn't send any messages due to duplication, we'll create a "virtual" result
      // to ensure the conversation tracking still works
      if (sentMessageIds.length > 0) {
        return {
          message: firstSentMessage,
          messageIds: sentMessageIds
        };
      } else {
        // Create a "virtual" result since we skipped all messages due to duplication
        // This ensures conversation tracking still works properly
        console.log(`[Webhook] All messages were duplicates, creating virtual result`);
        const virtualId = `virtual-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
        
        // Clear pending message if we're returning a virtual result
        if (personality && personality.fullName) {
          clearPendingMessage(personality.fullName, channel.id);
        }
        
        return {
          message: { id: virtualId },
          messageIds: [virtualId],
          isDuplicate: true
        };
      }
    } catch (error) {
      // Make sure to clean up on error
      activeWebhooks.delete(messageTrackingId);
      throw error;
    }
  } catch (error) {
    console.error('Webhook error:', error.message);
    
    // If webhook is invalid, remove it from cache
    if (error.code === 10015) { // Unknown Webhook
      webhookCache.delete(channel.id);
    }
    
    // Restore console functions
    console.log = originalConsoleLog;
    console.warn = originalConsoleWarn;
    
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
 * Check if a pending webhook message might be an error
 * @param {Object} options - Webhook message options
 * @returns {boolean} - True if the message appears to be an error
 */
function isErrorWebhookMessage(options) {
  // If there's no content, it can't be an error
  if (!options || !options.content) return false;
  
  // Comprehensive list of error message patterns
  const errorPatterns = [
    "I'm having trouble connecting",
    "ERROR_MESSAGE_PREFIX:",
    "trouble connecting to my brain",
    "technical issue",
    "Error ID:",
    "issue with my configuration",
    "issue with my response system",
    "momentary lapse",
    "try again later",
    "unable to formulate",
    "Please try again",
    "HARD_BLOCKED_RESPONSE_DO_NOT_DISPLAY",
    "connectivity problem",
    "I cannot access",
    "experiencing difficulties",
    "system error",
    "something went wrong",
    "service is unavailable", 
    "not responding",
    "failed to generate",
    "unavailable at this time"
  ];
  
  // Check if content matches any error pattern
  return errorPatterns.some(pattern => options.content.includes(pattern));
}

/**
 * Register event listeners for the Discord client
 * @param {Object} discordClient - Discord.js client instance
 */
function registerEventListeners(discordClient) {
  // Clean up webhooks when channels are deleted
  discordClient.on('channelDelete', channel => {
    clearWebhookCache(channel.id);
  });
  
  // CRITICAL: Patch the WebhookClient prototype to intercept error messages at the source
  // This is an extreme measure to prevent error messages from ever being sent
  const originalSend = require('discord.js').WebhookClient.prototype.send;
  
  require('discord.js').WebhookClient.prototype.send = async function(options) {
    // Normalize options to handle various function signatures
    const normalizedOptions = typeof options === 'string' ? { content: options } : options;
    
    // Check if this is an error message
    if (isErrorWebhookMessage(normalizedOptions)) {
      console.log(`[Webhook CRITICAL] Intercepted error message at WebhookClient.send:`);
      console.log(`[Webhook CRITICAL] Options:`, JSON.stringify({
        username: normalizedOptions.username,
        content: normalizedOptions.content?.substring(0, 50)
      }));
      
      // Return a dummy ID to simulate successful sending
      // This will prevent any error handling from triggering or retries
      console.log(`[Webhook CRITICAL] Returning dummy ID instead of sending error message`);
      return {
        id: `blocked-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`,
        content: normalizedOptions.content,
        author: {
          username: normalizedOptions.username || "Bot",
          bot: true
        }
      };
    }
    
    // If not an error message, send normally
    return originalSend.apply(this, [options]);
  };
}

/**
 * Pre-load a personality's avatar
 * Helper function to ensure Discord caches the avatar before first use
 * @param {Object} personality - The personality object with avatarUrl
 */
async function preloadPersonalityAvatar(personality) {
  if (!personality) {
    console.error(`[WebhookManager] Cannot preload avatar: personality object is null or undefined`);
    return;
  }
  
  if (!personality.avatarUrl) {
    console.warn(`[WebhookManager] Cannot preload avatar: avatarUrl is not set for ${personality.fullName || 'unknown personality'}`);
    return;
  }
  
  console.log(`[WebhookManager] Preloading avatar for ${personality.displayName || personality.fullName}: ${personality.avatarUrl}`);
  
  try {
    // First try a direct fetch to validate the URL
    const fetch = require('node-fetch');
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    const response = await fetch(personality.avatarUrl, { 
      method: 'GET',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      console.warn(`[WebhookManager] Personality avatar URL invalid: ${response.status} ${response.statusText}`);
      return;
    }
    
    // Read a small chunk of the response to ensure it's loaded
    const buffer = await response.buffer();
    console.log(`[WebhookManager] Avatar image loaded (${buffer.length} bytes)`);
    
    // Then use our standard warmup function to cache it
    await warmupAvatarUrl(personality.avatarUrl);
    console.log(`[WebhookManager] Successfully preloaded avatar for ${personality.displayName || personality.fullName}`);
  } catch (error) {
    console.error(`[WebhookManager] Error preloading personality avatar:`, error.message);
  }
}

/**
 * Get a standardized username for a personality
 * This ensures consistent display across all messages
 * @param {Object} personality - The personality object
 * @returns {string} Standardized username
 */
function getStandardizedUsername(personality) {
  if (!personality) {
    return "Bot";
  }
  
  try {
    // ALWAYS prioritize displayName over any other field
    if (personality.displayName && typeof personality.displayName === 'string' && personality.displayName.trim().length > 0) {
      const name = personality.displayName.trim();
      
      // Discord has a 32 character limit for webhook usernames
      if (name.length > 32) {
        return name.slice(0, 29) + "...";
      }
      
      return name;
    }
    
    // Fallback: Extract name from fullName
    if (personality.fullName && typeof personality.fullName === 'string') {
      // If fullName has hyphens, use first part as display name
      const parts = personality.fullName.split('-');
      if (parts.length > 0 && parts[0].length > 0) {
        // Capitalize first letter for nicer display
        const extracted = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
        
        // Discord has a 32 character limit
        if (extracted.length > 32) {
          return extracted.slice(0, 29) + "...";
        }
        
        return extracted;
      }
      
      // If no hyphens, use the full name if short enough
      if (personality.fullName.length <= 32) {
        return personality.fullName;
      }
      
      // Truncate long names
      return personality.fullName.slice(0, 29) + "...";
    }
  } catch (error) {
    console.error(`[Webhook] Error generating standard username:`, error);
  }
  
  // Final fallback
  return "Bot";
}

/**
 * Create a key for tracking personality messages in a specific channel
 * @param {string} personalityName - The personality name
 * @param {string} channelId - The channel ID
 * @returns {string} A unique key for this personality+channel combination
 */
function createPersonalityChannelKey(personalityName, channelId) {
  return `${personalityName}_${channelId}`;
}

/**
 * Check if a personality has a pending message in a channel
 * @param {string} personalityName - The personality name
 * @param {string} channelId - The channel ID
 * @returns {boolean} True if there's a pending message
 */
function hasPersonalityPendingMessage(personalityName, channelId) {
  const key = createPersonalityChannelKey(personalityName, channelId);
  if (pendingPersonalityMessages.has(key)) {
    const pendingData = pendingPersonalityMessages.get(key);
    // If the pending message was created recently, block new sends
    if (Date.now() - pendingData.timestamp < MAX_ERROR_WAIT_TIME) {
      return true;
    } else {
      // Clean up expired entry
      pendingPersonalityMessages.delete(key);
    }
  }
  return false;
}

/**
 * Register a pending message for a personality in a channel
 * @param {string} personalityName - The personality name
 * @param {string} channelId - The channel ID
 * @param {string} content - The content of the pending message
 * @param {boolean} isError - Whether this is an error message
 */
function registerPendingMessage(personalityName, channelId, content, isError) {
  const key = createPersonalityChannelKey(personalityName, channelId);
  pendingPersonalityMessages.set(key, {
    timestamp: Date.now(),
    content: content?.substring(0, 100),
    isError,
    personalityName,
    channelId
  });
  console.log(`[Webhook] Registered ${isError ? 'ERROR' : 'normal'} message for ${personalityName} in channel ${channelId}`);
}

/**
 * Clear pending message for a personality in a channel
 * @param {string} personalityName - The personality name
 * @param {string} channelId - The channel ID
 */
function clearPendingMessage(personalityName, channelId) {
  const key = createPersonalityChannelKey(personalityName, channelId);
  if (pendingPersonalityMessages.has(key)) {
    pendingPersonalityMessages.delete(key);
    console.log(`[Webhook] Cleared pending message for ${personalityName} in channel ${channelId}`);
  }
}

/**
 * Calculate delay needed before sending next message to a channel
 * @param {string} channelId - The channel ID
 * @returns {number} Delay in milliseconds (0 if no delay needed)
 */
function calculateMessageDelay(channelId) {
  if (channelLastMessageTime.has(channelId)) {
    const lastTime = channelLastMessageTime.get(channelId);
    const timeSinceLastMessage = Date.now() - lastTime;
    
    if (timeSinceLastMessage < MIN_MESSAGE_DELAY) {
      // Need to wait to ensure proper message ordering
      const delayNeeded = MIN_MESSAGE_DELAY - timeSinceLastMessage;
      console.log(`[Webhook] Need to delay message to channel ${channelId} by ${delayNeeded}ms`);
      return delayNeeded;
    }
  }
  return 0;
}

/**
 * Update the last message time for a channel
 * @param {string} channelId - The channel ID
 */
function updateChannelLastMessageTime(channelId) {
  channelLastMessageTime.set(channelId, Date.now());
}

/**
 * Hash a message content to create a unique identifier
 * This helps detect duplicate messages
 * @param {string} content - The message content
 * @param {string} username - The username sending the message
 * @param {string} channelId - The channel ID
 * @returns {string} - A hash representing this message
 */
function hashMessage(content, username, channelId) {
  // Create a simple hash by combining the first 50 chars of content with username and channel
  const contentPrefix = (content || '').substring(0, 50);
  const hash = `${channelId}_${username}_${contentPrefix.replace(/\s+/g, '')}`;
  return hash;
}

/**
 * Check if a message is a duplicate of recently sent messages
 * @param {string} content - Message content
 * @param {string} username - Username sending the message
 * @param {string} channelId - Channel ID
 * @returns {boolean} - True if this appears to be a duplicate
 */
function isDuplicateMessage(content, username, channelId) {
  // If content is empty, it can't be a duplicate
  if (!content || content.length === 0) {
    return false;
  }
  
  // Create a hash key for this message
  const hash = hashMessage(content, username, channelId);
  
  // Check if the hash exists in our cache
  if (recentMessageCache.has(hash)) {
    const timestamp = recentMessageCache.get(hash);
    // Only consider it a duplicate if it was sent within the cache timeout
    if (Date.now() - timestamp < MESSAGE_CACHE_TIMEOUT) {
      console.log(`[Webhook] Detected duplicate message with hash: ${hash}`);
      return true;
    }
  }
  
  // Not a duplicate, add to cache
  recentMessageCache.set(hash, Date.now());
  
  // Cleanup old cache entries
  const now = Date.now();
  for (const [key, timestamp] of recentMessageCache.entries()) {
    if (now - timestamp > MESSAGE_CACHE_TIMEOUT) {
      recentMessageCache.delete(key);
    }
  }
  
  return false;
}

module.exports = {
  getOrCreateWebhook,
  sendWebhookMessage,
  clearWebhookCache,
  clearAllWebhookCaches,
  registerEventListeners,
  preloadPersonalityAvatar,
  getStandardizedUsername,
  isDuplicateMessage,
  hashMessage,
  // Export the new message throttling functions
  hasPersonalityPendingMessage,
  registerPendingMessage,
  clearPendingMessage,
  calculateMessageDelay,
  updateChannelLastMessageTime,
  createPersonalityChannelKey
};