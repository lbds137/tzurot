const { HttpAIServiceAdapter } = require('./HttpAIServiceAdapter');
const { AIContent } = require('../../domain/ai');
const logger = require('../../logger');

/**
 * AIServiceAdapterFactory - Factory for creating AI service adapters
 *
 * This factory provides pre-configured adapters for common AI providers
 * while maintaining provider-agnostic interfaces. New providers can be
 * added without changing existing code.
 */
class AIServiceAdapterFactory {
  /**
   * Create an AI service adapter based on configuration
   * @param {Object} config
   * @param {string} config.provider - Provider type (generic, openai-compatible, etc.)
   * @param {string} config.baseUrl - Base URL of the AI service
   * @param {string} config.apiKey - API key for authentication
   * @param {Object} config.options - Additional provider-specific options
   * @returns {HttpAIServiceAdapter} Configured adapter
   */
  static create(config = {}) {
    const { provider = 'generic', baseUrl, apiKey, options = {} } = config;

    logger.info(`[AIServiceAdapterFactory] Creating adapter for provider: ${provider}`);

    switch (provider) {
      case 'openai-compatible':
        return this._createOpenAICompatible(baseUrl, apiKey, options);

      case 'anthropic-compatible':
        return this._createAnthropicCompatible(baseUrl, apiKey, options);

      case 'generic':
      default:
        return this._createGeneric(baseUrl, apiKey, options);
    }
  }

  /**
   * Create a generic HTTP adapter
   * @private
   */
  static _createGeneric(baseUrl, apiKey, options) {
    if (!baseUrl) {
      throw new Error('baseUrl is required for generic provider');
    }

    return new HttpAIServiceAdapter({
      baseUrl,
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      timeout: options.timeout || 30000,
      maxRetries: options.maxRetries || 3,
      retryDelay: options.retryDelay || 1000,
      ...options,
    });
  }

  /**
   * Create an OpenAI-compatible adapter
   * @private
   */
  static _createOpenAICompatible(baseUrl, apiKey, options) {
    if (!baseUrl || !apiKey) {
      throw new Error('baseUrl and apiKey are required for OpenAI-compatible provider');
    }

    return new HttpAIServiceAdapter({
      baseUrl,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'OpenAI-Beta': 'assistants=v1',
      },
      timeout: options.timeout || 60000,
      maxRetries: options.maxRetries || 3,
      retryDelay: options.retryDelay || 1000,

      // OpenAI-specific request transformation
      transformRequest: this._createOpenAIRequestTransform(options),

      // OpenAI-specific response transformation
      transformResponse: this._createOpenAIResponseTransform(),

      ...options,
    });
  }

  /**
   * Create an Anthropic-compatible adapter
   * @private
   */
  static _createAnthropicCompatible(baseUrl, apiKey, options) {
    if (!baseUrl || !apiKey) {
      throw new Error('baseUrl and apiKey are required for Anthropic-compatible provider');
    }

    return new HttpAIServiceAdapter({
      baseUrl,
      headers: {
        'X-API-Key': apiKey,
        'Anthropic-Version': options.version || '2023-06-01',
      },
      timeout: options.timeout || 60000,
      maxRetries: options.maxRetries || 3,
      retryDelay: options.retryDelay || 1000,

      // Anthropic-specific request transformation
      transformRequest: this._createAnthropicRequestTransform(options),

      // Anthropic-specific response transformation
      transformResponse: this._createAnthropicResponseTransform(),

      ...options,
    });
  }

  /**
   * Create adapter from environment variables
   * @returns {HttpAIServiceAdapter} Configured adapter
   */
  static createFromEnv() {
    const provider = process.env.AI_PROVIDER || 'generic';
    const baseUrl = process.env.AI_SERVICE_URL;
    const apiKey = process.env.AI_API_KEY;

    if (!baseUrl) {
      throw new Error('AI_SERVICE_URL environment variable is required');
    }

    const options = {
      timeout: parseInt(process.env.AI_TIMEOUT) || 30000,
      maxRetries: parseInt(process.env.AI_MAX_RETRIES) || 3,
      defaultModel: process.env.AI_DEFAULT_MODEL,
    };

    return this.create({ provider, baseUrl, apiKey, options });
  }

  /**
   * Create OpenAI request transformation function
   * @private
   */
  static _createOpenAIRequestTransform(options) {
    return request => {
      const requestData = request.toJSON();
      const messages = [];

      // Add system message with personality
      if (requestData.personalityId) {
        messages.push({
          role: 'system',
          content: `You are personality ${requestData.personalityId}.`,
        });
      }

      // Convert content to messages
      if (requestData.content && requestData.content.length > 0) {
        const userContent = requestData.content
          .filter(item => item.type === 'text')
          .map(item => item.text)
          .join('\n');

        if (userContent) {
          messages.push({ role: 'user', content: userContent });
        }
      }

      return {
        endpoint: options.endpoint || '/v1/chat/completions',
        payload: {
          model: requestData.model.path || options.defaultModel || 'gpt-3.5-turbo',
          messages,
          temperature: requestData.model.capabilities.temperature,
          max_tokens: requestData.model.capabilities.maxTokens,
          user: requestData.userId,
        },
      };
    };
  }

  /**
   * Create OpenAI response transformation function
   * @private
   */
  static _createOpenAIResponseTransform() {
    return async apiResponse => {
      if (!apiResponse.choices || !apiResponse.choices[0]) {
        throw new Error('Invalid OpenAI response format');
      }

      const choice = apiResponse.choices[0];
      const content = choice.message?.content || '';

      // Return AIContent with array of items
      return new AIContent([{ type: 'text', text: content }]);
    };
  }

  /**
   * Create Anthropic request transformation function
   * @private
   */
  static _createAnthropicRequestTransform(options) {
    return request => {
      const requestData = request.toJSON();
      const messages = [];
      let system = '';

      // Build system prompt with personality
      if (requestData.personalityId) {
        system = `You are personality ${requestData.personalityId}.`;
      }

      // Convert content to messages
      if (requestData.content && requestData.content.length > 0) {
        const userContent = requestData.content
          .filter(item => item.type === 'text')
          .map(item => item.text)
          .join('\n');

        if (userContent) {
          messages.push({ role: 'user', content: userContent });
        }
      }

      return {
        endpoint: options.endpoint || '/v1/messages',
        payload: {
          model: requestData.model.path || options.defaultModel || 'claude-3-sonnet-20240229',
          messages,
          system,
          temperature: requestData.model.capabilities.temperature,
          max_tokens: requestData.model.capabilities.maxTokens || 1000,
          metadata: {
            user_id: requestData.userId,
          },
        },
      };
    };
  }

  /**
   * Create Anthropic response transformation function
   * @private
   */
  static _createAnthropicResponseTransform() {
    return async apiResponse => {
      if (!apiResponse.content || !Array.isArray(apiResponse.content)) {
        throw new Error('Invalid Anthropic response format');
      }

      // Extract text from content blocks
      const textBlocks = apiResponse.content.filter(block => block.type === 'text');
      const text = textBlocks.map(block => block.text).join('\n');

      // Return AIContent with array of items
      return new AIContent([{ type: 'text', text: text }]);
    };
  }
}

module.exports = { AIServiceAdapterFactory };
