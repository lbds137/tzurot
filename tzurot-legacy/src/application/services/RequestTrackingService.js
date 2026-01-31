/**
 * Request Tracking Service
 *
 * Provides duplicate request protection and tracking for commands,
 * preventing duplicate operations from being processed within a time window.
 * This is critical for commands that create resources (like personalities)
 * to prevent accidental duplicates.
 */
class RequestTrackingService {
  constructor(options = {}) {
    // Configuration with defaults
    this.pendingWindowMs = options.pendingWindowMs || 10000; // 10 seconds
    this.completedWindowMs = options.completedWindowMs || 5000; // 5 seconds
    this.cleanupIntervalMs = options.cleanupIntervalMs || 60000; // 1 minute

    // Tracking maps
    this.pendingRequests = new Map(); // Track in-progress requests
    this.completedRequests = new Map(); // Track recently completed requests
    this.messageProcessing = new Set(); // Track messages being processed

    // Injectable dependencies
    this.scheduler = options.scheduler || setTimeout;
    this.clearScheduler = options.clearScheduler || clearTimeout;

    // Start cleanup timer
    this.cleanupTimer = this.scheduler(() => this.cleanup(), this.cleanupIntervalMs);
  }

  /**
   * Check if a request is already pending or recently completed
   * @param {string} key - Unique key for the request (e.g., userId-personalityName)
   * @returns {Object} Status object with { isPending, isCompleted, canProceed }
   */
  checkRequest(key) {
    const now = Date.now();

    // Check if request is pending
    const pendingRequest = this.pendingRequests.get(key);
    if (pendingRequest && now - pendingRequest.timestamp < this.pendingWindowMs) {
      return {
        isPending: true,
        isCompleted: false,
        canProceed: false,
        reason: 'Request is already in progress',
      };
    }

    // Check if request was recently completed
    const completedRequest = this.completedRequests.get(key);
    if (completedRequest && now - completedRequest.timestamp < this.completedWindowMs) {
      return {
        isPending: false,
        isCompleted: true,
        canProceed: false,
        reason: 'Request was recently completed',
      };
    }

    return {
      isPending: false,
      isCompleted: false,
      canProceed: true,
    };
  }

  /**
   * Mark a request as pending (in-progress)
   * @param {string} key - Unique key for the request
   * @param {Object} metadata - Optional metadata to store with the request
   */
  markPending(key, metadata = {}) {
    this.pendingRequests.set(key, {
      timestamp: Date.now(),
      ...metadata,
    });
  }

  /**
   * Mark a request as completed
   * @param {string} key - Unique key for the request
   * @param {Object} metadata - Optional metadata to store with the completion
   */
  markCompleted(key, metadata = {}) {
    // Remove from pending
    this.pendingRequests.delete(key);

    // Add to completed
    this.completedRequests.set(key, {
      timestamp: Date.now(),
      ...metadata,
    });
  }

  /**
   * Mark a request as failed (removes from pending but doesn't mark as completed)
   * @param {string} key - Unique key for the request
   */
  markFailed(key) {
    this.pendingRequests.delete(key);
  }

  /**
   * Check if a message is already being processed
   * @param {string} messageId - Discord message ID
   * @returns {boolean} True if message is being processed
   */
  isMessageProcessing(messageId) {
    return this.messageProcessing.has(messageId);
  }

  /**
   * Mark a message as being processed
   * @param {string} messageId - Discord message ID
   */
  markMessageProcessing(messageId) {
    this.messageProcessing.add(messageId);

    // Auto-cleanup after a reasonable time
    this.scheduler(() => {
      this.messageProcessing.delete(messageId);
    }, this.pendingWindowMs * 2);
  }

  /**
   * Generate a standard request key for add personality commands
   * @param {string} userId - User ID
   * @param {string} personalityName - Personality name
   * @param {string} alias - Optional alias
   * @returns {string} Request key
   */
  generateAddCommandKey(userId, personalityName, alias = null) {
    const baseKey = `${userId}-${personalityName.toLowerCase()}`;
    return alias ? `${baseKey}-alias-${alias.toLowerCase()}` : baseKey;
  }

  /**
   * Clean up old entries from tracking maps
   */
  cleanup() {
    const now = Date.now();

    // Clean up old pending requests
    for (const [key, request] of this.pendingRequests.entries()) {
      if (now - request.timestamp > this.pendingWindowMs * 2) {
        this.pendingRequests.delete(key);
      }
    }

    // Clean up old completed requests
    for (const [key, request] of this.completedRequests.entries()) {
      if (now - request.timestamp > this.completedWindowMs * 2) {
        this.completedRequests.delete(key);
      }
    }

    // Schedule next cleanup
    this.cleanupTimer = this.scheduler(() => this.cleanup(), this.cleanupIntervalMs);
  }

  /**
   * Stop the cleanup timer (for testing or shutdown)
   */
  stopCleanup() {
    if (this.cleanupTimer !== null && this.cleanupTimer !== undefined) {
      this.clearScheduler(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * Get current tracking statistics (for debugging/monitoring)
   * @returns {Object} Statistics object
   */
  getStats() {
    return {
      pendingRequests: this.pendingRequests.size,
      completedRequests: this.completedRequests.size,
      processingMessages: this.messageProcessing.size,
    };
  }

  /**
   * Clear all tracking data (for testing)
   */
  clear() {
    this.pendingRequests.clear();
    this.completedRequests.clear();
    this.messageProcessing.clear();
  }
}

module.exports = RequestTrackingService;
