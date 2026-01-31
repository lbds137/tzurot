/**
 * A utility class for handling rate limiting concerns
 * This implements various strategies for dealing with rate limits:
 * - Request spacing with configurable delays
 * - Exponential backoff for 429 responses
 * - Global cooldown periods after multiple rate limit hits
 *
 * TODO: Future improvements
 * - Add per-host rate limiting for different API endpoints
 * - Implement token bucket algorithm for more precise rate control
 * - Add metrics collection for rate limit events
 * - Consider adding Redis-based distributed rate limiting for multi-instance deployments
 */
const logger = require('../logger');

class RateLimiter {
  /**
   * Creates a new rate limiter
   * @param {Object} options Configuration options
   * @param {number} options.minRequestSpacing Minimum time in ms between requests
   * @param {number} options.maxConcurrent Maximum number of concurrent requests
   * @param {number} options.maxConsecutiveRateLimits Maximum consecutive rate limits before global cooldown
   * @param {number} options.cooldownPeriod Time in ms for global cooldown after too many rate limits
   * @param {number} options.maxRetries Maximum number of retries for rate limited requests
   * @param {string} options.logPrefix Prefix for log messages
   */
  constructor(options = {}) {
    // Default configuration
    this.minRequestSpacing = options.minRequestSpacing || 6000; // 6 seconds between requests
    this.maxConcurrent = options.maxConcurrent || 1; // Default to 1 concurrent request
    this.maxConsecutiveRateLimits = options.maxConsecutiveRateLimits || 3;
    this.cooldownPeriod = options.cooldownPeriod || 60000; // 1 minute cooldown
    this.maxRetries = options.maxRetries || 5;
    this.logPrefix = options.logPrefix || '[RateLimiter]';

    // Injectable timer functions for testability
    // Note: We use inline functions here instead of module-level constants
    // to ensure Jest can properly mock setTimeout when using fake timers
    this.delay = options.delay || ((ms) => new Promise(resolve => globalThis.setTimeout(resolve, ms)));
    this.scheduler = options.scheduler || globalThis.setTimeout;

    // State tracking
    this.lastRequestTime = 0;
    this.consecutiveRateLimits = 0;
    this.activeRequests = 0;
    this.requestQueue = [];
    this.inCooldown = false;
    this.currentRequestContext = null; // Add context tracking for current request
  }

  /**
   * Adds a request to the rate limiter queue
   * @param {Function} requestFn The function to execute when the request is processed
   * @param {Object} [context] Optional context data to associate with this request
   * @returns {Promise} A promise that resolves when the request is processed
   */
  async enqueue(requestFn, context = {}) {
    return new Promise(resolve => {
      // Define the task to be executed
      const task = async () => {
        this.activeRequests++;
        this.currentRequestContext = context; // Set current context before executing
        try {
          const result = await requestFn(this, context);
          resolve(result);
        } catch (error) {
          // Log request execution failure for debugging - helps track rate limiter issues
          logger.warn(
            `${this.logPrefix} Request execution failed: ${error.message || 'Unknown execution error'}. Context: ${JSON.stringify(context)}`
          );
          // Silently resolve with null in case of error - error variable unused but required for catch syntax
          // The actual error handling should happen in the requestFn
          resolve(null);
        } finally {
          this.activeRequests--;
          this.currentRequestContext = null; // Clear context after execution
          this.processQueue();
        }
      };

      // Add to queue
      this.requestQueue.push(task);
      logger.debug(
        `${this.logPrefix} Request added to queue (length: ${this.requestQueue.length})`
      );

      // Try to process the queue immediately
      this.processQueue();
    });
  }

  /**
   * Processes the request queue according to rate limiting rules
   */
  processQueue() {
    // If in cooldown, don't process anything
    if (this.inCooldown) {
      return;
    }

    // Check if we've hit too many consecutive rate limits
    if (this.consecutiveRateLimits >= this.maxConsecutiveRateLimits) {
      logger.warn(
        `${this.logPrefix} Too many consecutive rate limits (${this.consecutiveRateLimits}), enforcing global cooldown of ${this.cooldownPeriod / 1000}s`
      );

      // Enter cooldown mode
      this.inCooldown = true;

      // Schedule end of cooldown
      this.scheduler(() => {
        logger.info(`${this.logPrefix} Global cooldown period ended, resuming normal operation`);
        this.inCooldown = false;
        this.consecutiveRateLimits = 0;
        this.processQueue(); // Try processing queue again
      }, this.cooldownPeriod);

      return;
    }

    // If we have capacity and pending requests, process them
    if (this.activeRequests < this.maxConcurrent && this.requestQueue.length > 0) {
      const now = Date.now();
      const timeSinceLastRequest = now - this.lastRequestTime;

      // Add jitter to avoid synchronized requests
      const jitter = Math.floor(Math.random() * 500);

      // If we need to wait before making another request
      if (timeSinceLastRequest < this.minRequestSpacing) {
        // Schedule the next request after the delay
        const waitTime = this.minRequestSpacing - timeSinceLastRequest + jitter;
        logger.debug(
          `${this.logPrefix} Rate limiting: waiting ${waitTime}ms before next request (queue length: ${this.requestQueue.length})`
        );

        this.scheduler(() => this.processQueue(), waitTime);
        return;
      }

      // Process one request at a time with proper spacing
      const nextRequest = this.requestQueue.shift();
      this.lastRequestTime = now;

      // Execute the request
      nextRequest();

      // If there are more requests, schedule the next check with sufficient delay
      if (this.requestQueue.length > 0) {
        // Use the configured delay plus jitter
        const nextCheckDelay = this.minRequestSpacing + jitter;
        this.scheduler(() => this.processQueue(), nextCheckDelay);
      }
    }
  }

  /**
   * Records a rate limit event and implements backoff strategy
   * @param {string} identifier An identifier for the rate limited resource
   * @param {number} retryAfter The retry-after value in seconds (if provided by server)
   * @returns {Promise<number>} A promise that resolves after the backoff period with the retry count
   */
  async handleRateLimit(identifier, retryAfter = null, retryCount = 0) {
    // Increment consecutive rate limits counter
    this.consecutiveRateLimits++;

    // If we've hit too many rate limits, enter cooldown mode
    if (this.consecutiveRateLimits >= this.maxConsecutiveRateLimits) {
      logger.warn(
        `${this.logPrefix} Too many consecutive rate limits (${this.consecutiveRateLimits}), enforcing global cooldown`
      );

      // The processQueue method will handle the actual cooldown
      // We just return a value to indicate we're at the retry limit
      return this.maxRetries;
    }

    // If we've exceeded max retries, give up
    if (retryCount >= this.maxRetries) {
      logger.error(
        `${this.logPrefix} Exceeded maximum retries (${this.maxRetries}) for ${identifier}`
      );
      return retryCount;
    }

    // Calculate backoff time using exponential backoff
    const baseWaitTime = 3000; // 3 seconds base wait time
    const jitter = Math.floor(Math.random() * 500);

    // Use retry-after header if provided, otherwise use exponential backoff
    const waitTime = retryAfter
      ? retryAfter * 1000
      : baseWaitTime * Math.pow(2, retryCount) + jitter;

    logger.warn(
      `${this.logPrefix} Rate limited for ${identifier}, retry ${retryCount + 1}/${this.maxRetries} after ${waitTime}ms. Consecutive rate limits: ${this.consecutiveRateLimits}`
    );

    // Wait for the backoff period
    await this.delay(waitTime);

    // Return updated retry count
    return retryCount + 1;
  }

  /**
   * Resets the consecutive rate limit counter when a successful request is made
   */
  recordSuccess() {
    if (this.consecutiveRateLimits > 0) {
      logger.debug(
        `${this.logPrefix} Resetting consecutive rate limit counter after successful request`
      );
      this.consecutiveRateLimits = 0;
    }
  }
  /**
   * Gets the context for the currently executing request
   * @returns {Object|null} The context object or null if no request is executing
   */
  getCurrentRequestContext() {
    return this.currentRequestContext;
  }
}

module.exports = RateLimiter;
