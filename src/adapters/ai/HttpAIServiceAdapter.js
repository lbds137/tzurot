const { AIService } = require('../../domain/ai');
const { 
  AIRequest,
  AIContent,
  AIModel,
  AIRequestId
} = require('../../domain/ai');
const logger = require('../../logger');
const nodeFetch = require('node-fetch');

/**
 * HttpAIServiceAdapter - HTTP-based implementation of AIService
 * 
 * This adapter provides a generic HTTP interface to external AI services.
 * It transforms domain requests into HTTP API calls and converts responses
 * back to domain models. The adapter is provider-agnostic and can work
 * with any HTTP-based AI API by configuration.
 * 
 * @implements {AIService}
 */
class HttpAIServiceAdapter extends AIService {
  /**
   * @param {Object} config
   * @param {string} config.baseUrl - Base URL of the AI service
   * @param {Object} config.headers - Default headers for requests
   * @param {number} config.timeout - Request timeout in ms
   * @param {number} config.maxRetries - Maximum retry attempts
   * @param {number} config.retryDelay - Initial retry delay in ms
   * @param {Function} config.transformRequest - Transform domain request to API format
   * @param {Function} config.transformResponse - Transform API response to domain format
   */
  constructor(config = {}) {
    super();
    
    this.baseUrl = config.baseUrl || process.env.AI_SERVICE_URL;
    this.headers = config.headers || {};
    this.timeout = config.timeout || 30000; // 30 seconds
    this.maxRetries = config.maxRetries || 3;
    this.retryDelay = config.retryDelay || 1000;
    
    // Transformation functions for Anti-Corruption Layer
    this.transformRequest = config.transformRequest || this._defaultRequestTransform;
    this.transformResponse = config.transformResponse || this._defaultResponseTransform;
    
    // HTTP client function (injectable for testing)
    this.fetch = config.fetch || nodeFetch;
    
    // Request statistics
    this._requestCount = 0;
    this._errorCount = 0;
    this._lastHealthCheck = false;
  }

  /**
   * Send a request to the AI service
   * @param {AIRequest} request - Domain request object
   * @returns {Promise<AIContent>} AI-generated content
   */
  async generateContent(request) {
    if (!(request instanceof AIRequest)) {
      throw new Error('Invalid AIRequest object');
    }
    
    const requestId = request.requestId.toString();
    logger.debug(`[HttpAIServiceAdapter] Processing request: ${requestId}`);
    
    try {
      // Transform domain request to API format
      const apiRequest = await this.transformRequest(request);
      
      // Default headers
      const headers = { ...this.headers };
      
      // Make HTTP request with retries
      const response = await this._makeRequestWithRetry(
        apiRequest.endpoint || '/generate',
        apiRequest.payload,
        headers,
        requestId
      );
      
      // Transform API response to domain format
      const content = await this.transformResponse(response.data, request);
      
      if (!(content instanceof AIContent)) {
        throw new Error('Response transformation did not produce valid AIContent');
      }
      
      logger.info(`[HttpAIServiceAdapter] Successfully processed request: ${requestId}`);
      return content;
      
    } catch (error) {
      logger.error(`[HttpAIServiceAdapter] Failed to process request ${requestId}:`, error);
      throw this._transformError(error, requestId);
    }
  }

  /**
   * Check if the AI service is available
   * @returns {Promise<boolean>} Service availability
   */
  async checkHealth() {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      
      const response = await this.fetch(`${this.baseUrl}/health`, {
        method: 'GET',
        headers: this.headers,
        signal: controller.signal
      });
      
      clearTimeout(timeout);
      this._lastHealthCheck = response.status === 200;
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
        logger.debug(`[HttpAIServiceAdapter] Attempt ${attempt}/${this.maxRetries} for request ${requestId}`);
        
        // Create timeout controller
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.timeout);
        
        // Make request
        const response = await this.fetch(`${this.baseUrl}${endpoint}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...this.headers,
            ...headers
          },
          body: JSON.stringify(payload),
          signal: controller.signal
        });
        
        clearTimeout(timeout);
        
        // Check response status
        if (!response.ok) {
          const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
          error.response = {
            status: response.status,
            statusText: response.statusText,
            data: await response.text()
          };
          
          // Try to parse JSON error
          try {
            error.response.data = JSON.parse(error.response.data);
          } catch {} // Ignore parse errors
          
          throw error;
        }
        
        // Parse response
        const data = await response.json();
        
        // Validate response
        if (!data) {
          throw new Error('Empty response from AI service');
        }
        
        this._requestCount++;
        return { data, status: response.status };
        
      } catch (error) {
        this._errorCount++;
        lastError = error;
        
        // Handle abort errors
        if (error.name === 'AbortError') {
          lastError = new Error('Request timeout');
          lastError.code = 'ECONNABORTED';
        }
        
        // Don't retry on client errors (4xx)
        if (error.response && error.response.status >= 400 && error.response.status < 500) {
          throw error;
        }
        
        // Check if we should retry
        if (attempt < this.maxRetries) {
          const delay = this.retryDelay * Math.pow(2, attempt - 1); // Exponential backoff
          logger.warn(`[HttpAIServiceAdapter] Request ${requestId} failed, retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    throw lastError;
  }

  /**
   * Default request transformation
   * @private
   */
  _defaultRequestTransform(request) {
    // Extract data from domain model
    const requestData = request.toJSON();
    
    // Transform content items to messages format
    const messages = [];
    
    // Add user message from content
    if (requestData.content && requestData.content.length > 0) {
      const userMessage = {
        role: 'user',
        content: []
      };
      
      // Process each content item
      for (const item of requestData.content) {
        if (item.type === 'text') {
          userMessage.content.push({
            type: 'text',
            text: item.text
          });
        } else if (item.type === 'image_url') {
          userMessage.content.push({
            type: 'image',
            url: item.image_url.url
          });
        } else if (item.type === 'audio_url') {
          userMessage.content.push({
            type: 'audio',
            url: item.audio_url.url
          });
        }
      }
      
      messages.push(userMessage);
    }
    
    // Add referenced content if present
    if (requestData.referencedContent && requestData.referencedContent.length > 0) {
      const assistantMessage = {
        role: 'assistant',
        content: []
      };
      
      for (const item of requestData.referencedContent) {
        if (item.type === 'text') {
          assistantMessage.content.push({
            type: 'text',
            text: item.text
          });
        }
      }
      
      messages.push(assistantMessage);
    }
    
    // Default transformation for a generic AI API
    return {
      endpoint: '/generate',
      payload: {
        model: requestData.model.path,
        messages: messages,
        parameters: {
          temperature: requestData.model.capabilities.temperature,
          maxTokens: requestData.model.capabilities.maxTokens,
        },
        context: {
          personality: requestData.personalityId,
          user: requestData.userId,
          requestId: requestData.requestId
        }
      }
    };
  }

  /**
   * Default response transformation
   * @private
   */
  async _defaultResponseTransform(apiResponse, originalRequest) {
    // Handle various response formats
    let text = '';
    const contentItems = [];
    
    if (typeof apiResponse === 'string') {
      text = apiResponse;
    } else if (apiResponse.content) {
      text = apiResponse.content;
    } else if (apiResponse.message) {
      text = apiResponse.message;
    } else if (apiResponse.text) {
      text = apiResponse.text;
    } else if (apiResponse.choices && apiResponse.choices[0]) {
      // OpenAI-style response
      const choice = apiResponse.choices[0];
      text = choice.message?.content || choice.text || '';
    }
    
    // Add text content
    if (text) {
      contentItems.push({
        type: 'text',
        text: text.trim()
      });
    }
    
    // Extract media if present
    if (apiResponse.media || apiResponse.attachments) {
      const media = apiResponse.media || apiResponse.attachments;
      if (Array.isArray(media) && media.length > 0) {
        for (const item of media) {
          if (item.type === 'image' && item.url) {
            contentItems.push({
              type: 'image_url',
              image_url: { url: item.url }
            });
          } else if (item.type === 'audio' && item.url) {
            contentItems.push({
              type: 'audio_url',
              audio_url: { url: item.url }
            });
          }
        }
      }
    }
    
    // Create AIContent from items array
    return new AIContent(contentItems);
  }

  /**
   * Transform errors to domain-friendly format
   * @private
   */
  _transformError(error) {
    if (error.response) {
      // API returned an error response
      const status = error.response.status;
      const data = error.response.data;
      
      if (status === 401) {
        return new Error('Authentication required');
      } else if (status === 403) {
        return new Error('Access forbidden');
      } else if (status === 429) {
        return new Error('Rate limit exceeded');
      } else if (status >= 500) {
        return new Error('AI service temporarily unavailable');
      }
      
      // Try to extract error message from response
      const message = data?.error?.message || data?.message || data?.error || 'AI service error';
      return new Error(message);
    }
    
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      return new Error('AI service request timeout');
    }
    
    if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      return new Error('AI service unreachable');
    }
    
    // Return original error if we can't transform it
    return error;
  }


  /**
   * Get adapter statistics
   * @returns {Object} Adapter statistics
   */
  getStats() {
    return {
      baseUrl: this.baseUrl,
      timeout: this.timeout,
      maxRetries: this.maxRetries,
      healthy: this._lastHealthCheck || false,
      requestCount: this._requestCount || 0,
      errorCount: this._errorCount || 0,
    };
  }
}

module.exports = { HttpAIServiceAdapter };