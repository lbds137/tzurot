/**
 * Domain service for deduplicating AI requests
 * @module domain/ai/AIRequestDeduplicator
 */

const crypto = require('crypto');
const logger = require('../../logger');

/**
 * AIRequestDeduplicator - Prevents duplicate AI requests and manages error blackout periods
 *
 * This domain service ensures that:
 * 1. Identical requests are not sent multiple times concurrently
 * 2. Failed requests have a blackout period before retrying
 * 3. System resources are not wasted on duplicate API calls
 */
class AIRequestDeduplicator {
  constructor(config = {}) {
    // Pending requests - Map<string, { promise: Promise, timestamp: number }>
    this.pendingRequests = new Map();

    // Error blackout periods - Map<string, number>
    this.errorBlackouts = new Map();

    // Configuration
    this.config = {
      requestTTL: config.requestTTL || 30000, // 30 seconds
      errorBlackoutDuration: config.errorBlackoutDuration || 60000, // 1 minute
      cleanupInterval: config.cleanupInterval || 60000, // 1 minute
    };

    // Injectable timer functions - require explicit injection for production use
    if (!config.timers) {
      throw new Error(
        'Timer functions must be provided via config.timers. ' +
          'Use globalThis.setTimeout/setInterval or inject test doubles.'
      );
    }
    this.timers = config.timers;

    // Use a scheduler pattern for cleanup instead of direct setInterval
    this._scheduleCleanup();
  }

  /**
   * Generate a unique signature for a request
   * @private
   */
  _generateSignature(personalityName, content, context = {}) {
    const data = {
      personality: personalityName.toLowerCase(),
      content: content,
      // Include important context that affects the response
      userAuth: context.userAuth || null,
      conversationId: context.conversationId || null,
    };

    return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
  }

  /**
   * Check if this request is currently being processed
   * @param {string} personalityName - Name of the personality
   * @param {string} content - Message content
   * @param {Object} context - Additional context
   * @returns {Promise|null} Existing promise if duplicate, null otherwise
   */
  async checkDuplicate(personalityName, content, context = {}) {
    const signature = this._generateSignature(personalityName, content, context);

    // Check if in error blackout period
    const blackoutUntil = this.errorBlackouts.get(signature);
    if (blackoutUntil && this.timers.now() < blackoutUntil) {
      logger.warn(
        `[AIRequestDeduplicator] Request for "${personalityName}" is in error blackout until ${new Date(blackoutUntil).toISOString()}`
      );
      throw new Error('Request is in error blackout period. Please try again later.');
    }

    // Check for pending request
    const pending = this.pendingRequests.get(signature);
    if (pending) {
      logger.info(
        `[AIRequestDeduplicator] Found duplicate request for "${personalityName}", returning existing promise`
      );
      return pending.promise;
    }

    return null;
  }

  /**
   * Register a new request as pending
   * @param {string} personalityName - Name of the personality
   * @param {string} content - Message content
   * @param {Object} context - Additional context
   * @param {Promise} promise - The promise representing the request
   * @returns {string} Request signature
   */
  registerPending(personalityName, content, context, promise) {
    const signature = this._generateSignature(personalityName, content, context);

    this.pendingRequests.set(signature, {
      promise,
      timestamp: this.timers.now(),
    });

    // Clean up when the promise resolves or rejects
    promise
      .finally(() => {
        this.pendingRequests.delete(signature);
      })
      .catch(() => {
        // Register error blackout on failure
        this.errorBlackouts.set(signature, this.timers.now() + this.config.errorBlackoutDuration);
      });

    logger.debug(
      `[AIRequestDeduplicator] Registered pending request for "${personalityName}" (${signature})`
    );

    return signature;
  }

  /**
   * Clear a pending request
   * @param {string} signature - Request signature
   */
  clearPending(signature) {
    this.pendingRequests.delete(signature);
    logger.debug(`[AIRequestDeduplicator] Cleared pending request: ${signature}`);
  }

  /**
   * Mark a request as failed and apply blackout
   * @param {string} personalityName - Name of the personality
   * @param {string} content - Message content
   * @param {Object} context - Additional context
   */
  markFailed(personalityName, content, context = {}) {
    const signature = this._generateSignature(personalityName, content, context);
    this.errorBlackouts.set(signature, this.timers.now() + this.config.errorBlackoutDuration);
    logger.info(
      `[AIRequestDeduplicator] Marked request for "${personalityName}" as failed, blackout for ${this.config.errorBlackoutDuration}ms`
    );
  }

  /**
   * Schedule periodic cleanup using scheduler pattern
   * @private
   */
  _scheduleCleanup() {
    const performCleanup = () => {
      this._cleanupStaleEntries();

      // Schedule next cleanup
      this._cleanupTimer = this.timers.setTimeout(() => {
        performCleanup();
      }, this.config.cleanupInterval);
    };

    // Start the cleanup cycle
    this._cleanupTimer = this.timers.setTimeout(() => {
      performCleanup();
    }, this.config.cleanupInterval);
  }

  /**
   * Clean up stale pending requests and expired blackouts
   * @private
   */
  _cleanupStaleEntries() {
    const now = this.timers.now();
    let cleanedRequests = 0;
    let cleanedBlackouts = 0;

    // Clean up stale pending requests
    for (const [signature, data] of this.pendingRequests.entries()) {
      if (now - data.timestamp > this.config.requestTTL) {
        this.pendingRequests.delete(signature);
        cleanedRequests++;
      }
    }

    // Clean up expired blackouts
    for (const [signature, until] of this.errorBlackouts.entries()) {
      if (now >= until) {
        this.errorBlackouts.delete(signature);
        cleanedBlackouts++;
      }
    }

    if (cleanedRequests > 0 || cleanedBlackouts > 0) {
      logger.debug(
        `[AIRequestDeduplicator] Cleanup: removed ${cleanedRequests} stale requests, ${cleanedBlackouts} expired blackouts`
      );
    }
  }

  /**
   * Get current statistics
   * @returns {Object} Statistics
   */
  getStats() {
    return {
      pendingRequests: this.pendingRequests.size,
      errorBlackouts: this.errorBlackouts.size,
    };
  }

  /**
   * Clear all state (useful for testing)
   */
  clear() {
    this.pendingRequests.clear();
    this.errorBlackouts.clear();
    if (this._cleanupTimer) {
      this.timers.clearTimeout(this._cleanupTimer);
      this._cleanupTimer = null;
    }
    logger.debug('[AIRequestDeduplicator] Cleared all state');
  }
}

module.exports = { AIRequestDeduplicator };
