/**
 * Webhook User Tracker
 *
 * This module helps associate webhook messages (especially from systems like Pluralkit)
 * with their original Discord users. It provides utilities to:
 *
 * 1. Track associations between webhook IDs and real user IDs
 * 2. Look up the real user behind a webhook message
 * 3. Verify if a webhook message is from a trusted proxy system like Pluralkit
 *
 * This is especially important for features that require user verification,
 * such as NSFW checks and authentication.
 */

const logger = require('../logger');
const pluralkitMessageStore = require('./pluralkitMessageStore').instance;

// Map of webhook IDs to real user IDs
// Format: Map<webhookId, { userId: string, timestamp: number }>
const webhookUserMap = new Map();

// List of known webhook proxy system names
const KNOWN_PROXY_SYSTEMS = ['PluralKit', 'Tupperbox', 'PK', 'PKSystem'];

// List of known webhook proxy IDs to more reliably identify systems
const KNOWN_PROXY_WEBHOOK_IDS = [
  '466378653216014359', // PluralKit bot ID
  '510016054391734273', // Tupperbox bot ID
];

// Map to cache known webhook IDs that we've identified as proxy systems
const knownProxyWebhooks = new Map();

// Cache expiration time (1 hour)
const CACHE_EXPIRATION = 60 * 60 * 1000;

// Store cleanup intervals for proper cleanup
let cleanupIntervals = [];

/**
 * Get authentication status for a user using DDD system
 * @param {string} userId - User ID to check
 * @returns {Promise<boolean>} Whether user is authenticated
 */
async function isUserAuthenticated(userId) {
  try {
    const { getApplicationBootstrap } = require('../application/bootstrap/ApplicationBootstrap');
    const bootstrap = getApplicationBootstrap();
    const authService = bootstrap.getApplicationServices().authenticationService;
    const status = await authService.getAuthenticationStatus(userId);
    return status.isAuthenticated;
  } catch (error) {
    logger.error('[WebhookUserTracker] Error checking user authentication:', error);
    return false;
  }
}

/**
 * Clean up old entries from the webhook user map
 * @private
 */
function cleanupOldEntries() {
  const now = Date.now();

  // Remove entries older than the cache expiration
  for (const [webhookId, data] of webhookUserMap.entries()) {
    if (now - data.timestamp > CACHE_EXPIRATION) {
      webhookUserMap.delete(webhookId);
    }
  }
}

// Cleanup function for known proxy webhooks cache
function cleanupProxyWebhookCache() {
  const now = Date.now();

  // Remove entries older than the cache expiration
  for (const [webhookId, data] of knownProxyWebhooks.entries()) {
    if (now - data.timestamp > CACHE_EXPIRATION) {
      knownProxyWebhooks.delete(webhookId);
    }
  }
}

/**
 * Start cleanup intervals
 * @param {Object} options - Configuration options
 * @param {Function} options.interval - Injectable interval function (default: setInterval)
 * @returns {Array} Array of interval IDs for cleanup
 */
function startCleanupIntervals(options = {}) {
  const { interval = setInterval } = options;

  // Clear any existing intervals
  stopCleanupIntervals();

  // Start new intervals
  const userCleanupInterval = interval(cleanupOldEntries, 15 * 60 * 1000); // Every 15 minutes
  const proxyCleanupInterval = interval(cleanupProxyWebhookCache, 15 * 60 * 1000); // Every 15 minutes

  // Add unref if available (Node.js timers)
  if (userCleanupInterval && userCleanupInterval.unref) {
    userCleanupInterval.unref();
  }
  if (proxyCleanupInterval && proxyCleanupInterval.unref) {
    proxyCleanupInterval.unref();
  }

  cleanupIntervals = [userCleanupInterval, proxyCleanupInterval];
  return cleanupIntervals;
}

/**
 * Stop cleanup intervals
 */
function stopCleanupIntervals() {
  cleanupIntervals.forEach(intervalId => {
    if (intervalId && typeof intervalId === 'object' && intervalId.close) {
      intervalId.close(); // For Node.js timers
    } else if (intervalId) {
      clearInterval(intervalId); // For browser timers
    }
  });
  cleanupIntervals = [];
}

// Start cleanup intervals by default
startCleanupIntervals();

/**
 * Register an association between a webhook ID and a real user ID
 *
 * @param {string} webhookId - The webhook ID
 * @param {string} userId - The real user ID
 */
function associateWebhookWithUser(webhookId, userId) {
  if (!webhookId || !userId) return;

  webhookUserMap.set(webhookId, {
    userId,
    timestamp: Date.now(),
  });

  logger.debug(`[WebhookUserTracker] Associated webhook ${webhookId} with user ${userId}`);
}

/**
 * Get the real user ID associated with a webhook ID
 *
 * @param {string} webhookId - The webhook ID
 * @returns {string|null} The real user ID, or null if not found
 */
function getRealUserIdFromWebhook(webhookId) {
  if (!webhookId) return null;

  const data = webhookUserMap.get(webhookId);
  if (!data) return null;

  // Update the timestamp to keep the association fresh
  data.timestamp = Date.now();
  webhookUserMap.set(webhookId, data);

  return data.userId;
}

/**
 * Check if a message appears to be from a trusted proxy system like PluralKit
 *
 * @param {Object} message - The Discord message object
 * @returns {boolean} True if the message appears to be from a proxy system
 */
function isProxySystemWebhook(message) {
  if (!message) return false;

  // Must be a webhook message
  if (!message.webhookId) return false;

  // Check if we've already identified this webhook ID as a proxy system
  if (knownProxyWebhooks.has(message.webhookId)) {
    logger.debug(
      `[WebhookUserTracker] Using cached identification for webhook ${message.webhookId}`
    );
    return true;
  }

  // Note: We no longer check if this is our bot's webhook here
  // That check is done separately in messageHandler.js using applicationId === client.user.id
  // This function is specifically for identifying third-party proxy systems like PluralKit

  // Check if the application ID matches any known proxy systems
  // The application ID is the bot user ID that created the webhook
  if (message.applicationId && KNOWN_PROXY_WEBHOOK_IDS.includes(message.applicationId)) {
    logger.info(
      `[WebhookUserTracker] Identified proxy system by application ID: ${message.applicationId}`
    );
    // Cache this webhook ID for future messages
    knownProxyWebhooks.set(message.webhookId, { timestamp: Date.now() });
    return true;
  }

  // Check for system tag in username
  const username = message.author?.username || '';

  // Check if it's from a webhook user with a system tag
  const isKnownSystem = KNOWN_PROXY_SYSTEMS.some(
    system =>
      username.includes(system) ||
      (message.member?.nickname && message.member.nickname.includes(system))
  );

  if (isKnownSystem) {
    logger.info(`[WebhookUserTracker] Identified proxy system by name match: ${username}`);
    // Cache this webhook ID for future messages
    knownProxyWebhooks.set(message.webhookId, { timestamp: Date.now() });
    return true;
  }

  // Additional check for PluralKit-specific patterns
  // PluralKit messages often have system or member IDs in them
  // System IDs are in the format 'System ID: xxxx' in embeds
  if (message.embeds?.length > 0) {
    for (const embed of message.embeds) {
      // Check embed fields for system ID or member ID patterns
      if (
        embed.fields?.some(
          field =>
            field.name === 'System ID' ||
            field.name === 'Member ID' ||
            field.name?.includes('System') ||
            field.value?.includes('pk:')
        )
      ) {
        logger.info(`[WebhookUserTracker] Identified PluralKit by embed patterns`);
        knownProxyWebhooks.set(message.webhookId, { timestamp: Date.now() });
        return true;
      }
    }
  }

  // Look for other PluralKit patterns in the message content
  if (
    message.content &&
    (message.content.includes('pk:') ||
      message.content.includes('System ID:') ||
      message.content.includes('Member ID:'))
  ) {
    logger.info(`[WebhookUserTracker] Identified PluralKit by content patterns`);
    knownProxyWebhooks.set(message.webhookId, { timestamp: Date.now() });
    return true;
  }

  return false;
}

/**
 * Get the real user ID for a message, considering webhook proxies
 *
 * @param {Object} message - The Discord message object
 * @returns {string|null} The real user ID, or the original author ID if not a proxy
 */
function getRealUserId(message) {
  if (!message) return null;

  // If not a webhook, just return the author ID
  if (!message.webhookId) {
    return message.author?.id || null;
  }

  // Check if we have a cached association
  const cachedUserId = getRealUserIdFromWebhook(message.webhookId);
  if (cachedUserId) {
    logger.debug(
      `[WebhookUserTracker] Found cached user ${cachedUserId} for webhook ${message.webhookId}`
    );
    return cachedUserId;
  }

  // If we can determine this is a proxy system, try to find the original user
  if (isProxySystemWebhook(message)) {
    logger.info(`[WebhookUserTracker] Detected proxy system webhook: ${message.author?.username}`);

    // Try to find the original user from our PluralKit message store
    // Look for a recently deleted message with the same content
    logger.debug(
      `[WebhookUserTracker] Searching for deleted message with content: "${message.content}" in channel ${message.channel.id}`
    );
    const originalMessageData = pluralkitMessageStore.findDeletedMessage(
      message.content,
      message.channel.id
    );
    if (originalMessageData) {
      logger.info(
        `[WebhookUserTracker] Found original user ${originalMessageData.userId} for PluralKit message`
      );
      // Cache this association for future use
      associateWebhookWithUser(message.webhookId, originalMessageData.userId);
      return originalMessageData.userId;
    } else {
      logger.warn(
        `[WebhookUserTracker] No deleted message found matching content: "${message.content}" in channel ${message.channel.id}`
      );
    }

    // For proxy systems without an associated user, we'll return a special ID that will
    // be handled specially in verification checks
    return 'proxy-system-user';
  }

  // Default to the message author ID
  return message.author?.id || null;
}

/**
 * Should this message bypass NSFW verification?
 *
 * @param {Object} message - The Discord message object
 * @returns {boolean} True if NSFW verification should be bypassed
 */
function shouldBypassNsfwVerification(message) {
  // Fast path: if not a webhook message, no need to bypass
  if (!message || !message.webhookId) {
    return false;
  }

  // If this is a proxy system webhook, bypass verification
  if (isProxySystemWebhook(message)) {
    logger.info(
      `[WebhookUserTracker] Bypassing NSFW verification for proxy system: ${message.author?.username || 'unknown'}`
    );
    return true;
  }

  // Special case for command messages from webhooks
  // If this is a command (!tz) from a webhook, we'll bypass verification to prevent blocking legitimate proxy users
  const { botPrefix } = require('../../config');
  if (message.content && message.content.startsWith(botPrefix)) {
    // Extract the command from the message
    const commandText = message.content.slice(botPrefix.length).trim();
    const commandParts = commandText.split(/\s+/);
    const primaryCommand = commandParts[0]?.toLowerCase();

    // List of commands that should not bypass verification
    const restrictedCommands = ['auth'];

    if (restrictedCommands.includes(primaryCommand)) {
      // Auth and other restricted commands require special handling
      logger.info(
        `[WebhookUserTracker] Restricted command '${primaryCommand}' detected from webhook, not bypassing`
      );
      return false;
    }

    // For all other commands, bypass verification
    logger.info(
      `[WebhookUserTracker] Bypassing verification for webhook command: ${primaryCommand}`
    );
    return true;
  }

  return false;
}

/**
 * Check if authentication is allowed for this message
 * For security reasons, auth commands through webhooks are not allowed
 *
 * @param {Object} message - The Discord message object
 * @returns {boolean} True if authentication is allowed, false if not
 */
function isAuthenticationAllowed(message) {
  // If not a webhook message, authentication is always allowed
  if (!message || !message.webhookId) {
    return true;
  }

  // For webhook messages, only allow auth if:
  // 1. We can identify a real user behind the webhook AND
  // 2. It's not from a proxy system like PluralKit

  // Check if it's a proxy system - these are not allowed to authenticate
  if (isProxySystemWebhook(message)) {
    logger.info(
      `[WebhookUserTracker] Authentication not allowed for proxy system: ${message.author?.username || 'unknown'}`
    );
    return false;
  }

  // If we get here, it's a webhook but not a known proxy system
  // Check if we have a real user ID for this webhook
  const realUserId = getRealUserIdFromWebhook(message.webhookId);
  if (realUserId) {
    // We have a real user ID, allow authentication
    logger.info(
      `[WebhookUserTracker] Authentication allowed for webhook with known user: ${realUserId}`
    );
    return true;
  }

  // No real user ID found, don't allow authentication
  logger.info(`[WebhookUserTracker] Authentication not allowed for webhook without known user`);
  return false;
}

/**
 * Clear a specific webhook from the known proxy webhooks cache
 * Useful for fixing incorrectly cached webhooks
 *
 * @param {string} webhookId - The webhook ID to clear
 */
function clearCachedWebhook(webhookId) {
  if (knownProxyWebhooks.has(webhookId)) {
    knownProxyWebhooks.delete(webhookId);
    logger.info(`[WebhookUserTracker] Cleared cached webhook: ${webhookId}`);
  }
}

/**
 * Clear all cached webhooks
 * Useful for resetting after fixing identification issues
 */
function clearAllCachedWebhooks() {
  const count = knownProxyWebhooks.size;
  knownProxyWebhooks.clear();
  logger.info(`[WebhookUserTracker] Cleared all ${count} cached webhooks`);
}

/**
 * Check if a proxy system message is from an authenticated user
 *
 * @param {Object} message - The Discord message object
 * @returns {Promise<Object>} Object with isAuthenticated boolean and userId
 */
async function checkProxySystemAuthentication(message) {
  if (!message || !message.webhookId || !isProxySystemWebhook(message)) {
    return { isAuthenticated: false, userId: null };
  }

  // Try to find the original user from our PluralKit message store
  // Look for a recently deleted message with the same content
  const originalMessageData = pluralkitMessageStore.findDeletedMessage(
    message.content,
    message.channel.id
  );
  if (originalMessageData) {
    logger.info(
      `[WebhookUserTracker] Found original user ${originalMessageData.userId} for authentication check`
    );
    // Cache this association for future use
    associateWebhookWithUser(message.webhookId, originalMessageData.userId);

    // Check if this user is authenticated using DDD system
    const isAuthenticated = await isUserAuthenticated(originalMessageData.userId);

    return {
      isAuthenticated,
      userId: originalMessageData.userId,
      username: originalMessageData.username,
    };
  }

  // Check cached associations
  const cachedUserId = getRealUserIdFromWebhook(message.webhookId);
  if (cachedUserId && cachedUserId !== 'proxy-system-user') {
    const isAuthenticated = await isUserAuthenticated(cachedUserId);
    return {
      isAuthenticated,
      userId: cachedUserId,
    };
  }

  return { isAuthenticated: false, userId: null };
}

module.exports = {
  associateWebhookWithUser,
  getRealUserIdFromWebhook,
  isProxySystemWebhook,
  getRealUserId,
  shouldBypassNsfwVerification,
  isAuthenticationAllowed,
  clearCachedWebhook,
  clearAllCachedWebhooks,
  checkProxySystemAuthentication,
  // Export cleanup functions for testing
  cleanupOldEntries,
  cleanupProxyWebhookCache,
  startCleanupIntervals,
  stopCleanupIntervals,
};
