const { WebhookClient, EmbedBuilder } = require('discord.js');
const fetch = require('node-fetch');
const logger = require('./logger');

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

  logger.info(`[WebhookManager] Warming up avatar URL: ${avatarUrl}`);

  try {
    // Make a GET request to ensure Discord caches the image
    // Use a timeout to prevent hanging on bad URLs
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(avatarUrl, {
      method: 'GET',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      logger.warn(`[WebhookManager] Avatar URL returned non-OK status: ${response.status}`);
      return;
    }

    // Add to cache so we don't warm up the same URL multiple times
    avatarWarmupCache.add(avatarUrl);
    logger.info(`[WebhookManager] Successfully warmed up avatar URL: ${avatarUrl}`);
  } catch (error) {
    logger.error(`[WebhookManager] Error warming up avatar URL: ${error.message}`);
    // Continue despite error - not critical
  }
}

/**
 * Split text by character limit at word boundaries
 * @param {string} text - Text to split
 * @returns {Array<string>} Array of text chunks
 */
function splitByCharacterLimit(text) {
  const chunks = [];
  let remainingText = text;
  
  while (remainingText.length > 0) {
    // Calculate chunk size based on message limit
    const chunkSize = Math.min(remainingText.length, MESSAGE_CHAR_LIMIT);
    
    // Try to find a natural break point (space)
    let splitIndex = remainingText.lastIndexOf(' ', chunkSize);
    
    // If no good break point found, just split at the limit
    if (splitIndex <= chunkSize * 0.5) {
      splitIndex = chunkSize;
    }
    
    // Add the chunk to our results
    chunks.push(remainingText.substring(0, splitIndex));
    
    // Remove the processed chunk
    remainingText = remainingText.substring(splitIndex).trim();
  }
  
  return chunks;
}

/**
 * Split a sentence into smaller chunks if needed
 * @param {string} sentence - Sentence to split
 * @param {Array<string>} chunks - Array to add chunks to
 * @param {string} currentChunk - Current chunk being built
 * @returns {string} Updated current chunk
 */
function processSentence(sentence, chunks, currentChunk) {
  // If adding this sentence exceeds the limit
  if (currentChunk.length + sentence.length + 1 > MESSAGE_CHAR_LIMIT) {
    // If the sentence itself is too long, split by character limit
    if (sentence.length > MESSAGE_CHAR_LIMIT) {
      // Add any existing content first
      if (currentChunk.length > 0) {
        chunks.push(currentChunk);
      }
      
      // Split the sentence by character limit
      const sentenceChunks = splitByCharacterLimit(sentence);
      chunks.push(...sentenceChunks);
      
      // Start with a fresh chunk
      return '';
    } else {
      // Sentence is within limit but combined is too long
      chunks.push(currentChunk);
      return sentence;
    }
  } else {
    // Add sentence to current chunk with space if needed
    return currentChunk.length > 0 ? `${currentChunk} ${sentence}` : sentence;
  }
}

/**
 * Process a single line of text
 * @param {string} line - Line to process
 * @param {Array<string>} chunks - Array to add chunks to
 * @param {string} currentChunk - Current chunk being built
 * @returns {string} Updated current chunk
 */
function processLine(line, chunks, currentChunk) {
  // If adding this line exceeds the limit
  if (currentChunk.length + line.length + 1 > MESSAGE_CHAR_LIMIT) {
    // If the line itself is too long, need to split by sentences
    if (line.length > MESSAGE_CHAR_LIMIT) {
      // Add any existing content first
      if (currentChunk.length > 0) {
        chunks.push(currentChunk);
      }
      
      // Split by sentences and process each
      const sentences = line.split(/(?<=[.!?])\s+/);
      let sentenceChunk = '';
      
      for (const sentence of sentences) {
        sentenceChunk = processSentence(sentence, chunks, sentenceChunk);
      }
      
      // Add any remaining content
      if (sentenceChunk.length > 0) {
        chunks.push(sentenceChunk);
      }
      
      return '';
    } else {
      // Line is within limit but combined is too long
      chunks.push(currentChunk);
      return line;
    }
  } else {
    // Add line to current chunk with newline if needed
    return currentChunk.length > 0 ? `${currentChunk}\n${line}` : line;
  }
}

/**
 * Process a paragraph
 * @param {string} paragraph - Paragraph to process
 * @param {Array<string>} chunks - Array to add chunks to
 * @param {string} currentChunk - Current chunk being built
 * @returns {string} Updated current chunk
 */
function processParagraph(paragraph, chunks, currentChunk) {
  // If adding this paragraph exceeds the limit
  if (currentChunk.length + paragraph.length + 2 > MESSAGE_CHAR_LIMIT) {
    // If paragraph itself is too long, need to split further
    if (paragraph.length > MESSAGE_CHAR_LIMIT) {
      // Add any existing content first
      if (currentChunk.length > 0) {
        chunks.push(currentChunk);
      }
      
      // Split paragraph by lines and process each
      const lines = paragraph.split(/\n/);
      let lineChunk = '';
      
      for (const line of lines) {
        lineChunk = processLine(line, chunks, lineChunk);
      }
      
      // Add any remaining content
      if (lineChunk.length > 0) {
        chunks.push(lineChunk);
      }
      
      return '';
    } else {
      // Paragraph is within limit but combined is too long
      chunks.push(currentChunk);
      return paragraph;
    }
  } else {
    // Add paragraph to current chunk with newlines if needed
    return currentChunk.length > 0 ? `${currentChunk}\n\n${paragraph}` : paragraph;
  }
}

/**
 * Split a long message into chunks at natural break points
 * @param {string} content - Message content to split
 * @returns {Array<string>} Array of message chunks
 */
function splitMessage(content) {
  // If message is within limits, return as is
  if (!content || content.length <= MESSAGE_CHAR_LIMIT) {
    return [content || ''];
  }
  
  const chunks = [];
  let currentChunk = '';
  
  // First split by paragraphs (double newlines)
  const paragraphs = content.split(/\n\s*\n/);
  
  // Process each paragraph
  for (const paragraph of paragraphs) {
    currentChunk = processParagraph(paragraph, chunks, currentChunk);
  }
  
  // Add any remaining content
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

    logger.info(`Found ${webhooks.size} webhooks in channel ${channel.name || channel.id}`);

    // Look for our bot's webhook - use simpler criteria
    let webhook = webhooks.find(wh => wh.name === 'Tzurot');

    // If no webhook found, create a new one
    if (!webhook) {
      logger.info(`Creating new webhook in channel ${channel.name || ''} (${channel.id})`);
      webhook = await channel.createWebhook({
        name: 'Tzurot',
        avatar: 'https://i.imgur.com/your-default-avatar.png', // Replace with your bot's default avatar
        reason: 'Needed for personality proxying',
      });
    } else {
      logger.info(`Found existing Tzurot webhook in channel ${channel.id}`);
    }

    // Create a webhook client for this webhook
    const webhookClient = new WebhookClient({ url: webhook.url });

    // Cache the webhook client
    webhookCache.set(channel.id, webhookClient);

    return webhookClient;
  } catch (error) {
    logger.error(`Error getting or creating webhook for channel ${channel.id}: ${error}`);
    throw new Error('Failed to get or create webhook');
  }
}

/**
 * Minimize console output during webhook operations
 * @returns {Object} Original console functions
 */
function minimizeConsoleOutput() {
  const originalConsoleLog = console.log;
  const originalConsoleWarn = console.warn;
  // Redirect to silent logger to maintain logs in files
  console.log = (msg, ...args) => {
    logger.debug("[SILENCED] " + (msg || ''), ...args);
  };
  console.warn = (msg, ...args) => {
    logger.debug("[SILENCED] " + (msg || ''), ...args);
  };
  return { originalConsoleLog, originalConsoleWarn };
}

/**
 * Restore console output functions
 * @param {Object} originalFunctions - The original console functions
 */
function restoreConsoleOutput(originalFunctions) {
  const { originalConsoleLog, originalConsoleWarn } = originalFunctions;
  console.log = originalConsoleLog;
  console.warn = originalConsoleWarn;
}

/**
 * Generate a unique tracking ID for messages
 * @param {string} channelId - Channel ID
 * @returns {string} A unique tracking ID
 */
function generateMessageTrackingId(channelId) {
  return `${channelId}-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
}

/**
 * Check if content contains error message patterns
 * @param {string} content - Message content
 * @returns {boolean} True if the content matches error patterns
 */
function isErrorContent(content) {
  if (!content) return false;
  
  return (
    content.includes("I'm having trouble connecting") ||
    content.includes('ERROR_MESSAGE_PREFIX:') ||
    content.includes('trouble connecting to my brain') ||
    content.includes('technical issue') ||
    content.includes('Error ID:') ||
    content.includes('issue with my configuration') ||
    content.includes('issue with my response system') ||
    content.includes('momentary lapse') ||
    content.includes('try again later') ||
    (content.includes('connection') && content.includes('unstable')) ||
    content.includes('unable to formulate') ||
    content.includes('Please try again')
  );
}

/**
 * Mark content as an error message by adding a prefix
 * @param {string} content - Message content
 * @returns {string} Content with error prefix if needed
 */
function markErrorContent(content) {
  if (!content) return '';
  
  if (
    content.includes('trouble connecting') ||
    content.includes('technical issue') ||
    content.includes('Error ID:') ||
    content.includes('issue with my configuration') ||
    content.includes('issue with my response system') ||
    content.includes('momentary lapse') ||
    content.includes('try again later') ||
    (content.includes('connection') && content.includes('unstable')) ||
    content.includes('unable to formulate') ||
    content.includes('Please try again')
  ) {
    logger.info(`[Webhook] Detected error message, adding special prefix`);
    return 'ERROR_MESSAGE_PREFIX: ' + content;
  }
  
  return content;
}

/**
 * Prepare message data for sending via webhook
 * @param {string} content - Message content
 * @param {string} username - Standardized username
 * @param {string} avatarUrl - Avatar URL
 * @param {boolean} isThread - Whether the channel is a thread
 * @param {string} threadId - Thread ID if applicable
 * @param {Object} options - Additional options
 * @returns {Object} Prepared message data
 */
function prepareMessageData(content, username, avatarUrl, isThread, threadId, options = {}) {
  const messageData = {
    content: content,
    username: username,
    avatarURL: avatarUrl || null,
    allowedMentions: { parse: ['users', 'roles'] },
    threadId: isThread ? threadId : undefined,
  };

  // Add optional embed if provided
  if (options.embed) {
    messageData.embeds = [new EmbedBuilder(options.embed)];
  }

  // Add optional files if provided
  if (options.files) {
    messageData.files = options.files;
  }

  return messageData;
}

/**
 * Send a single message chunk via webhook
 * @param {Object} webhook - Webhook client
 * @param {Object} messageData - Message data to send
 * @param {number} chunkIndex - Index of the current chunk
 * @param {number} totalChunks - Total number of chunks
 * @returns {Promise<Object>} Sent message
 */
async function sendMessageChunk(webhook, messageData, chunkIndex, totalChunks) {
  logger.debug(
    `Sending webhook message chunk ${chunkIndex + 1}/${totalChunks} with data: ${JSON.stringify({
      username: messageData.username,
      contentLength: messageData.content?.length,
      hasEmbeds: !!messageData.embeds?.length,
      threadId: messageData.threadId,
    })}`
  );

  try {
    const sentMessage = await webhook.send(messageData);
    logger.info(
      `Successfully sent webhook message chunk ${chunkIndex + 1}/${totalChunks} with ID: ${sentMessage.id}`
    );
    return sentMessage;
  } catch (error) {
    logger.error(`Error sending message chunk ${chunkIndex + 1}/${totalChunks}: ${error}`);
    
    // If this is because of length, try to send a simpler message indicating the error
    if (error.code === 50035) {
      // Invalid Form Body
      try {
        // Create a safe fallback message
        await webhook.send({
          content: `*[Error: Message chunk was too long to send. Some content may be missing.]*`,
          username: messageData.username,
          avatarURL: messageData.avatarURL,
          threadId: messageData.threadId,
        });
      } catch (finalError) {
        logger.error(`[Webhook] Failed to send error notification: ${finalError}`);
      }
    } else {
      // Log all error properties for better debugging
      logger.error('[Webhook] Webhook error details:', {
        code: error.code,
        message: error.message,
        name: error.name,
        stack: error.stack?.split('\n')[0] || 'No stack trace',
      });
    }
    
    throw error;
  }
}

/**
 * Create a virtual result for when all messages were duplicates
 * @param {Object} personality - Personality data
 * @param {string} channelId - Channel ID
 * @returns {Object} Virtual result object
 */
function createVirtualResult(personality, channelId) {
  logger.info(`[Webhook] All messages were duplicates, creating virtual result`);
  const virtualId = `virtual-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;

  // Clear pending message if we're returning a virtual result
  if (personality && personality.fullName) {
    clearPendingMessage(personality.fullName, channelId);
  }

  return {
    message: { id: virtualId },
    messageIds: [virtualId],
    isDuplicate: true,
  };
}

/**
 * Sends a message via Discord webhook with proper personality formatting and error handling
 *
 * @param {Object} channel - Discord.js channel object to send the message to
 * @param {string} content - Message content to send (will be split if too long)
 * @param {Object} personality - Personality data for webhook customization
 * @param {string} personality.displayName - The display name to show in Discord
 * @param {string} [personality.fullName] - The full name/identifier of the personality
 * @param {string} [personality.avatarUrl] - URL to the avatar image to use
 * @param {Object} [options={}] - Additional configuration options
 * @param {boolean} [options.allowMentions=false] - Whether to allow @mentions in the message
 * @param {boolean} [options.isErrorMessage=false] - Whether this is an error notification
 * @param {string} [options.threadId] - Thread ID if sending to a thread
 * @param {Array<Object>} [options.embeds] - Discord embed objects to attach to the message
 * @param {Array<Object>} [options.components] - Discord UI components to attach
 * @returns {Promise<Object>} The sent message data with success status
 *
 * @description
 * This is the core messaging function that handles all Discord webhook interactions.
 * It includes sophisticated handling for:
 * - Message splitting for content over Discord's character limit
 * - Webhook creation and caching for performance
 * - Error handling and logging for Discord API failures
 * - Avatar URL validation and pre-loading
 * - Message deduplication to prevent double-sends
 * - Proper formatting of personality names and avatars
 *
 * All messages from AI personalities should be sent through this function
 * to ensure consistent formatting and reliability.
 */
async function sendWebhookMessage(channel, content, personality, options = {}) {
  // Minimize console output during webhook operations
  const originalFunctions = minimizeConsoleOutput();
  
  try {
    logger.info(
      `Attempting to send webhook message in channel ${channel.id} as ${personality.displayName}`
    );

    // Generate a unique tracking ID for this message to prevent duplicates
    const messageTrackingId = generateMessageTrackingId(channel.id);

    // Check if we're already sending a very similar message
    if (activeWebhooks.has(messageTrackingId)) {
      logger.info(
        `Duplicate message detected with ID ${messageTrackingId} - preventing double send`
      );
      return null;
    }

    // Check if this is likely an error message
    const isErrorMessage = isErrorContent(content);

    // CRITICAL: If this is an error message AND the personality has a pending message
    // in this channel, completely drop this error message
    if (
      isErrorMessage &&
      personality.fullName &&
      hasPersonalityPendingMessage(personality.fullName, channel.id)
    ) {
      logger.info(
        `[Webhook] CRITICAL: Blocking error message for ${personality.fullName} due to pending message`
      );
      return null; // Do not send error message at all
    }

    // Register message as pending based on its type
    if (personality.fullName) {
      if (!isErrorMessage) {
        logger.info(`[Webhook] Registering normal message as pending for ${personality.fullName}`);
        registerPendingMessage(personality.fullName, channel.id, content, false);
      } else {
        logger.info(`[Webhook] Detected error message for ${personality.fullName}`);
        registerPendingMessage(personality.fullName, channel.id, content, true);
      }
    }

    // Apply any needed message delay for proper ordering
    const delayNeeded = calculateMessageDelay(channel.id);
    if (delayNeeded > 0) {
      logger.info(`[Webhook] Delaying message by ${delayNeeded}ms for channel ${channel.id}`);
      await new Promise(resolve => setTimeout(resolve, delayNeeded));
    }

    // Mark this message as being processed
    activeWebhooks.add(messageTrackingId);

    try {
      // Pre-load the avatar URL to ensure Discord caches it
      if (personality.avatarUrl) {
        await warmupAvatarUrl(personality.avatarUrl);
      }

      // Get the webhook client
      const webhook = await getOrCreateWebhook(channel);

      // Standardize the username to prevent duplicates
      const standardizedName = getStandardizedUsername(personality);
      logger.info(
        `[Webhook] Using standardized username: ${standardizedName} for personality ${personality.fullName}`
      );

      // Split message into chunks if needed
      let contentChunks = [''];
      try {
        const safeContent = typeof content === 'string' ? content : String(content || '');
        contentChunks = splitMessage(safeContent);
        logger.info(`[Webhook] Split message into ${contentChunks.length} chunks`);
      } catch (error) {
        logger.error(`[Webhook] Error splitting message content: ${error}`);
        contentChunks = ['[Error processing message content]'];
      }

      // Track sent messages
      let firstSentMessage = null;
      const sentMessageIds = [];

      // Send each chunk as a separate message
      for (let i = 0; i < contentChunks.length; i++) {
        const isFirstChunk = i === 0;
        let chunkContent = contentChunks[i];

        // Skip duplicate messages
        if (isDuplicateMessage(chunkContent, standardizedName, channel.id)) {
          logger.info(`[Webhook] Skipping message chunk ${i + 1} due to duplicate detection`);
          continue;
        }

        // Update last message time for proper ordering
        updateChannelLastMessageTime(channel.id);

        // Mark error content appropriately
        let finalContent = markErrorContent(chunkContent || '');

        // Skip hard-blocked content
        if (finalContent.includes('HARD_BLOCKED_RESPONSE_DO_NOT_DISPLAY')) {
          logger.info(
            `[Webhook] Detected HARD_BLOCKED_RESPONSE_DO_NOT_DISPLAY marker, skipping this message entirely`
          );
          continue;
        }

        // Prepare message data for this chunk
        const messageData = prepareMessageData(
          finalContent,
          standardizedName,
          personality.avatarUrl,
          channel.isThread(),
          channel.id,
          isFirstChunk ? options : {}
        );

        try {
          // Send the message chunk
          const sentMessage = await sendMessageChunk(webhook, messageData, i, contentChunks.length);
          
          // Track the message ID
          sentMessageIds.push(sentMessage.id);
          
          // Keep track of the first message
          if (isFirstChunk) {
            firstSentMessage = sentMessage;
          }
        } catch (error) {
          // If this is the first chunk and it failed, propagate the error
          if (isFirstChunk) {
            throw error;
          }
          // Otherwise, continue with the remaining chunks
        }
      }

      // Clean up tracking after a short delay
      setTimeout(() => {
        activeWebhooks.delete(messageTrackingId);
      }, 5000);

      // Clear pending message
      if (personality && personality.fullName) {
        clearPendingMessage(personality.fullName, channel.id);
      }

      // Log result information
      logger.info(`[Webhook] Returning result with: ${sentMessageIds.length} message IDs:`);
      sentMessageIds.forEach(id => logger.debug(`[Webhook] Message ID: ${id}`));

      // Return results or create a virtual result if needed
      if (sentMessageIds.length > 0) {
        return {
          message: firstSentMessage,
          messageIds: sentMessageIds,
        };
      } else {
        return createVirtualResult(personality, channel.id);
      }
    } catch (error) {
      // Clean up on error
      activeWebhooks.delete(messageTrackingId);
      throw error;
    }
  } catch (error) {
    logger.error(`Webhook error: ${error.message}`);

    // If webhook is invalid, remove from cache
    if (error.code === 10015) {
      // Unknown Webhook
      webhookCache.delete(channel.id);
    }

    // Restore console functions
    restoreConsoleOutput(originalFunctions);

    throw error;
  } finally {
    // Always restore console functions
    restoreConsoleOutput(originalFunctions);
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
    'ERROR_MESSAGE_PREFIX:',
    'trouble connecting to my brain',
    'technical issue',
    'Error ID:',
    'issue with my configuration',
    'issue with my response system',
    'momentary lapse',
    'try again later',
    'unable to formulate',
    'Please try again',
    'HARD_BLOCKED_RESPONSE_DO_NOT_DISPLAY',
    'connectivity problem',
    'I cannot access',
    'experiencing difficulties',
    'system error',
    'something went wrong',
    'service is unavailable',
    'not responding',
    'failed to generate',
    'unavailable at this time',
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

  require('discord.js').WebhookClient.prototype.send = async function (options) {
    // Normalize options to handle various function signatures
    const normalizedOptions = typeof options === 'string' ? { content: options } : options;

    // Check if this is an error message
    if (isErrorWebhookMessage(normalizedOptions)) {
      logger.info(`[Webhook CRITICAL] Intercepted error message at WebhookClient.send:`);
      logger.info(
        `[Webhook CRITICAL] Options: ${JSON.stringify({
          username: normalizedOptions.username,
          content: normalizedOptions.content?.substring(0, 50),
        })}`
      );

      // Return a dummy ID to simulate successful sending
      // This will prevent any error handling from triggering or retries
      logger.info(`[Webhook CRITICAL] Returning dummy ID instead of sending error message`);
      return {
        id: `blocked-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`,
        content: normalizedOptions.content,
        author: {
          username: normalizedOptions.username || 'Bot',
          bot: true,
        },
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
    logger.error(
      `[WebhookManager] Cannot preload avatar: personality object is null or undefined`
    );
    return;
  }

  if (!personality.avatarUrl) {
    logger.warn(
      `[WebhookManager] Cannot preload avatar: avatarUrl is not set for ${personality.fullName || 'unknown personality'}`
    );
    return;
  }

  logger.info(
    `[WebhookManager] Preloading avatar for ${personality.displayName || personality.fullName}: ${personality.avatarUrl}`
  );

  try {
    // First try a direct fetch to validate the URL
    const fetch = require('node-fetch');
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(personality.avatarUrl, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      logger.warn(
        `[WebhookManager] Personality avatar URL invalid: ${response.status} ${response.statusText}`
      );
      return;
    }

    // Read a small chunk of the response to ensure it's loaded
    const buffer = await response.buffer();
    logger.info(`[WebhookManager] Avatar image loaded (${buffer.length} bytes)`);

    // Then use our standard warmup function to cache it
    await warmupAvatarUrl(personality.avatarUrl);
    logger.info(
      `[WebhookManager] Successfully preloaded avatar for ${personality.displayName || personality.fullName}`
    );
  } catch (error) {
    logger.error(`[WebhookManager] Error preloading personality avatar: ${error.message}`);
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
    return 'Bot';
  }

  try {
    // ALWAYS prioritize displayName over any other field
    if (
      personality.displayName &&
      typeof personality.displayName === 'string' &&
      personality.displayName.trim().length > 0
    ) {
      const name = personality.displayName.trim();

      // Discord has a 32 character limit for webhook usernames
      if (name.length > 32) {
        return name.slice(0, 29) + '...';
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
          return extracted.slice(0, 29) + '...';
        }

        return extracted;
      }

      // If no hyphens, use the full name if short enough
      if (personality.fullName.length <= 32) {
        return personality.fullName;
      }

      // Truncate long names
      return personality.fullName.slice(0, 29) + '...';
    }
  } catch (error) {
    logger.error(`[Webhook] Error generating standard username: ${error}`);
  }

  // Final fallback
  return 'Bot';
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
    channelId,
  });
  logger.info(
    `[Webhook] Registered ${isError ? 'ERROR' : 'normal'} message for ${personalityName} in channel ${channelId}`
  );
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
    logger.info(`[Webhook] Cleared pending message for ${personalityName} in channel ${channelId}`);
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
      logger.info(`[Webhook] Need to delay message to channel ${channelId} by ${delayNeeded}ms`);
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
      logger.info(`[Webhook] Detected duplicate message with hash: ${hash}`);
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
  // Main webhook API functions
  getOrCreateWebhook,
  sendWebhookMessage,
  clearWebhookCache,
  clearAllWebhookCaches,
  registerEventListeners,
  preloadPersonalityAvatar,
  
  // Helper functions for usernames and messages
  getStandardizedUsername,
  isDuplicateMessage,
  hashMessage,
  splitMessage,
  
  // Console handling functions
  minimizeConsoleOutput,
  restoreConsoleOutput,
  
  // Message content processing
  isErrorContent,
  markErrorContent,
  prepareMessageData,
  sendMessageChunk,
  createVirtualResult,
  generateMessageTrackingId,
  
  // Message throttling functions
  hasPersonalityPendingMessage,
  registerPendingMessage,
  clearPendingMessage,
  calculateMessageDelay,
  updateChannelLastMessageTime,
  createPersonalityChannelKey,
  
  // For testing purposes
  splitByCharacterLimit,
  processSentence,
  processLine,
  processParagraph,
};