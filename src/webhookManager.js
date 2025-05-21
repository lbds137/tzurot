/**
 * Webhook Manager
 *
 * This module handles all interaction with Discord webhooks, including:
 * - Creating and caching webhook clients
 * - Formatting and sending messages via webhooks
 * - Error handling and recovery
 * - Rate limiting and message ordering
 * - Avatar URL validation and caching
 *
 * TODO: Future improvements
 * - Implement retry mechanism for transient webhook failures
 * - Add more robust rate limiting to prevent Discord API throttling
 * - Enhance error classification for better debugging
 * - Consider implementing webhook rotation for high-volume channels
 */

const { WebhookClient, EmbedBuilder } = require('discord.js');
const fetch = require('node-fetch');
const logger = require('./logger');
const errorTracker = require('./utils/errorTracker');
const urlValidator = require('./utils/urlValidator');
const { mediaHandler, processMediaForWebhook, prepareAttachmentOptions } = require('./utils/media');

const { TIME, DISCORD } = require('./constants');

// Cache to store webhook instances by channel ID
const webhookCache = new Map();

// Track all active webhooks to prevent duplicates
const activeWebhooks = new Set();

// Cache to track avatar URLs we've already warmed up
const avatarWarmupCache = new Set();

// We no longer use a fallback avatar URL - Discord will handle this automatically

// Cache to track recently sent messages to prevent duplicates
const recentMessageCache = new Map();

// Map to track personality+channel combinations with pending messages
// This is critical to prevent the fast error/slow success issue
const pendingPersonalityMessages = new Map();

// Track the last time a webhook message was sent to each channel
const channelLastMessageTime = new Map();

// Set a timeout for message caching (from constants)
const MESSAGE_CACHE_TIMEOUT = TIME.MESSAGE_CACHE_TIMEOUT;

// Minimum delay between sending messages to ensure proper order (from constants)
const MIN_MESSAGE_DELAY = TIME.MIN_MESSAGE_DELAY;

// Maximum time to wait for a real response before allowing error message (from constants)
const MAX_ERROR_WAIT_TIME = TIME.MAX_ERROR_WAIT_TIME;

// Discord message size limits (from constants)
const MESSAGE_CHAR_LIMIT = DISCORD.MESSAGE_CHAR_LIMIT;

/**
 * Validate if an avatar URL is accessible and correctly formatted
 * @param {string} avatarUrl - The URL to validate
 * @returns {Promise<boolean>} - True if the avatar URL is valid
 */
async function validateAvatarUrl(avatarUrl) {
  if (!avatarUrl) return false;

  // Check if URL is correctly formatted
  if (!urlValidator.isValidUrlFormat(avatarUrl)) {
    return false;
  }

  // Handle Discord CDN URLs specially - they're always valid without checking
  if (
    urlValidator.isTrustedDomain(avatarUrl, [
      'cdn.discordapp.com',
      'discord.com/assets',
      'media.discordapp.net',
    ])
  ) {
    logger.info(`[WebhookManager] Discord CDN URL detected, skipping validation: ${avatarUrl}`);
    return true;
  }

  try {
    // Use the enhanced URL validator
    const isValidImage = await urlValidator.isImageUrl(avatarUrl, {
      timeout: 5000,
      trustExtensions: true,
    });

    if (!isValidImage) {
      logger.warn(
        `[WebhookManager] Invalid avatar URL: ${avatarUrl}, does not point to a valid image`
      );

      // Track this validation error for debugging
      errorTracker.trackError(new Error(`Invalid avatar URL: ${avatarUrl}`), {
        category: errorTracker.ErrorCategory.AVATAR,
        operation: 'validateAvatarUrl',
        metadata: {
          url: avatarUrl,
          urlParts: new URL(avatarUrl),
        },
        isCritical: false,
      });
    }

    return isValidImage;
  } catch (error) {
    // Record the error with our error tracker
    errorTracker.trackError(error, {
      category: errorTracker.ErrorCategory.AVATAR,
      operation: 'validateAvatarUrl',
      metadata: {
        url: avatarUrl,
      },
      isCritical: false,
    });

    logger.warn(`[WebhookManager] Error validating avatar URL: ${error.message} for ${avatarUrl}`);

    // Special case: if it has an image extension, trust it despite fetch errors
    if (urlValidator.hasImageExtension(avatarUrl)) {
      logger.info(
        `[WebhookManager] URL appears to be an image based on extension, accepting despite errors: ${avatarUrl}`
      );
      return true;
    }

    return false;
  }
}

/**
 * Get a valid avatar URL
 * @param {string} avatarUrl - The original avatar URL to try
 * @returns {Promise<string|null>} - A valid avatar URL or null
 */
async function getValidAvatarUrl(avatarUrl) {
  // If no URL provided, return null
  if (!avatarUrl) {
    logger.debug(`[WebhookManager] No avatar URL provided, returning null`);
    return null;
  }

  // Check if the URL is valid
  const isValid = await validateAvatarUrl(avatarUrl);

  if (isValid) {
    return avatarUrl;
  } else {
    logger.info(`[WebhookManager] Invalid avatar URL: ${avatarUrl}, returning null`);
    return null;
  }
}

/**
 * Pre-load an avatar URL to ensure Discord caches it
 * This helps with the issue where avatars don't show on first message
 * @param {string} avatarUrl - The URL of the avatar to pre-load
 * @param {number} [retryCount=1] - Number of retries if warmup fails (internal parameter)
 * @returns {Promise<string|null>} - The warmed up avatar URL or null
 */
async function warmupAvatarUrl(avatarUrl, retryCount = 1) {
  // Skip if null or already warmed up
  if (!avatarUrl) {
    logger.debug(`[WebhookManager] No avatar URL to warm up, returning null`);
    return null;
  }

  if (avatarWarmupCache.has(avatarUrl)) {
    logger.debug(`[WebhookManager] Avatar URL already warmed up: ${avatarUrl}`);
    return avatarUrl;
  }

  logger.info(`[WebhookManager] Warming up avatar URL: ${avatarUrl}`);

  // Handle Discord CDN URLs specially - they're always valid and don't need warmup
  if (avatarUrl.includes('cdn.discordapp.com') || avatarUrl.includes('discord.com/assets')) {
    logger.info(`[WebhookManager] Discord CDN URL detected, skipping warmup: ${avatarUrl}`);
    avatarWarmupCache.add(avatarUrl);
    return avatarUrl;
  }

  // Skip warmup for specific known domains that are likely to block direct fetches
  const skipWarmupDomains = [
    'i.imgur.com',
    'imgur.com',
    'media.discordapp.net',
    'cdn.discordapp.com',
  ];

  const urlObj = new URL(avatarUrl);
  if (skipWarmupDomains.some(domain => urlObj.hostname.includes(domain))) {
    logger.info(
      `[WebhookManager] Known reliable domain detected (${urlObj.hostname}), skipping warmup for: ${avatarUrl}`
    );

    // Trust URLs with image extensions without validation
    if (avatarUrl.match(/\.(png|jpg|jpeg|gif|webp)(\?.*)?$/i)) {
      avatarWarmupCache.add(avatarUrl);
      return avatarUrl;
    }
  }

  try {
    // First ensure the avatar URL is valid
    const validUrl = await getValidAvatarUrl(avatarUrl);

    // If we got null, it means the original URL was invalid
    if (validUrl === null) {
      return null; // Don't bother warming up an invalid URL
    }

    // Make a GET request to ensure Discord caches the image
    // Use a timeout to prevent hanging on bad URLs
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(validUrl, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        Referer: 'https://discord.com/',
        'Cache-Control': 'no-cache',
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      logger.warn(`[WebhookManager] Avatar URL returned non-OK status: ${response.status}`);

      // If it's imgur or certain other domains and has an image extension, consider it valid
      // despite the response error (might be anti-hotlinking measures)
      if (
        skipWarmupDomains.some(domain => urlObj.hostname.includes(domain)) &&
        avatarUrl.match(/\.(png|jpg|jpeg|gif|webp)(\?.*)?$/i)
      ) {
        logger.info(
          `[WebhookManager] Likely valid image despite error response, accepting: ${avatarUrl}`
        );
        avatarWarmupCache.add(avatarUrl);
        return avatarUrl;
      }

      throw new Error(`Failed to warm up avatar: ${response.status} ${response.statusText}`);
    }

    // Check content type to ensure it's an image or a generic binary file
    const contentType = response.headers.get('content-type');
    // Log the content type for debugging purposes
    logger.debug(`[WebhookManager] Avatar URL content type: ${contentType} for ${avatarUrl}`);

    // Skip this check for application/octet-stream as it's a generic binary content type often used for images
    if (
      contentType &&
      !contentType.startsWith('image/') &&
      contentType !== 'application/octet-stream'
    ) {
      logger.warn(
        `[WebhookManager] Avatar URL has non-image content type: ${contentType} for ${avatarUrl}`
      );
      // Don't reject here, just log a warning - the image extension or reader check will validate further
    }

    // Read a small chunk of the response to ensure it's properly loaded
    try {
      // Check if response body has a getReader method (streams API)
      if (response.body && typeof response.body.getReader === 'function') {
        // Modern streams approach
        const reader = response.body.getReader();
        const { done, value } = await reader.read();
        reader.cancel();

        if (done || !value || value.length === 0) {
          logger.warn(`[WebhookManager] Avatar URL returned an empty response: ${avatarUrl}`);
          throw new Error('Empty response from avatar URL');
        }

        logger.debug(`[WebhookManager] Avatar loaded (${value.length} bytes) using streams API`);
      } else {
        // Fallback: try to use buffer/arrayBuffer approach
        // This handles older node-fetch versions or environments without streams support

        // Try arrayBuffer first (more modern)
        if (typeof response.arrayBuffer === 'function') {
          const buffer = await response.arrayBuffer();
          if (!buffer || buffer.byteLength === 0) {
            logger.warn(`[WebhookManager] Avatar URL returned an empty arrayBuffer: ${avatarUrl}`);
            throw new Error('Empty arrayBuffer from avatar URL');
          }
          logger.debug(
            `[WebhookManager] Avatar loaded (${buffer.byteLength} bytes) using arrayBuffer`
          );
        }
        // Fall back to text/blob or just trust the status
        else if (typeof response.text === 'function') {
          const text = await response.text();
          if (!text || text.length === 0) {
            logger.warn(`[WebhookManager] Avatar URL returned empty text: ${avatarUrl}`);
            throw new Error('Empty text from avatar URL');
          }
          logger.debug(`[WebhookManager] Avatar loaded (${text.length} chars) using text API`);
        } else {
          // If we can't read in any way but response was OK, still consider it valid
          logger.info(
            `[WebhookManager] Cannot read avatar response body, but status is OK. Considering valid.`
          );
        }
      }
    } catch (readError) {
      // If we can't read the body but response was OK, still consider it valid
      logger.warn(
        `[WebhookManager] Couldn't read avatar response but status was OK: ${readError.message}`
      );
    }

    // Add to cache so we don't warm up the same URL multiple times
    avatarWarmupCache.add(validUrl);
    logger.info(`[WebhookManager] Successfully warmed up avatar URL: ${validUrl}`);

    return validUrl;
  } catch (error) {
    logger.error(`[WebhookManager] Error warming up avatar URL: ${error.message}`);

    // Check if it's a URL with image extension despite errors
    if (avatarUrl.match(/\.(png|jpg|jpeg|gif|webp)(\?.*)?$/i)) {
      logger.info(
        `[WebhookManager] URL appears to be an image based on extension, accepting despite errors: ${avatarUrl}`
      );
      avatarWarmupCache.add(avatarUrl);
      return avatarUrl;
    }

    // Retry logic - up to 2 retries (3 attempts total)
    if (retryCount < 3) {
      logger.info(
        `[WebhookManager] Retrying avatar warmup (attempt ${retryCount + 1}/3) for: ${avatarUrl}`
      );
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second before retry
      return warmupAvatarUrl(avatarUrl, retryCount + 1);
    }

    // After all retries failed, return null
    logger.warn(`[WebhookManager] All warmup attempts failed for ${avatarUrl}, returning null`);
    return null;
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
      const sentenceChunk = '';
      const processedChunk = sentences.reduce((chunk, sentence) => {
        return processSentence(sentence, chunks, chunk);
      }, sentenceChunk);

      // Add any remaining content
      if (processedChunk.length > 0) {
        chunks.push(processedChunk);
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
      const lineChunk = '';
      const processedChunk = lines.reduce((chunk, line) => {
        return processLine(line, chunks, chunk);
      }, lineChunk);

      // Add any remaining content
      if (processedChunk.length > 0) {
        chunks.push(processedChunk);
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
  const isThread = channel.isThread();
  const channelId = channel.id;
  
  // If this is a thread, we need special handling
  if (isThread) {
    logger.info(`[WebhookManager] Getting webhook for thread ${channelId}`);
    
    // For threads, we need to:
    // 1. Get a webhook for the parent channel
    // 2. Then create a thread-specific instance of that webhook
    
    // First, check if we already have a thread-specific webhook cached
    const threadSpecificCacheKey = `thread-${channelId}`;
    if (webhookCache.has(threadSpecificCacheKey)) {
      logger.info(`[WebhookManager] Using cached thread-specific webhook for thread ${channelId}`);
      return webhookCache.get(threadSpecificCacheKey);
    }
    
    // Get the parent channel
    const parentChannel = channel.parent;
    
    if (!parentChannel) {
      throw new Error(`Cannot find parent channel for thread ${channelId}`);
    }
    
    logger.info(`[WebhookManager] Thread ${channelId} has parent channel ${parentChannel.id} (${parentChannel.name || 'unnamed'})`);
    
    // Get or create a webhook for the parent channel
    // First check if we have already cached the parent channel's webhook
    let parentWebhookClient;
    if (webhookCache.has(parentChannel.id)) {
      logger.info(`[WebhookManager] Using cached webhook for parent channel ${parentChannel.id}`);
      parentWebhookClient = webhookCache.get(parentChannel.id);
    } else {
      // Need to create or find a webhook for the parent channel
      logger.info(`[WebhookManager] Getting webhooks for parent channel ${parentChannel.id}`);
      const webhooks = await parentChannel.fetchWebhooks();
      
      logger.info(`[WebhookManager] Found ${webhooks.size} webhooks in parent channel ${parentChannel.id}`);
      
      // Look for our bot's webhook
      let webhook = webhooks.find(wh => wh.name === 'Tzurot');
      
      // If no webhook found, create a new one
      if (!webhook) {
        logger.info(`[WebhookManager] Creating new webhook in parent channel ${parentChannel.id}`);
        webhook = await parentChannel.createWebhook({
          name: 'Tzurot',
          reason: 'Needed for personality proxying',
        });
      } else {
        logger.info(`[WebhookManager] Found existing Tzurot webhook in parent channel ${parentChannel.id}`);
      }
      
      // Create a webhook client for the parent channel
      parentWebhookClient = new WebhookClient({ url: webhook.url });
      
      // Cache the parent channel webhook
      webhookCache.set(parentChannel.id, parentWebhookClient);
    }
    
    // IMPORTANT: Now create a THREAD-SPECIFIC webhook client
    // This is the key to making thread posting work correctly
    logger.info(`[WebhookManager] Creating thread-specific webhook client for thread ${channelId}`);
    
    // Create a thread-specific instance with explicit thread ID
    try {
      // Use webhook.thread() method to get a thread-specific webhook client
      const threadWebhookClient = parentWebhookClient.thread(channelId);
      
      // Store metadata
      threadWebhookClient._tzurotMeta = {
        isThread: true,
        threadId: channelId,
        parentChannelId: parentChannel.id,
        createdAt: Date.now()
      };
      
      // Cache the thread-specific webhook client using a special key
      webhookCache.set(threadSpecificCacheKey, threadWebhookClient);
      
      // Also cache it under the regular channel ID for backward compatibility
      webhookCache.set(channelId, threadWebhookClient);
      
      logger.info(`[WebhookManager] Successfully created thread-specific webhook client for thread ${channelId}`);
      
      return threadWebhookClient;
    } catch (threadError) {
      logger.error(`[WebhookManager] Error creating thread-specific webhook: ${threadError.message}`);
      logger.info(`[WebhookManager] Falling back to parent webhook with thread_id parameter`);
      
      // If thread() method fails, return the parent webhook client
      // with metadata for thread handling
      parentWebhookClient._tzurotMeta = {
        isThread: true,
        threadId: channelId,
        parentChannelId: parentChannel.id,
        createdAt: Date.now(),
        threadMethodFailed: true
      };
      
      // Cache using the thread's channel ID
      webhookCache.set(channelId, parentWebhookClient);
      
      return parentWebhookClient;
    }
  }
  
  // Regular (non-thread) channel handling follows the original logic
  if (webhookCache.has(channelId)) {
    return webhookCache.get(channelId);
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
        reason: 'Needed for personality proxying',
      });
    } else {
      logger.info(`Found existing Tzurot webhook in channel ${channel.id}`);
    }

    // Create a webhook client for this webhook
    const webhookClient = new WebhookClient({ url: webhook.url });
    
    // Store additional metadata about the channel
    webhookClient._tzurotMeta = {
      isThread: false,
      threadId: undefined,
      channelId: channel.id,
      createdAt: Date.now()
    };
    
    // Log detailed information about the webhook
    logger.info(`[WebhookManager] Created webhook client for channel ${channel.id}`);

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
 * @returns {Object} Original console functions (empty object since we now use structured logger)
 */
function minimizeConsoleOutput() {
  // With structured logging in place, we don't need to silence anything
  // This function is kept for backwards compatibility
  return {};
}

/**
 * Restore console output functions
 * This is kept for backwards compatibility but does nothing with structured logging
 */
function restoreConsoleOutput() {
  // With structured logging in place, we don't need to restore anything
  // This function is kept for backwards compatibility
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

  // Use the centralized error messages from constants
  const { ERROR_MESSAGES } = require('./constants');

  // Special case for combined terms
  if (content.includes('connection') && content.includes('unstable')) {
    return true;
  }

  // Check against the standard error message patterns
  return ERROR_MESSAGES.some(pattern => content.includes(pattern));
}

/**
 * Mark content as an error message by adding a prefix
 * @param {string} content - Message content
 * @returns {string} Content with error prefix if needed
 */
function markErrorContent(content) {
  if (!content) return '';

  // Use the centralized error messages and markers from constants
  const { ERROR_MESSAGES, MARKERS } = require('./constants');

  // Special case for combined terms
  if (content.includes('connection') && content.includes('unstable')) {
    logger.info(`[Webhook] Detected error message (unstable connection), adding special prefix`);
    return MARKERS.ERROR_PREFIX + ' ' + content;
  }

  // Check for standard error patterns
  for (const pattern of ERROR_MESSAGES) {
    // Skip the marker patterns themselves to avoid duplication
    if (pattern === MARKERS.ERROR_PREFIX || pattern === MARKERS.HARD_BLOCKED_RESPONSE) {
      continue;
    }

    if (content.includes(pattern)) {
      logger.info(
        `[Webhook] Detected error message with pattern "${pattern}", adding special prefix`
      );
      return MARKERS.ERROR_PREFIX + ' ' + content;
    }
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
  // Enhanced logging for thread troubleshooting
  if (isThread) {
    logger.info(`[WebhookManager] Preparing message data for thread with ID: ${threadId}`);
    if (!threadId) {
      logger.warn('[WebhookManager] Thread flagged as true but no threadId provided!');
    }
  }

  // Thread-specific handling
  const threadData = isThread ? {
    threadId,
    // Store information about the original channel for recovery attempts
    _isThread: true,
    _originalChannel: options._originalChannel // Will be set by calling functions
  } : {};

  const messageData = {
    content: content,
    username: username,
    avatarURL: avatarUrl || null,
    allowedMentions: { parse: ['users', 'roles'] },
    ...threadData
  };
  
  // Double-check threadId was properly set if isThread is true
  if (isThread && !messageData.threadId) {
    logger.error('[WebhookManager] CRITICAL: threadId not set properly in messageData despite isThread=true');
  } else if (isThread) {
    logger.info(`[WebhookManager] Successfully set threadId ${messageData.threadId} in messageData`);
  }

  // Add optional embed if provided
  if (options.embed) {
    messageData.embeds = [new EmbedBuilder(options.embed)];
  }

  // Add optional files if provided
  if (options.files) {
    messageData.files = options.files;
  }

  // Add audio attachments if provided
  if (options.attachments && options.attachments.length > 0) {
    // Initialize files array if it doesn't exist
    messageData.files = messageData.files || [];
    // Add attachments to files
    messageData.files.push(...options.attachments);
    logger.debug(`[Webhook] Added ${options.attachments.length} audio attachments to message`);
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
  // Create a detailed context object for error tracking
  const messageContext = {
    username: messageData.username,
    contentLength: messageData.content?.length,
    contentPreview: messageData.content?.substring(0, 50),
    hasEmbeds: !!messageData.embeds?.length,
    embedCount: messageData.embeds?.length || 0,
    threadId: messageData.threadId,
    chunkIndex: chunkIndex + 1,
    totalChunks,
    timestamp: Date.now(),
  };

  logger.debug(
    `Sending webhook message chunk ${chunkIndex + 1}/${totalChunks} with data: ${JSON.stringify({
      username: messageData.username,
      contentLength: messageData.content?.length,
      hasEmbeds: !!messageData.embeds?.length,
      threadId: messageData.threadId,
      isInThread: !!messageData.threadId
    })}`
  );
  
  // IMPORTANT: Log critical info about thread handling
  if (messageData.threadId) {
    logger.info(`[Webhook] Sending message to thread ID: ${messageData.threadId}`);
  }

  try {
    // Enhanced debugging specifically for threads
    if (messageData.threadId) {
      logger.info(`[WebhookManager] THREAD DEBUG: About to send webhook message to thread ${messageData.threadId}`);
      
      // Check for Discord.js version specific handling
      const webhookSendData = { ...messageData };
      
      // Explicitly log what we're sending to discord.js
      logger.debug(`[WebhookManager] Raw webhook data with threadId: ${JSON.stringify({
        threadId: webhookSendData.threadId,
        hasContent: !!webhookSendData.content,
        contentLength: webhookSendData.content?.length || 0,
        username: webhookSendData.username,
      })}`);
    }
    
    // Handle message sending with improved thread support
    let sentMessage;
    
    // Check if this is a forum thread (special handling)
    const isForum = messageData.forum || 
                    messageData.isForum || 
                    (messageData._originalChannel && 
                    (messageData._originalChannel.type === 'FORUM' ||
                    (messageData._originalChannel.parent && 
                     messageData._originalChannel.parent.type === 'FORUM')));
    
    if (isForum && messageData.threadId) {
      logger.info(`[WebhookManager] FORUM THREAD DETECTED - using special forum handling for ID: ${messageData.threadId}`);
      
      // For forum threads, we need to use thread_id parameter - forum posts are special
      try {
        // Create clean options without metadata
        const { threadId, _isThread, _originalChannel, forum, isForum, ...cleanOptions } = messageData;
        
        // Send with explicit thread_id
        sentMessage = await webhook.send({
          ...cleanOptions,
          thread_id: threadId // Use Discord.js required format
        });
        logger.info(`[WebhookManager] Successfully sent to forum thread with thread_id`);
        return sentMessage;
      } catch (forumError) {
        logger.error(`[WebhookManager] Error sending to forum thread: ${forumError.message}`);
        
        // Critical: for forum posts, we might need to try with a thread_name if thread_id fails
        if (forumError.message.includes('thread_name')) {
          try {
            const { threadId, _isThread, _originalChannel, forum, isForum, ...cleanOptions } = messageData;
            
            sentMessage = await webhook.send({
              ...cleanOptions,
              thread_id: threadId,
              thread_name: "Thread" // Try with a default thread name
            });
            logger.info(`[WebhookManager] Successfully sent to forum with thread_name fallback`);
            return sentMessage;
          } catch (finalError) {
            logger.error(`[WebhookManager] Forum thread fallback failed: ${finalError.message}`);
            throw finalError;
          }
        } else {
          throw forumError;
        }
      }
    }
    // Regular thread handling
    else if (messageData.threadId) {
      logger.info(`[WebhookManager] Sending to thread ${messageData.threadId} - using thread-specific webhook`);
      
      // For normal threads, use the most reliable approach first - thread_id parameter
      logger.info(`[WebhookManager] Using direct thread_id parameter approach for thread ${messageData.threadId}`);
      
      try {
        // Simplest approach - direct thread_id parameter (works in most Discord.js versions)
        const { threadId, _isThread, _originalChannel, ...cleanOptions } = messageData;
        
        sentMessage = await webhook.send({
          ...cleanOptions,
          thread_id: threadId  // Discord.js format
        });
        logger.info(`[WebhookManager] Successfully sent message using thread_id parameter`);
      } catch (directError) {
        logger.error(`[WebhookManager] Direct thread_id approach failed: ${directError.message}`);
        logger.info(`[WebhookManager] Attempting fallback methods...`);
        
        // Try alternative approaches
        try {
          // Check if webhook has thread() method
          if (typeof webhook.thread === 'function') {
            logger.info(`[WebhookManager] Trying webhook.thread() method`);
            
            // Create thread-specific webhook
            const threadWebhook = webhook.thread(messageData.threadId);
            
            // Create clean options without threadId
            const { threadId: _unused, ...threadCleanOptions } = messageData;
            
            // Send using thread-specific webhook
            sentMessage = await threadWebhook.send(threadCleanOptions);
            logger.info(`[WebhookManager] Successfully sent with webhook.thread() method`);
          } else {
            // If thread() method doesn't exist, try other approaches
            logger.warn(`[WebhookManager] webhook.thread method not available, trying another approach`);
            
            // Try sending directly to parent channel with thread_id
            const { threadId: _threadId2, ...cleanOptions2 } = messageData;
            
            // Send with direct thread_id
            sentMessage = await webhook.send({
              ...cleanOptions2,
              thread_id: messageData.threadId
            });
            logger.info(`[WebhookManager] Successfully sent with direct thread_id parameter (secondary approach)`);
          }
        } catch (finalError) {
          logger.error(`[WebhookManager] All thread approaches failed: ${finalError.message}`);
          
          // One last desperate attempt: try multiple fallback approaches
          logger.info(`[WebhookManager] Attempting fallback approaches for thread message delivery`);
          
          try {
            // APPROACH 1: Try fresh webhook from parent
            // Get the thread channel's parent
            const threadChannel = messageData._originalChannel; // Added in patched version
            
            if (threadChannel && threadChannel.parent) {
              // Get a webhook for the parent
              logger.info(`[WebhookManager] FALLBACK 1: Getting fresh webhook for parent channel ${threadChannel.parent.id}`);
              const parentWebhooks = await threadChannel.parent.fetchWebhooks();
              const parentWebhook = parentWebhooks.find(wh => wh.name === 'Tzurot');
              
              if (parentWebhook) {
                // Create a new client
                const freshClient = new WebhookClient({ url: parentWebhook.url });
                
                try {
                  // Try the thread method
                  const freshThreadClient = freshClient.thread(messageData.threadId);
                  
                  // Create clean options without threadId
                  const { threadId: _unusedFinal, ...finalCleanOptions } = messageData;
                  
                  // Try to send
                  sentMessage = await freshThreadClient.send(finalCleanOptions);
                  logger.info(`[WebhookManager] FALLBACK 1 worked! Message sent to thread via fresh webhook.`);
                  return sentMessage;
                } catch (freshWebhookError) {
                  logger.error(`[WebhookManager] FALLBACK 1 failed: ${freshWebhookError.message}`);
                }
              }
            }
            
            // APPROACH 2: Direct channel.send as last resort
            // This completely bypasses the webhook system for this message
            if (threadChannel && typeof threadChannel.send === 'function') {
              logger.info(`[WebhookManager] FALLBACK 2: Attempting direct channel.send to thread ${messageData.threadId}`);
              
              try {
                // Format the message for direct sending
                const formattedContent = `**${messageData.username}:** ${messageData.content}`;
                
                // Send using the direct Discord.js channel API
                const directSentMessage = await threadChannel.send({
                  content: formattedContent,
                  files: messageData.files || [],
                  embeds: messageData.embeds || []
                });
                
                logger.info(`[WebhookManager] FALLBACK 2 worked! Message sent via direct channel.send, ID: ${directSentMessage.id}`);
                
                // Return a webhook-like response
                sentMessage = {
                  id: directSentMessage.id,
                  content: directSentMessage.content,
                  embeds: directSentMessage.embeds,
                  _directSend: true
                };
                
                return sentMessage;
              } catch (directSendError) {
                logger.error(`[WebhookManager] FALLBACK 2 failed: ${directSendError.message}`);
              }
            }
            
            // If both approaches fail, throw the original error
            logger.error(`[WebhookManager] All thread fallback approaches failed`);
            throw finalError;
          } catch (lastError) {
            logger.error(`[WebhookManager] Last resort failed: ${lastError.message}`);
            throw finalError; // Re-throw the original error
          }
        }
      }
    } else {
      // Regular channel, use normal send
      logger.info(`[WebhookManager] Sending to regular channel`);
      sentMessage = await webhook.send(messageData);
    }
    
    logger.info(
      `Successfully sent webhook message chunk ${chunkIndex + 1}/${totalChunks} with ID: ${sentMessage.id}`
    );
    
    // Add additional logging for thread-specific responses
    if (messageData.threadId) {
      logger.info(`[WebhookManager] Successfully sent message to thread ${messageData.threadId}, message ID: ${sentMessage.id}`);
    }
    
    return sentMessage;
  } catch (error) {
    // Track this error with our enhanced error tracking
    errorTracker.trackError(error, {
      category: errorTracker.ErrorCategory.WEBHOOK,
      operation: 'sendMessageChunk',
      metadata: {
        ...messageContext,
        errorCode: error.code,
        errorName: error.name,
        isThread: !!messageData.threadId,
        threadId: messageData.threadId,
        threadSpecificError: messageData.threadId ? true : false
      },
      isCritical: true,
    });
    
    // Enhanced error logging specifically for thread issues
    if (messageData.threadId) {
      logger.error(`[WebhookManager] THREAD ERROR: Failed to send message to thread ${messageData.threadId}`);
      logger.error(`[WebhookManager] THREAD ERROR details: ${error.code} - ${error.message}`);
    }

    // If this is because of length, try to send a simpler message indicating the error
    if (error.code === 50035) {
      // Invalid Form Body - usually means the message content was too long
      try {
        // Create a safe fallback message with detailed error information
        await webhook.send({
          content: `*[Error: Message chunk was too long to send (${messageData.content?.length} chars). Some content may be missing.]*`,
          username: messageData.username,
          avatarURL: messageData.avatarURL,
          threadId: messageData.threadId,
        });
      } catch (finalError) {
        // Track this secondary error separately
        errorTracker.trackError(finalError, {
          category: errorTracker.ErrorCategory.WEBHOOK,
          operation: 'sendFallbackMessage',
          metadata: {
            originalError: {
              message: error.message,
              code: error.code,
            },
            ...messageContext,
          },
          isCritical: false,
        });
      }
    } else if (error.code === 10015) {
      // Unknown Webhook - usually means the webhook was deleted
      logger.error(
        `[Webhook] Webhook no longer exists. Will need to be recreated on next attempt.`
      );

      // Clear the webhook from cache so it will be recreated next time
      const channelId = messageData.threadId || findChannelIdForWebhook(webhook);
      if (channelId) {
        webhookCache.delete(channelId);
      }
    } else {
      // For other errors, collect detailed diagnostic information
      const diagnosticInfo = {
        code: error.code,
        message: error.message,
        name: error.name,
        stack: error.stack?.split('\n').slice(0, 3).join('\n') || 'No stack trace',
        messageData: {
          username: messageData.username,
          contentLength: messageData.content?.length,
          contentFirstChars: messageData.content?.substring(0, 100),
          contentLastChars: messageData.content?.substring(messageData.content.length - 100),
          hasEmbeds: !!messageData.embeds?.length,
          threadId: messageData.threadId,
        },
      };

      logger.error('[Webhook] Webhook error details:', diagnosticInfo);
    }

    throw error;
  }
}

/**
 * Find the channel ID for a webhook client
 * A utility function to help identify which channel a webhook belongs to
 * @param {WebhookClient} webhook - The webhook client
 * @returns {string|null} The channel ID or null if not found
 */
function findChannelIdForWebhook(webhook) {
  for (const [channelId, cachedWebhook] of webhookCache.entries()) {
    if (cachedWebhook === webhook) {
      return channelId;
    }
  }
  return null;
}

/**
 * Send a formatted message in a DM channel as a fallback for webhooks
 * @param {Object} channel - Discord.js DM channel object
 * @param {string|Array} content - Message content to send, can be text or multimodal array
 * @param {Object} personality - Personality data (name, avatar, etc.)
 * @param {Object} options - Additional options like embeds
 * @returns {Promise<Object>} The sent message info
 */
async function sendFormattedMessageInDM(channel, content, personality, options = {}) {
  try {
    // For DMs, use just the personality name without the suffix
    // This creates a cleaner experience in DMs
    let displayName;
    if (personality.displayName) {
      displayName = personality.displayName;
    } else if (personality.fullName) {
      // Extract name from fullName if needed
      const parts = personality.fullName.split('-');
      if (parts.length > 0 && parts[0].length > 0) {
        // Capitalize first letter for nicer display
        displayName = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
      } else {
        displayName = personality.fullName;
      }
    } else {
      displayName = 'Bot';
    }
    
    // Process any media URLs in the content using the shared mediaHandler
    let processedContent = content;
    let mediaAttachments = [];
    let isMultimodalContent = false;
    let multimodalTextContent = '';
    let multimodalImageUrl = null;
    let multimodalAudioUrl = null;
    
    // Check for referenced media markers in the text content
    // Updated to use a more robust marker extraction method
    let hasReferencedMedia = false;
    let referencedMediaType = null;
    let referencedMediaUrl = null;
    
    if (typeof content === 'string' && content.includes('[REFERENCE_MEDIA:')) {
      const startMarker = content.indexOf('[REFERENCE_MEDIA:');
      if (startMarker !== -1) {
        const endMarker = content.indexOf(']', startMarker);
        if (endMarker !== -1) {
          // Extract the whole marker
          const fullMarker = content.substring(startMarker, endMarker + 1);
          
          // Parse the marker
          const markerParts = fullMarker.substring(17, fullMarker.length - 1).split(':');
          if (markerParts.length >= 2) {
            hasReferencedMedia = true;
            referencedMediaType = markerParts[0]; // 'image' or 'audio'
            referencedMediaUrl = markerParts.slice(1).join(':'); // Rejoin to handle URLs with colons
            
            logger.info(`[WebhookManager] Found referenced media marker in DM: ${referencedMediaType} at ${referencedMediaUrl}`);
            
            // Remove the marker from the content
            processedContent = content.replace(fullMarker, '').trim();
            logger.info(`[WebhookManager] After removing marker, DM content is now: "${processedContent.substring(0, 100)}..."`);
            
            // Set multimodal flags for consistent handling
            isMultimodalContent = true;
            if (referencedMediaType === 'image') {
              multimodalImageUrl = referencedMediaUrl;
              logger.info(`[WebhookManager] Set DM multimodalImageUrl=${referencedMediaUrl}`);
            } else if (referencedMediaType === 'audio') {
              multimodalAudioUrl = referencedMediaUrl;
              logger.info(`[WebhookManager] Set DM multimodalAudioUrl=${referencedMediaUrl}`);
            }
          }
        }
      }
    }
    // Check if content is a multimodal array
    else if (Array.isArray(content) && content.length > 0) {
      isMultimodalContent = true;
      logger.info(`[WebhookManager] Detected multimodal content array with ${content.length} items in DM`);
      
      // Extract text content and media URLs from multimodal array
      content.forEach(item => {
        if (item.type === 'text') {
          multimodalTextContent += item.text + '\n';
        } else if (item.type === 'image_url' && item.image_url?.url) {
          multimodalImageUrl = item.image_url.url;
          logger.info(`[WebhookManager] Found image URL in multimodal DM content: ${multimodalImageUrl}`);
        } else if (item.type === 'audio_url' && item.audio_url?.url) {
          multimodalAudioUrl = item.audio_url.url;
          logger.info(`[WebhookManager] Found audio URL in multimodal DM content: ${multimodalAudioUrl}`);
        }
      });
      
      // Use the text content for the main message
      processedContent = multimodalTextContent.trim() || 'Here\'s the media you requested:';
      logger.info(`[WebhookManager] Extracted text content from multimodal DM array: ${processedContent.substring(0, 50)}...`);
    } else {
      try {
        // Process media URLs (images, audio, etc.)
        if (typeof content === 'string') {
          logger.debug(`[WebhookManager] Processing media in DM message content`);
          const mediaResult = await processMediaForWebhook(content);
          processedContent = mediaResult.content;
          mediaAttachments = mediaResult.attachments;
          
          if (mediaAttachments.length > 0) {
            logger.info(`[WebhookManager] Processed ${mediaAttachments.length} media URLs for DM message`);
          }
        }
      } catch (error) {
        logger.error(`[WebhookManager] Error processing media in DM message: ${error.message}`);
        // Continue with original content if media processing fails
        processedContent = content;
        mediaAttachments = [];
      }
    }
    
    // Prepare the formatted content with name prefix
    const formattedContent = `**${displayName}:** ${processedContent}`;
    
    // Split message if needed (Discord's character limit)
    const contentChunks = splitMessage(formattedContent);
    logger.info(`[WebhookManager] Split DM message into ${contentChunks.length} chunks`);
    
    const sentMessageIds = [];
    let firstSentMessage = null;
    
    // We use a time-based approach for duplicate detection now
    
    // Send each chunk as a separate message
    for (let i = 0; i < contentChunks.length; i++) {
      const isFirstChunk = i === 0;
      const isLastChunk = i === contentChunks.length - 1;
      const chunkContent = contentChunks[i];
      
      // Prepare options for the message
      const sendOptions = {};
      
      // Only include embeds and attachments in the last chunk for non-multimodal content
      if (isLastChunk && !isMultimodalContent) {
        if (options.embeds) {
          sendOptions.embeds = options.embeds;
        }
        
        // Add media attachments to the last chunk
        if (mediaAttachments.length > 0) {
          const attachmentOptions = prepareAttachmentOptions(mediaAttachments);
          Object.assign(sendOptions, attachmentOptions);
        }
      }
      
      // Send the message to the DM channel
      const sentMessage = await channel.send({
        content: chunkContent,
        ...sendOptions
      });
      
      // Track sent messages
      sentMessageIds.push(sentMessage.id);
      
      // Keep first message for return value
      if (isFirstChunk) {
        firstSentMessage = sentMessage;
      }
    }
    
    // For multimodal content, send media as separate messages in DMs
    if (isMultimodalContent) {
      logger.info(`[WebhookManager] Sending multimodal media as separate messages in DM`);
      const mediaDelay = 500; // Small delay between text and media messages for better UX
      
      // Send audio if present (always prioritize audio over image)
      if (multimodalAudioUrl) {
        try {
          // Add a small delay
          await new Promise(resolve => setTimeout(resolve, mediaDelay));
          
          // Send the audio message with the personality name prefix
          const audioContent = `**${displayName}:** [Audio: ${multimodalAudioUrl}]`;
          logger.info(`[WebhookManager] Sending audio as separate DM message: ${multimodalAudioUrl}`);
          
          const audioMessage = await channel.send({
            content: audioContent
          });
          
          sentMessageIds.push(audioMessage.id);
          logger.info(`[WebhookManager] Successfully sent audio DM with ID: ${audioMessage.id}`);
        } catch (error) {
          logger.error(`[WebhookManager] Error sending audio message in DM: ${error.message}`);
          // Continue even if the audio message fails
        }
      }
      
      // Send image if present and no audio (to avoid overwhelming with media)
      if (multimodalImageUrl && !multimodalAudioUrl) {
        try {
          // Add a small delay
          await new Promise(resolve => setTimeout(resolve, mediaDelay));
          
          // Send the image message with the personality name prefix
          const imageContent = `**${displayName}:** [Image: ${multimodalImageUrl}]`;
          logger.info(`[WebhookManager] Sending image as separate DM message: ${multimodalImageUrl}`);
          
          const imageMessage = await channel.send({
            content: imageContent
          });
          
          sentMessageIds.push(imageMessage.id);
          logger.info(`[WebhookManager] Successfully sent image DM with ID: ${imageMessage.id}`);
        } catch (error) {
          logger.error(`[WebhookManager] Error sending image message in DM: ${error.message}`);
          // Continue even if the image message fails
        }
      }
    }
    
    // Return structured response similar to webhook responses
    return {
      message: firstSentMessage,
      messageIds: sentMessageIds,
      isDM: true,
      personalityName: personality.fullName
    };
  } catch (error) {
    logger.error(`[WebhookManager] Error sending formatted DM message: ${error.message}`);
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
  // Add more detail to this log to help with debugging
  logger.info(`[Webhook] All messages were duplicates, creating virtual result for personality: ${personality?.fullName || 'unknown'} in channel: ${channelId}`);
  logger.info(`[Webhook] This happens when duplicate detection blocks all messages. If this is unexpected, check the duplicate detection logic.`);
  
  const virtualId = `virtual-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;

  // Clear pending message if we're returning a virtual result
  if (personality && personality.fullName) {
    // Call clearPendingMessage via module exports to ensure mock is used in tests
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
 * @param {string|Array} content - Message content to send, can be text or multimodal array (will be split if too long)
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
 * - Fallback for DM channels where webhooks aren't available (using formatted text)
 *
 * All messages from AI personalities should be sent through this function
 * to ensure consistent formatting and reliability.
 */
async function sendWebhookMessage(channel, content, personality, options = {}, message = null) {
  // Minimize console output during webhook operations
  const originalFunctions = minimizeConsoleOutput();
  
  // Extract user ID from message for authentication if available
  // This is CRITICAL for ensuring we use the correct user's auth token
  // when they reply to a webhook message
  const userId = message?.author?.id;
  logger.debug(`[WebhookManager] Using user ID for authentication: ${userId || 'none'} from ${message?.author?.tag || 'unknown user'}`);
  
  // Check if this is a DM channel (webhooks aren't available)
  if (channel.isDMBased()) {
    logger.info(`[WebhookManager] Channel ${channel.id} is a DM channel. Using formatted message instead of webhook.`);
    return await sendFormattedMessageInDM(channel, content, personality, options);
  }
  
  // Log detailed thread information for debugging
  if (channel.isThread()) {
    logger.info(`[WebhookManager] SENDING TO THREAD: ${channel.id}`);
    logger.info(`[WebhookManager] Thread name: ${channel.name || 'unknown'}`);
    logger.info(`[WebhookManager] Thread type: ${channel.type}`);
    
    if (channel.parent) {
      logger.info(`[WebhookManager] Thread parent channel: ${channel.parent.name || 'unknown'} (ID: ${channel.parent.id})`); 
      logger.info(`[WebhookManager] Parent channel type: ${channel.parent.type}`);
    } else {
      logger.warn(`[WebhookManager] Thread parent channel not available! This may cause issues.`);
    }
    
    // Log options to see if threadId is properly set
    logger.info(`[WebhookManager] Thread options: ${JSON.stringify({
      hasThreadId: !!options.threadId,
      threadId: options.threadId,
      isChannelThread: channel.isThread(),
      channelType: channel.type,
      isForum: options.isForum || false,
      isForumChannel: channel.type === 'FORUM' || (channel.parent && channel.parent.type === 'FORUM'),
      customThreadType: options.channelType
    })}`);
    
    // Explicitly set the threadId in options if not already set
    if (!options.threadId) {
      logger.warn(`[WebhookManager] Thread ID not set in options, setting it to ${channel.id}`);
      options.threadId = channel.id;
    }
    
    // Handle forum channels specially due to Discord API requirements
    const isForum = channel.type === 'FORUM' || 
                    (channel.parent && channel.parent.type === 'FORUM') || 
                    options.isForum || 
                    options.channelType === 'FORUM';
                    
    if (isForum) {
      logger.info(`[WebhookManager] FORUM CHANNEL DETECTED - using special forum handling for ID: ${channel.id}`);
      options.forum = true;
      options.thread_id = channel.id; // Discord.js required format
    }
  }

  try {
    // Ensure personality is an object with at least fullName
    if (!personality) {
      logger.error(`[Webhook] Missing personality object in sendWebhookMessage`);
      personality = { fullName: 'unknown' };
    } else if (!personality.fullName) {
      logger.error(`[Webhook] Missing fullName in personality object`);
      personality.fullName = 'unknown';
    }

    // If displayName is missing but fullName is present, ensure we set a display name
    if (!personality.displayName && personality.fullName) {
      logger.warn(
        `[Webhook] No displayName provided for ${personality.fullName}, attempting to fetch or generate one`
      );

      // Try to fetch display name if needed (only for real personalities)
      if (personality.fullName !== 'unknown') {
        try {
          // Import here to avoid circular dependencies
          const { getProfileDisplayName } = require('./profileInfoFetcher');
          
          // Pass user ID to ensure authentication works
          const displayName = await getProfileDisplayName(personality.fullName, userId);

          if (displayName) {
            logger.info(
              `[Webhook] Successfully fetched displayName: ${displayName} for ${personality.fullName}`
            );
            personality.displayName = displayName;
          } else {
            // Extract from fullName as fallback
            const parts = personality.fullName.split('-');
            if (parts.length > 0) {
              const extracted = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
              logger.info(
                `[Webhook] Using extracted displayName: ${extracted} for ${personality.fullName}`
              );
              personality.displayName = extracted;
            } else {
              personality.displayName = personality.fullName;
            }
          }
        } catch (error) {
          logger.error(`[Webhook] Error fetching displayName: ${error.message}`);
          // Set displayName to match fullName as fallback
          personality.displayName = personality.fullName;
        }
      }
    }

    logger.info(
      `Attempting to send webhook message in channel ${channel.id} as ${personality.displayName || personality.fullName}`
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
    
    // Check if this is a thread
    const isThread = channel.isThread();
    
    // Log thread-specific info
    if (isThread) {
      logger.info(`[Webhook] Processing potential message for thread ${channel.id}`);
      if (isErrorMessage) {
        logger.info(`[Webhook] Thread message contains error pattern but will NOT be blocked`);
      }
    }

    // CRITICAL: If this is an error message AND the personality has a pending message
    // in this channel, completely drop this error message UNLESS it's a thread
    if (
      isErrorMessage &&
      !isThread && // Don't block thread messages!
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
      // Pre-load and validate the avatar URL to ensure Discord caches it
      // This returns either the validated avatar URL or null
      const validatedAvatarUrl = personality.avatarUrl
        ? await warmupAvatarUrl(personality.avatarUrl)
        : null;

      // Update the personality object with the validated URL
      if (validatedAvatarUrl !== personality.avatarUrl) {
        logger.info(`[Webhook] Updated personality avatar URL to validated version`);
        personality.avatarUrl = validatedAvatarUrl;
      }

      // Get the webhook client
      const webhook = await getOrCreateWebhook(channel);

      // Standardize the username to prevent duplicates
      const standardizedName = getStandardizedUsername(personality);
      logger.info(
        `[Webhook] Using standardized username: ${standardizedName} for personality ${personality.fullName}`
      );

      // Process any media URLs in the content using the shared media handler
      let processedContent = content;
      let attachments = [];
      let isMultimodalContent = false;
      let multimodalTextContent = '';
      let multimodalImageUrl = null;
      let multimodalAudioUrl = null;
      
      // Check for referenced media markers in the text content
      // Updated regex to handle URLs with special characters
      const referenceMediaRegex = /\[REFERENCE_MEDIA:(image|audio):([^\]]+)\]/;
      let hasReferencedMedia = false;
      let referencedMediaType = null;
      let referencedMediaUrl = null;
      
      if (typeof content === 'string' && content.includes('[REFERENCE_MEDIA:')) {
        const startMarker = content.indexOf('[REFERENCE_MEDIA:');
        if (startMarker !== -1) {
          const endMarker = content.indexOf(']', startMarker);
          if (endMarker !== -1) {
            // Extract the whole marker
            const fullMarker = content.substring(startMarker, endMarker + 1);
            
            // Parse the marker
            const markerParts = fullMarker.substring(17, fullMarker.length - 1).split(':');
            if (markerParts.length >= 2) {
              hasReferencedMedia = true;
              referencedMediaType = markerParts[0]; // 'image' or 'audio'
              referencedMediaUrl = markerParts.slice(1).join(':'); // Rejoin to handle URLs with colons
              
              logger.info(`[Webhook] Found referenced media marker: ${referencedMediaType} at ${referencedMediaUrl}`);
              
              // Remove the marker from the content
              processedContent = content.replace(fullMarker, '').trim();
              logger.info(`[Webhook] After removing marker, content is now: "${processedContent.substring(0, 100)}..."`);
              
              // Set multimodal flags for consistent handling
              isMultimodalContent = true;
              if (referencedMediaType === 'image') {
                multimodalImageUrl = referencedMediaUrl;
                logger.info(`[Webhook] Set multimodalImageUrl=${referencedMediaUrl}`);
              } else if (referencedMediaType === 'audio') {
                multimodalAudioUrl = referencedMediaUrl;
                logger.info(`[Webhook] Set multimodalAudioUrl=${referencedMediaUrl}`);
              }
            }
          }
        }
      }
      // Check if content is a multimodal array
      else if (Array.isArray(content) && content.length > 0) {
        isMultimodalContent = true;
        logger.info(`[Webhook] Detected multimodal content array with ${content.length} items`);
        
        // Extract text content and media URLs from multimodal array
        content.forEach(item => {
          if (item.type === 'text') {
            multimodalTextContent += item.text + '\n';
          } else if (item.type === 'image_url' && item.image_url?.url) {
            multimodalImageUrl = item.image_url.url;
            logger.info(`[Webhook] Found image URL in multimodal content: ${multimodalImageUrl}`);
          } else if (item.type === 'audio_url' && item.audio_url?.url) {
            multimodalAudioUrl = item.audio_url.url;
            logger.info(`[Webhook] Found audio URL in multimodal content: ${multimodalAudioUrl}`);
          }
        });

        // Use the text content for the main message
        processedContent = multimodalTextContent.trim() || 'Here\'s the media you requested:';
        logger.info(`[Webhook] Extracted text content from multimodal array: ${processedContent.substring(0, 50)}...`);
      } else {
        // Handle regular string content
        try {
          // Only process if content is a string
          if (typeof content === 'string') {
            // Use the centralized media handler to process all types of media
            logger.debug(`[Webhook] Processing media in message content`);
            const { content: mediaProcessedContent, attachments: mediaAttachments } =
              await processMediaForWebhook(content);
            
            if (mediaAttachments.length > 0) {
              processedContent = mediaProcessedContent;
              attachments = mediaAttachments;
              logger.info(`[Webhook] Processed ${attachments.length} media URLs into attachments`);
            }
          }
        } catch (error) {
          logger.error(`[Webhook] Error processing media URLs: ${error.message}`);
          // Continue with original content if there's an error
          processedContent = content;
          attachments = [];
        }
      }

      // Split message into chunks if needed
      let contentChunks = [''];
      try {
        const safeContent =
          typeof processedContent === 'string' ? processedContent : String(processedContent || '');
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
        const chunkContent = contentChunks[i];

        // Check for duplicate messages with time-based approach
        if (isDuplicateMessage(chunkContent, standardizedName, channel.id)) {
          logger.info(`[Webhook] Skipping message chunk ${i + 1} due to duplicate detection`);
          continue;
        }

        // Update last message time for proper ordering
        updateChannelLastMessageTime(channel.id);

        // Mark error content appropriately
        let finalContent = markErrorContent(chunkContent || '');

        // Skip hard-blocked content - but only if not in a thread
        if (finalContent.includes('HARD_BLOCKED_RESPONSE_DO_NOT_DISPLAY') && !channel.isThread()) {
          logger.info(
            `[Webhook] Detected HARD_BLOCKED_RESPONSE_DO_NOT_DISPLAY marker, skipping this message entirely`
          );
          continue;
        } else if (finalContent.includes('HARD_BLOCKED_RESPONSE_DO_NOT_DISPLAY') && channel.isThread()) {
          // For threads, log but don't skip
          logger.info(
            `[Webhook] Detected HARD_BLOCKED_RESPONSE in thread message but allowing it to continue`
          );
          // Remove the marker to avoid downstream filtering
          finalContent = finalContent.replace('HARD_BLOCKED_RESPONSE_DO_NOT_DISPLAY', '');
        }

        // For regular content (not multimodal), include attachments in the last chunk
        // For multimodal content, do not attach media to text messages (will be sent separately)
        const isLastChunk = i === contentChunks.length - 1;
        const chunkOptions = (isLastChunk && !isMultimodalContent) ? { ...options, attachments: attachments } : {};

        // Prepare options with channel reference for thread recovery
        const sendOptions = {
          ...isLastChunk && !isMultimodalContent ? chunkOptions : {},
          // Store the original channel for recovery attempts
          _originalChannel: channel
        };
        
        // Prepare the message data with enhanced thread support
        const messageData = prepareMessageData(
          finalContent,
          standardizedName,
          personality.avatarUrl,
          channel.isThread(),
          channel.id,
          sendOptions
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
          // Handle thread-specific errors with special recovery
          if (channel.isThread() && error.message.includes('thread')) {
            logger.error(`[Webhook] Thread-specific error detected: ${error.message}`);
            
            // Clear all webhook cache entries related to this thread
            logger.info(`[Webhook] Clearing thread webhook cache for thread ${channel.id}`);
            clearWebhookCache(channel.id);
            webhookCache.delete(`thread-${channel.id}`);
            
            // Try to recreate the webhook immediately for the next chunk
            try {
              logger.info(`[Webhook] Attempting immediate webhook recreation for thread`);
              await getOrCreateWebhook(channel);
              logger.info(`[Webhook] Successfully recreated webhook for thread`);
            } catch (recreateError) {
              logger.error(`[Webhook] Failed to recreate webhook: ${recreateError.message}`);
            }
          }
          
          // If this is the first chunk and it failed, propagate the error
          if (isFirstChunk) {
            throw error;
          }
          // Otherwise, continue with the remaining chunks
        }
      }

      // For multimodal content, send media as separate messages
      if (isMultimodalContent) {
        logger.info(`[Webhook] Sending multimodal media as separate messages`);
        const mediaDelay = 500; // Small delay between text and media messages for better UX

        // Send audio if present (always send audio first due to API limitations)
        if (multimodalAudioUrl) {
          try {
            // Add a small delay
            await new Promise(resolve => setTimeout(resolve, mediaDelay));
            
            // Use the audio URL
            const audioUrl = multimodalAudioUrl;
            
            // Create message data for audio
            const audioMessageData = prepareMessageData(
              `[Audio: ${audioUrl}]`, // Use special format that our media handler detects
              standardizedName,
              personality.avatarUrl,
              channel.isThread(),
              channel.id,
              { _originalChannel: channel }
            );
            
            // Send the audio message
            logger.info(`[Webhook] Sending audio as separate message: ${audioUrl}`);
            const audioMessage = await sendMessageChunk(webhook, audioMessageData, 0, 1);
            sentMessageIds.push(audioMessage.id);
            logger.info(`[Webhook] Successfully sent audio message with ID: ${audioMessage.id}`);
          } catch (error) {
            logger.error(`[Webhook] Error sending audio message: ${error.message}`);
            // Continue even if audio message fails
          }
        }
        
        // Send image if present and no audio (to ensure we don't overwhelm the user with media)
        if (multimodalImageUrl && !multimodalAudioUrl) {
          try {
            // Add a small delay
            await new Promise(resolve => setTimeout(resolve, mediaDelay));
            
            // Use the image URL
            const imageUrl = multimodalImageUrl;
            
            // Create message data for image
            const imageMessageData = prepareMessageData(
              `[Image: ${imageUrl}]`, // Use special format that our media handler detects
              standardizedName, 
              personality.avatarUrl,
              channel.isThread(),
              channel.id,
              { _originalChannel: channel }
            );
            
            // Send the image message
            logger.info(`[Webhook] Sending image as separate message: ${imageUrl}`);
            const imageMessage = await sendMessageChunk(webhook, imageMessageData, 0, 1);
            sentMessageIds.push(imageMessage.id);
            logger.info(`[Webhook] Successfully sent image message with ID: ${imageMessage.id}`);
          } catch (error) {
            logger.error(`[Webhook] Error sending image message: ${error.message}`);
            // Continue even if image message fails
          }
        }
        
        // No longer needed as we now handle multimedia content directly
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

    // Clear pending message to prevent hanging states
    if (personality && personality.fullName) {
      clearPendingMessage(personality.fullName, channel.id);
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
  
  // CRITICAL: Allow ALL thread messages to pass through, regardless of content
  // This prevents the error filter from blocking @mentions in threads
  if (options.threadId || options.thread_id) {
    logger.info(`[Webhook] Allowing potential error message in thread ${options.threadId || options.thread_id}`);
    return false;
  }

  // Use the centralized error messages
  const { ERROR_MESSAGES } = require('./constants');

  // Add additional patterns specific to webhook operations
  const webhookSpecificPatterns = [
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

  // Combine all error patterns
  const allPatterns = [...ERROR_MESSAGES, ...webhookSpecificPatterns];

  // Special case for combined terms
  if (options.content.includes('connection') && options.content.includes('unstable')) {
    return true;
  }

  // Check if content matches any error pattern
  return allPatterns.some(pattern => options.content.includes(pattern));
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

    // CRITICAL: Always allow messages to threads, even if they contain error patterns
    const isThread = !!(normalizedOptions.threadId || normalizedOptions.thread_id);
    
    // Check if this is an error message (and not in a thread)
    if (!isThread && isErrorWebhookMessage(normalizedOptions)) {
      logger.info(`[Webhook CRITICAL] Intercepted error message at WebhookClient.send:`);
      logger.info(
        `[Webhook CRITICAL] Options: ${JSON.stringify({
          username: normalizedOptions.username,
          content: normalizedOptions.content?.substring(0, 50),
          isThread: isThread,
          threadId: normalizedOptions.threadId || normalizedOptions.thread_id
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
    
    // Special logging for thread messages
    if (isThread) {
      logger.info(`[Webhook] Thread message being sent normally (bypassing error filter) to thread: ${normalizedOptions.threadId || normalizedOptions.thread_id}`);
    }

    // If not an error message (or is a thread message), send normally
    return originalSend.apply(this, [options]);
  };
}

/**
 * Pre-load a personality's avatar
 * Helper function to ensure Discord caches the avatar before first use
 * @param {Object} personality - The personality object with avatarUrl
 * @param {string} [userId] - Optional Discord user ID for user-specific authentication
 */
async function preloadPersonalityAvatar(personality, userId = null) {
  if (!personality) {
    logger.error(`[WebhookManager] Cannot preload avatar: personality object is null or undefined`);
    return;
  }

  if (!personality.avatarUrl) {
    logger.warn(
      `[WebhookManager] Cannot preload avatar: avatarUrl is not set for ${personality.fullName || 'unknown personality'}`
    );
    
    // Attempt to fetch avatar URL using profile info fetcher with user auth
    if (personality.fullName) {
      try {
        // Import here to avoid circular dependencies
        const { getProfileAvatarUrl } = require('./profileInfoFetcher');
        
        // Pass the user ID for authentication
        const fetchedAvatarUrl = await getProfileAvatarUrl(personality.fullName, userId);
        
        if (fetchedAvatarUrl) {
          logger.info(
            `[WebhookManager] Successfully fetched avatar URL with user auth (${userId ? 'user-specific' : 'default'}): ${fetchedAvatarUrl}`
          );
          personality.avatarUrl = fetchedAvatarUrl;
        } else {
          // Set a fallback avatar URL rather than simply returning
          personality.avatarUrl = null;
          logger.info(
            `[WebhookManager] Set null avatar URL for ${personality.fullName || 'unknown personality'}`
          );
          return;
        }
      } catch (fetchError) {
        logger.error(`[WebhookManager] Error fetching avatar URL: ${fetchError.message}`);
        personality.avatarUrl = null;
        return;
      }
    } else {
      // Set a fallback avatar URL rather than simply returning
      personality.avatarUrl = null;
      logger.info(
        `[WebhookManager] Set null avatar URL for ${personality.fullName || 'unknown personality'}`
      );
      return;
    }
  }

  logger.info(
    `[WebhookManager] Preloading avatar for ${personality.displayName || personality.fullName}: ${personality.avatarUrl}`
  );

  try {
    // Use our improved validation and warmup methods
    const validatedUrl = await getValidAvatarUrl(personality.avatarUrl);

    // If the URL is invalid, update the personality object with the fallback
    if (validatedUrl !== personality.avatarUrl) {
      logger.warn(
        `[WebhookManager] Personality avatar URL invalid, using fallback: ${personality.avatarUrl}`
      );
      personality.avatarUrl = validatedUrl;
    }

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
    logger.warn(`[WebhookManager] getStandardizedUsername called with null/undefined personality`);
    return 'Bot';
  }

  try {
    // Log the full personality object to diagnose issues
    logger.debug(
      `[WebhookManager] getStandardizedUsername called with personality: ${JSON.stringify({
        fullName: personality.fullName || 'N/A',
        displayName: personality.displayName || 'N/A',
        hasAvatar: !!personality.avatarUrl,
      })}`
    );

    // Get bot name suffix if available
    let botSuffix = '';
    // Access the client through the global variable set in bot.js
    if (global.tzurotClient && global.tzurotClient.user && global.tzurotClient.user.tag) {
      const botTag = global.tzurotClient.user.tag;
      logger.debug(`[WebhookManager] Bot tag: ${botTag}`);
      // Split the tag on " | " and get the second part if it exists
      const tagParts = botTag.split(' | ');
      if (tagParts.length > 1) {
        // Remove Discord discriminator (e.g. "#9971") if present
        // Discriminators are exactly 4 digits and are primarily used by bots
        // Handle cases with or without a space before the discriminator
        let suffix = tagParts[1].replace(/\s*#\d{4}$/, '').trim();
        botSuffix = ` | ${suffix}`;
        // Ensure proper spacing in the suffix
        botSuffix = botSuffix.replace(/\|\s+/, '| ');
        logger.debug(`[WebhookManager] Using bot suffix: "${botSuffix}"`);
      }
    }

    // ALWAYS prioritize displayName over any other field
    if (
      personality.displayName &&
      typeof personality.displayName === 'string' &&
      personality.displayName.trim().length > 0
    ) {
      const name = personality.displayName.trim();
      logger.debug(`[WebhookManager] Using displayName: ${name}`);

      // Create the full name with the suffix
      const fullNameWithSuffix = `${name}${botSuffix}`;
      
      // Discord has a 32 character limit for webhook usernames
      if (fullNameWithSuffix.length > 32) {
        // If the name with suffix is too long, truncate the name part
        const maxNameLength = 29 - botSuffix.length;
        if (maxNameLength > 0) {
          return name.slice(0, maxNameLength) + '...' + botSuffix;
        } else {
          // If suffix is very long, just use the original name truncated
          return name.slice(0, 29) + '...';
        }
      }

      return fullNameWithSuffix;
    } else {
      // Log when displayName is missing to help diagnose the issue
      logger.warn(
        `[WebhookManager] displayName missing for personality: ${personality.fullName || 'unknown'}`
      );
    }

    // Fallback: Extract name from fullName
    if (personality.fullName && typeof personality.fullName === 'string') {
      // If fullName has hyphens, use first part as display name
      const parts = personality.fullName.split('-');
      if (parts.length > 0 && parts[0].length > 0) {
        // Capitalize first letter for nicer display
        const extracted = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
        logger.debug(`[WebhookManager] Using extracted name from fullName: ${extracted}`);

        // Create the full name with the suffix
        const extractedWithSuffix = `${extracted}${botSuffix}`;
        
        // Discord has a 32 character limit
        if (extractedWithSuffix.length > 32) {
          // If the name with suffix is too long, truncate the name part
          const maxExtractedLength = 29 - botSuffix.length;
          if (maxExtractedLength > 0) {
            return extracted.slice(0, maxExtractedLength) + '...' + botSuffix;
          } else {
            // If suffix is very long, just use the extracted name truncated
            return extracted.slice(0, 29) + '...';
          }
        }

        return extractedWithSuffix;
      }

      // If no hyphens, use the full name if short enough after adding suffix
      const fullNameWithSuffix = `${personality.fullName}${botSuffix}`;
      if (fullNameWithSuffix.length <= 32) {
        logger.debug(`[WebhookManager] Using fullName with suffix: ${fullNameWithSuffix}`);
        return fullNameWithSuffix;
      }

      // Truncate long names while preserving the suffix
      const maxFullNameLength = 29 - botSuffix.length;
      if (maxFullNameLength > 0) {
        const truncated = personality.fullName.slice(0, maxFullNameLength) + '...' + botSuffix;
        logger.debug(`[WebhookManager] Using truncated fullName with suffix: ${truncated}`);
        return truncated;
      } else {
        // If suffix is very long, just use the original name truncated
        const simpleTruncated = personality.fullName.slice(0, 29) + '...';
        logger.debug(`[WebhookManager] Using simple truncated fullName: ${simpleTruncated}`);
        return simpleTruncated;
      }
    }
  } catch (error) {
    logger.error(`[WebhookManager] Error generating standard username: ${error}`);
  }

  // Final fallback
  logger.warn(`[WebhookManager] Using 'Bot' as final fallback for username`);
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
  
  // No special case for media messages - we'll use a time-based approach instead

  // Create a hash key for this message
  const hash = hashMessage(content, username, channelId);

  // Check if the hash exists in our cache
  if (recentMessageCache.has(hash)) {
    const timestamp = recentMessageCache.get(hash);
    // Use a much shorter timeout (5 seconds) for duplicate detection
    // This allows the same message to be sent again after a short delay
    const shortDuplicateTimeout = 5000; // 5 seconds
    const timeSinceLastMessage = Date.now() - timestamp;
    
    if (timeSinceLastMessage < shortDuplicateTimeout) {
      logger.info(`[Webhook] Detected duplicate message with hash: ${hash}, sent ${timeSinceLastMessage}ms ago`);
      return true;
    } else {
      logger.info(`[Webhook] Message with same hash found but ${timeSinceLastMessage}ms have passed (> ${shortDuplicateTimeout}ms), allowing it`);
    }
  }

  // Not a duplicate, add to cache
  recentMessageCache.set(hash, Date.now());

  // Cleanup old cache entries using the same short timeout
  // Plus a little extra to ensure we don't remove entries prematurely
  const now = Date.now();
  const cleanupTimeout = 10000; // 10 seconds - slightly longer than our duplicate timeout
  for (const [key, timestamp] of recentMessageCache.entries()) {
    if (now - timestamp > cleanupTimeout) {
      recentMessageCache.delete(key);
    }
  }

  return false;
}

/**
 * Send a message to a thread, using optimized thread-specific webhook approach
 * This implements specialized thread handling that prioritizes webhook aesthetics
 * 
 * @param {Object} channel - The thread channel to send to
 * @param {string} content - Message content
 * @param {Object} personality - Personality data (name, avatar)
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} The sent message info
 */
async function sendDirectThreadMessage(channel, content, personality, options = {}) {
  if (!channel || !channel.isThread()) {
    logger.error(`[WebhookManager] Called sendDirectThreadMessage on non-thread channel: ${channel?.id}`);
    throw new Error('Cannot send direct thread message to non-thread channel');
  }
  
  logger.info(`[WebhookManager] OPTIMIZED THREAD MESSAGE: Sending to thread ${channel.id} as ${personality.displayName || personality.fullName}`);
  
  try {
    // First try the webhook approach with optimized thread parameters 
    // This preserves webhook aesthetics like avatar and proper username
    
    // 1. Attempt to get or create a proper webhook for the thread's parent channel
    logger.info(`[WebhookManager] Thread optimized approach - getting parent webhook for thread ${channel.id}`);
    
    // Get parent channel
    const parentChannel = channel.parent;
    if (!parentChannel) {
      throw new Error(`Cannot find parent channel for thread ${channel.id}`);
    }
    
    // Get webhooks directly from parent channel
    const webhooks = await parentChannel.fetchWebhooks();
    
    // Find or create our bot's webhook
    let webhook = webhooks.find(wh => wh.name === 'Tzurot');
    if (!webhook) {
      logger.info(`[WebhookManager] Creating new webhook in parent channel ${parentChannel.id}`);
      webhook = await parentChannel.createWebhook({
        name: 'Tzurot',
        reason: 'Needed for personality proxying in threads',
      });
    } else {
      logger.info(`[WebhookManager] Found existing Tzurot webhook in parent channel ${parentChannel.id}`);
    }
    
    // Create webhook client from URL
    const webhookClient = new WebhookClient({ url: webhook.url });
    
    // Get standardized username for consistent display 
    const standardName = getStandardizedUsername(personality);
    
    // Process any media in the content
    let processedContent = content;
    let mediaAttachments = [];
    
    try {
      if (typeof content === 'string') {
        const mediaResult = await processMediaForWebhook(content);
        processedContent = mediaResult.content;
        mediaAttachments = mediaResult.attachments;
        
        if (mediaAttachments.length > 0) {
          logger.info(`[WebhookManager] Processed ${mediaAttachments.length} media attachments for thread message`);
        }
      }
    } catch (mediaError) {
      logger.error(`[WebhookManager] Error processing media for thread message: ${mediaError.message}`);
      // Continue with original content
      processedContent = content;
      mediaAttachments = [];
    }
    
    // Split message if needed
    const contentChunks = splitMessage(processedContent);
    logger.info(`[WebhookManager] Split thread message into ${contentChunks.length} chunks`);
    
    // Track sent messages
    const sentMessageIds = [];
    let firstSentMessage = null;
    
    // Try multiple approaches in sequence (best webhook approach first)
    for (let i = 0; i < contentChunks.length; i++) {
      const isFirstChunk = i === 0;
      const isLastChunk = i === contentChunks.length - 1;
      const chunkContent = contentChunks[i];
      
      // Skip duplicate messages
      if (isDuplicateMessage(chunkContent, standardName, channel.id)) {
        logger.info(`[WebhookManager] Skipping thread chunk ${i + 1} due to duplicate detection`);
        continue;
      }
      
      // Only include files in last chunk
      const files = isLastChunk ? mediaAttachments : [];
      
      // Only include embeds in last chunk
      const embeds = (isLastChunk && options.embeds) ? options.embeds : [];
      
      // Prepare base webhook options
      const baseOptions = {
        content: chunkContent,
        username: standardName,
        avatarURL: personality.avatarUrl,
        threadId: channel.id,
        files,
        embeds
      };
      
      // Send using multiple approaches in sequence until one works
      try {
        let sentMessage = null;
        
        // APPROACH 1: Use webhook with thread_id parameter (most compatible)
        try {
          logger.info(`[WebhookManager] THREAD APPROACH 1: Using direct thread_id parameter`);
          sentMessage = await webhookClient.send({
            ...baseOptions,
            thread_id: channel.id
          });
          logger.info(`[WebhookManager] Successfully sent thread message using thread_id parameter`);
        } catch (approach1Error) {
          logger.error(`[WebhookManager] Thread approach 1 failed: ${approach1Error.message}`);
          
          // APPROACH 2: Use webhook.thread() method if available
          if (typeof webhookClient.thread === 'function') {
            try {
              logger.info(`[WebhookManager] THREAD APPROACH 2: Using webhook.thread() method`);
              const threadWebhook = webhookClient.thread(channel.id);
              // Don't pass threadId in the options since we're using thread-specific client
              const { threadId, ...threadOptions } = baseOptions;
              sentMessage = await threadWebhook.send(threadOptions);
              logger.info(`[WebhookManager] Successfully sent thread message using thread() method`);
            } catch (approach2Error) {
              logger.error(`[WebhookManager] Thread approach 2 failed: ${approach2Error.message}`);
              throw approach2Error; // Let the outer catch handle the fallback
            }
          } else {
            throw approach1Error; // Re-throw to fall through to the fallback
          }
        }
        
        // If we got here, message was sent successfully
        sentMessageIds.push(sentMessage.id);
        
        if (isFirstChunk) {
          firstSentMessage = sentMessage;
        }
        
        logger.info(`[WebhookManager] Successfully sent thread message chunk ${i + 1}/${contentChunks.length}`);
      } catch (error) {
        // All webhook approaches failed, fall back to direct channel.send()
        logger.error(`[WebhookManager] All webhook approaches failed: ${error.message}`);
        logger.info(`[WebhookManager] Falling back to direct channel.send()`);
        
        try {
          // Format the content with the personality name for direct sending
          const formattedContent = `**${standardName}:** ${chunkContent}`;
          
          // Create send options
          const sendOptions = {
            content: formattedContent
          };
          
          // Add files/embeds if this is the last chunk
          if (isLastChunk) {
            if (files.length > 0) sendOptions.files = files;
            if (embeds.length > 0) sendOptions.embeds = embeds;
          }
          
          // Send using direct approach
          const sentMessage = await channel.send(sendOptions);
          
          // Track message
          sentMessageIds.push(sentMessage.id);
          
          if (isFirstChunk) {
            firstSentMessage = sentMessage;
          }
          
          logger.info(`[WebhookManager] Successfully sent direct fallback message for chunk ${i + 1}/${contentChunks.length}`);
        } catch (fallbackError) {
          logger.error(`[WebhookManager] Even direct send failed: ${fallbackError.message}`);
          
          if (isFirstChunk) {
            // If first chunk fails with all approaches, propagate the error
            throw fallbackError;
          }
          // Otherwise continue with remaining chunks
        }
      }
    }
    
    // Return result
    if (sentMessageIds.length > 0) {
      return {
        message: firstSentMessage,
        messageIds: sentMessageIds,
        isThreadMessage: true,
        personalityName: personality.fullName
      };
    } else {
      // If no messages were sent (all were duplicates), create a virtual result
      return createVirtualResult(personality, channel.id);
    }
  } catch (error) {
    logger.error(`[WebhookManager] Failed to send thread message: ${error.message}`);
    throw error;
  }
}

module.exports = {
  // Main webhook API functions
  getOrCreateWebhook,
  sendWebhookMessage,
  clearWebhookCache,
  clearAllWebhookCaches,
  registerEventListeners,
  preloadPersonalityAvatar,
  sendFormattedMessageInDM,
  sendDirectThreadMessage, // Add the new function

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

  // Avatar URL handling
  validateAvatarUrl,
  getValidAvatarUrl,
  warmupAvatarUrl,

  // For testing purposes
  splitByCharacterLimit,
  processSentence,
  processLine,
  processParagraph,
};
