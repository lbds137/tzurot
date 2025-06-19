const { AIService } = require('../../domain/ai');
const { AIRequest, AIContent } = require('../../domain/ai');
const { AIRequestDeduplicator } = require('../../domain/ai/AIRequestDeduplicator');
const logger = require('../../logger');
const nodeFetch = require('node-fetch');

// Default delay function for timer operations
// This follows the approved pattern from TIMER_PATTERNS_COMPLETE.md
// Can be overridden via config.delay for testing
const defaultDelay = ms => {
  const timer = globalThis.setTimeout || setTimeout;
  return new Promise(resolve => timer(resolve, ms));
};

/**
 * HTTP-based implementation of AIService
 * Uses HTTP/REST API to communicate with AI providers
 *
 * Features:
 * - Configurable base URL and headers
 * - Automatic retry with exponential backoff
 * - Request/Response transformation hooks
 * - Health check support
 * - Request statistics
 *
 * @implements {AIService}
 */
class HttpAIServiceAdapter extends AIService {
  /**
   * @param {Object} config - Adapter configuration
   * @param {string} [config.baseUrl] - Base URL for the AI service
   * @param {Object} [config.headers] - Default headers to include
   * @param {number} [config.timeout] - Request timeout in milliseconds
   * @param {number} [config.maxRetries] - Maximum retry attempts
   * @param {number} [config.retryDelay] - Initial retry delay in milliseconds
   * @param {Function} [config.transformRequest] - Request transformation function
   * @param {Function} [config.transformResponse] - Response transformation function
   * @param {Function} [config.fetch] - HTTP client function (for testing)
   * @param {Function} [config.delay] - Delay function (for testing)
   */
  constructor(config = {}) {
    super();

    this.baseUrl = config.baseUrl || process.env.SERVICE_API_BASE_URL;
    this.headers = config.headers || {};
    this.timeout = config.timeout || 30000;
    this.maxRetries = config.maxRetries || 3;
    this.retryDelay = config.retryDelay || 1000;

    // Transformation functions for Anti-Corruption Layer
    this.transformRequest = config.transformRequest || this._defaultRequestTransform;
    this.transformResponse = config.transformResponse || this._defaultResponseTransform;

    // HTTP client function (injectable for testing)
    this.fetch = config.fetch || nodeFetch;

    // Injectable delay function for testing
    this.delay = config.delay || defaultDelay;

    // Initialize timer functions for injection
    const timerFunctions = {
      setTimeout: config.delay
        ? (fn, ms) => config.delay(ms).then(fn)
        : globalThis.setTimeout || setTimeout,
      clearTimeout: globalThis.clearTimeout || clearTimeout,
      setInterval: globalThis.setInterval || setInterval,
      clearInterval: globalThis.clearInterval || clearInterval,
      now: () => Date.now(),
    };

    // Initialize deduplicator
    this.deduplicator = new AIRequestDeduplicator({
      timers: timerFunctions,
      requestTTL: 30000, // 30 seconds
      errorBlackoutDuration: 60000, // 1 minute
    });

    // Request statistics
    this._requestCount = 0;
    this._errorCount = 0;
    this._lastHealthCheck = null;

    // Validate configuration
    if (!this.baseUrl) {
      throw new Error('AI service base URL is required');
    }
  }

  /**
   * Send a request to the AI service
   * @param {AIRequest} request - The request to send
   * @returns {Promise<AIContent>} The AI response
   * @throws {Error} If the request fails
   */
  async sendRequest(request) {
    if (!(request instanceof AIRequest)) {
      throw new Error('Request must be an instance of AIRequest');
    }

    const requestId = request.id.value;

    // Extract request details for deduplication
    const personalityName = request.personality || 'default';
    const content = request.prompt || '';
    const context = {
      userAuth: request.userId || null,
      conversationId: request.conversationId || null,
    };

    // Check for duplicate request
    const existingPromise = await this.deduplicator.checkDuplicate(
      personalityName,
      content,
      context
    );
    if (existingPromise) {
      logger.info(
        `[HttpAIServiceAdapter] Returning existing promise for duplicate request ${requestId}`
      );
      return existingPromise;
    }

    // Create the request promise
    const requestPromise = this._executeRequest(request, requestId);

    // Register as pending to prevent duplicates
    this.deduplicator.registerPending(personalityName, content, context, requestPromise);

    // Handle errors for blackout periods
    requestPromise.catch(error => {
      if (error.code === 'RATE_LIMIT' || error.code === 'SERVICE_ERROR' || error.status === 500) {
        this.deduplicator.markFailed(personalityName, content, context);
      }
    });

    return requestPromise;
  }

  /**
   * Execute the actual request (extracted for deduplication)
   * @private
   */
  async _executeRequest(request, requestId) {
    try {
      logger.info(`[HttpAIServiceAdapter] Sending request ${requestId}`);
      this._requestCount++;

      // Transform domain request to API format
      const { endpoint, payload, headers = {} } = await this.transformRequest(request);

      // Make HTTP request with retry
      const apiResponse = await this._makeRequestWithRetry(endpoint, payload, headers, requestId);

      // Transform API response to domain format
      const content = await this.transformResponse(apiResponse);

      if (!(content instanceof AIContent)) {
        throw new Error('Transform response must return an AIContent instance');
      }

      logger.info(`[HttpAIServiceAdapter] Request ${requestId} completed successfully`);
      return content;
    } catch (error) {
      this._errorCount++;
      logger.error(`[HttpAIServiceAdapter] Request ${requestId} failed:`, error);
      throw this._transformError(error);
    }
  }

  /**
   * Check if the AI service is available
   * @returns {Promise<boolean>} Service availability
   */
  async checkHealth() {
    try {
      const controller = new AbortController();

      // Create a promise that rejects after timeout
      const timeoutPromise = this.delay(5000).then(() => {
        controller.abort();
        throw new Error('Health check timed out');
      });

      const fetchPromise = this.fetch(`${this.baseUrl}/health`, {
        method: 'GET',
        headers: this.headers,
        signal: controller.signal,
      });

      // Race between fetch and timeout
      const response = await Promise.race([fetchPromise, timeoutPromise]);

      this._lastHealthCheck = response && response.status === 200;
      return this._lastHealthCheck;
    } catch (error) {
      logger.warn('[HttpAIServiceAdapter] Health check failed:', error.message);
      this._lastHealthCheck = false;
      return false;
    }
  }

  /**
   * Make HTTP request with retry logic
   * @private
   */
  async _makeRequestWithRetry(endpoint, payload, headers, requestId) {
    let lastError;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        logger.debug(
          `[HttpAIServiceAdapter] Attempt ${attempt}/${this.maxRetries} for request ${requestId}`
        );

        // Create timeout controller
        const controller = new AbortController();

        // Create a promise that rejects after timeout
        const timeoutPromise = this.delay(this.timeout).then(() => {
          controller.abort();
          throw new Error(`Request timed out after ${this.timeout}ms`);
        });

        // Make request
        const fetchPromise = this.fetch(`${this.baseUrl}${endpoint}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...this.headers,
            ...headers,
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        // Race between fetch and timeout
        const response = await Promise.race([fetchPromise, timeoutPromise]);

        // Check response status
        if (!response.ok) {
          const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
          error.response = {
            status: response.status,
            statusText: response.statusText,
            data: await response.text(),
          };

          // Try to parse JSON error
          try {
            error.response.data = JSON.parse(error.response.data);
          } catch {
            // Ignore parse errors, keep original string
          }

          throw error;
        }

        // Parse response
        const data = await response.json();

        // Validate response
        if (!data) {
          throw new Error('Empty response from AI service');
        }

        return data;
      } catch (error) {
        lastError = error;

        // Don't retry on client errors (4xx)
        if (error.response && error.response.status >= 400 && error.response.status < 500) {
          throw error;
        }

        // Don't retry on last attempt
        if (attempt === this.maxRetries) {
          throw error;
        }

        // Calculate exponential backoff
        const delay = this.retryDelay * Math.pow(2, attempt - 1);
        logger.warn(
          `[HttpAIServiceAdapter] Request ${requestId} attempt ${attempt} failed, retrying in ${delay}ms...`
        );

        await this.delay(delay);
      }
    }

    throw lastError;
  }

  /**
   * Default request transformation
   * Override this or provide transformRequest in config for provider-specific formats
   * @private
   */
  _defaultRequestTransform(request) {
    // Extract data from domain objects
    const requestData = request.toJSON();

    // Build messages array (common format)
    const messages = [];

    // Add personality as system message if present
    if (requestData.personalityId) {
      messages.push({
        role: 'system',
        content: `You are personality ${requestData.personalityId}.`,
      });
    }

    // Convert content items to messages
    if (requestData.content && requestData.content.length > 0) {
      for (const item of requestData.content) {
        if (item.type === 'text') {
          messages.push({
            role: 'user',
            content: item.text,
          });
        } else if (item.type === 'image') {
          // Handle image content
          messages.push({
            role: 'user',
            content: [{ type: 'image_url', image_url: { url: item.url } }],
          });
        } else if (item.type === 'audio') {
          // Handle audio content - provider specific
          logger.warn('[HttpAIServiceAdapter] Audio content not supported in default transform');
        }
      }
    }

    // Build generic request format
    return {
      endpoint: '/v1/chat/completions', // Common endpoint
      payload: {
        model: requestData.model.path || 'default-model',
        messages,
        temperature: requestData.model.capabilities.temperature,
        max_tokens: requestData.model.capabilities.maxTokens,
        user: requestData.userId,
        metadata: {
          requestId: requestData.id,
          conversationId: requestData.conversationId,
        },
      },
      headers: {},
    };
  }

  /**
   * Default response transformation
   * Override this or provide transformResponse in config for provider-specific formats
   * @private
   */
  async _defaultResponseTransform(apiResponse) {
    // Handle common response formats
    let content = '';
    // Metadata is extracted but not currently used in AIContent
    // Could be extended in future to include model info
    // let metadata = {};

    // OpenAI-style format
    if (apiResponse.choices && Array.isArray(apiResponse.choices)) {
      const choice = apiResponse.choices[0];
      content = choice.message?.content || choice.text || '';
      // metadata = {
      //   finishReason: choice.finish_reason,
      //   usage: apiResponse.usage,
      //   model: apiResponse.model,
      // };
    }
    // Anthropic-style format
    else if (apiResponse.content && Array.isArray(apiResponse.content)) {
      const textBlocks = apiResponse.content.filter(block => block.type === 'text');
      content = textBlocks.map(block => block.text).join('\n');
      // metadata = {
      //   id: apiResponse.id,
      //   model: apiResponse.model,
      //   stopReason: apiResponse.stop_reason,
      //   usage: apiResponse.usage,
      // };
    }
    // Simple format
    else if (apiResponse.text || apiResponse.response || apiResponse.message) {
      content = apiResponse.text || apiResponse.response || apiResponse.message;
      // metadata = apiResponse.metadata || {};
    }
    // Content field format (common in simple APIs)
    else if (apiResponse.content && typeof apiResponse.content === 'string') {
      content = apiResponse.content;
      // metadata = apiResponse.metadata || {};
    }
    // Direct string response
    else if (typeof apiResponse === 'string') {
      content = apiResponse;
    } else {
      throw new Error('Unsupported response format');
    }

    // Create AIContent with items array
    return new AIContent([{ type: 'text', text: content }]);
  }

  /**
   * Transform errors to domain-specific exceptions
   * @private
   */
  _transformError(error) {
    // Network errors
    if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
      const err = new Error('AI service is unavailable');
      err.code = 'SERVICE_UNAVAILABLE';
      err.original = error;
      return err;
    }

    // Timeout errors
    if (error.name === 'AbortError' || error.message.includes('timed out')) {
      const err = new Error('AI service request timed out');
      err.code = 'REQUEST_TIMEOUT';
      err.original = error;
      return err;
    }

    // HTTP errors
    if (error.response) {
      const status = error.response.status;
      const data = error.response.data;

      // Rate limiting
      if (status === 429) {
        const err = new Error('AI service rate limit exceeded');
        err.code = 'RATE_LIMIT_EXCEEDED';
        err.retryAfter = data?.retry_after;
        err.original = error;
        return err;
      }

      // Authentication
      if (status === 401 || status === 403) {
        const err = new Error('AI service authentication failed');
        err.code = 'AUTH_FAILED';
        err.original = error;
        return err;
      }

      // Bad request
      if (status === 400) {
        const err = new Error(data?.error?.message || 'Invalid request to AI service');
        err.code = 'INVALID_REQUEST';
        err.details = data?.error;
        err.original = error;
        return err;
      }

      // Server errors
      if (status >= 500) {
        const err = new Error('AI service internal error');
        err.code = 'INTERNAL_ERROR';
        err.original = error;
        return err;
      }
    }

    // Default
    return error;
  }

  /**
   * Get adapter statistics
   * @returns {Object} Statistics about the adapter
   */
  getStats() {
    return {
      baseUrl: this.baseUrl,
      timeout: this.timeout,
      maxRetries: this.maxRetries,
      healthy: this._lastHealthCheck,
      requestCount: this._requestCount,
      errorCount: this._errorCount,
      errorRate: this._requestCount > 0 ? this._errorCount / this._requestCount : 0,
    };
  }
}

module.exports = { HttpAIServiceAdapter };
