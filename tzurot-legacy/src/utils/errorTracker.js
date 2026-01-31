/**
 * Error Tracking Utility
 *
 * This module provides enhanced error tracking functionality for better debugging,
 * especially for intermittent or hard-to-reproduce issues.
 *
 * TODO: Future improvements
 * - Add integration with external error monitoring services
 * - Implement more sophisticated error categorization
 * - Add performance metrics tracking for critical operations
 * - Consider adding error rate limiting to prevent log flooding
 */
const logger = require('../logger');
const crypto = require('crypto');

// Track recent errors for detecting patterns
const recentErrors = new Map();
const ERROR_CACHE_LIFETIME = 30 * 60 * 1000; // 30 minutes

// Error categories for better organization
const ErrorCategory = {
  DISCORD_API: 'discord_api',
  WEBHOOK: 'webhook',
  AVATAR: 'avatar',
  MESSAGE: 'message',
  RATE_LIMIT: 'rate_limit',
  AI_SERVICE: 'ai_service',
  API_CONTENT: 'api_content',
  UNKNOWN: 'unknown',
};

/**
 * Record an error with additional context for better debugging
 *
 * @param {Error} error - The error object
 * @param {Object} context - Additional context about the error
 * @param {string} context.category - Error category for grouping
 * @param {string} context.operation - The operation that was being performed
 * @param {Object} context.metadata - Additional metadata about the error
 * @param {boolean} context.isCritical - Whether this is a critical error
 */
function trackError(error, context = {}) {
  const {
    category = ErrorCategory.UNKNOWN,
    operation = 'unknown',
    metadata = {},
    isCritical = false,
  } = context;

  // Generate a unique error ID for reference
  const errorId = generateErrorId(category, operation);

  // Combine error information with context
  const errorInfo = {
    errorId,
    message: error.message,
    stack: error.stack,
    category,
    operation,
    metadata,
    isCritical,
    timestamp: Date.now(),
    count: 1,
  };

  // Check if we've seen this error recently
  const errorKey = `${category}:${operation}:${error.message}`;
  if (recentErrors.has(errorKey)) {
    const existingError = recentErrors.get(errorKey);

    // Update the count and timestamp
    existingError.count++;
    existingError.timestamp = Date.now();

    // If we're seeing this error frequently, increase log level
    if (existingError.count > 5) {
      errorInfo.frequent = true;
      logger.error(
        `[ErrorTracker] Frequent error detected (${existingError.count} occurrences): ${error.message}`,
        {
          errorId,
          category,
          operation,
          metadata,
        }
      );
    }
  } else {
    // Record this new error
    recentErrors.set(errorKey, errorInfo);

    // Clean up old errors
    cleanupOldErrors();
  }

  // Log the error with context
  const logMethod = isCritical ? logger.error : logger.warn;
  logMethod(
    `[ErrorTracker] ${isCritical ? 'CRITICAL ' : ''}${category.toUpperCase()}: ${error.message} (${errorId})`,
    {
      errorId,
      category,
      operation,
      metadata,
    }
  );

  return errorId;
}

/**
 * Generate a unique error ID for reference in logs
 *
 * @param {string} category - Error category
 * @param {string} operation - Operation that caused the error
 * @returns {string} A unique error ID
 */
function generateErrorId(category, operation) {
  // Use crypto.randomUUID for guaranteed uniqueness
  const uuid = crypto.randomUUID();
  // Keep the category and operation prefix for easier debugging
  return `ERR-${category.slice(0, 3).toLowerCase()}-${operation.slice(0, 3).toLowerCase()}-${uuid}`;
}

/**
 * Remove old errors from the tracking map
 */
function cleanupOldErrors() {
  const now = Date.now();
  for (const [key, error] of recentErrors.entries()) {
    if (now - error.timestamp > ERROR_CACHE_LIFETIME) {
      recentErrors.delete(key);
    }
  }
}

/**
 * Creates a wrapped Discord webhook client that includes better error handling
 *
 * @param {Object} webhookClient - The Discord webhook client to wrap
 * @param {Object} metadata - Additional metadata about this webhook
 * @returns {Object} A wrapped webhook client with enhanced error reporting
 */
function createEnhancedWebhookClient(webhookClient, metadata = {}) {
  // Create a proxy to intercept webhook method calls
  return new Proxy(webhookClient, {
    get(target, property) {
      // Only proxy method calls
      if (typeof target[property] !== 'function') {
        return target[property];
      }

      // Return a wrapped function
      return async function (...args) {
        try {
          // Call the original method
          return await target[property](...args);
        } catch (error) {
          // Track the error with enhanced context
          const errorId = trackError(error, {
            category: ErrorCategory.WEBHOOK,
            operation: property,
            metadata: {
              ...metadata,
              args: args.map(arg => {
                // Avoid logging full message content, just include a preview
                if (arg && typeof arg === 'object' && arg.content) {
                  return {
                    ...arg,
                    content:
                      arg.content.length > 50
                        ? `${arg.content.substring(0, 50)}... (${arg.content.length} chars)`
                        : arg.content,
                  };
                }
                return arg;
              }),
            },
            isCritical: true,
          });

          // Add the error ID to the error for reference
          error.errorId = errorId;

          // Re-throw the error
          throw error;
        }
      };
    },
  });
}

/**
 * Creates a specialized error object with enhanced metadata
 *
 * @param {string} message - Error message
 * @param {string} category - Error category
 * @param {string} operation - Operation that failed
 * @param {Object} metadata - Additional metadata
 * @returns {Error} An enhanced error object
 */
function createEnhancedError(message, category, operation, metadata = {}) {
  const error = new Error(message);
  error.category = category;
  error.operation = operation;
  error.metadata = metadata;
  error.timestamp = Date.now();

  // Track the error immediately
  error.errorId = trackError(error, {
    category,
    operation,
    metadata,
    isCritical: false,
  });

  return error;
}

// Export the module
module.exports = {
  trackError,
  createEnhancedWebhookClient,
  createEnhancedError,
  ErrorCategory,
};
