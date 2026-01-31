/**
 * API Mocking Utilities for Testing
 * This file provides mock implementations of external API calls to facilitate testing.
 */

/**
 * Create a mock AI API client
 * This simulates responses from an AI service like OpenAI
 */
class MockAIClient {
  constructor(options = {}) {
    this.options = {
      shouldError: false,
      errorRate: 0.1, // 10% chance of error by default
      responseDelay: 50, // Simulate network delay (milliseconds)
      ...options,
    };

    this.problemProfiles = new Set([
      'problematic-personality',
      'error-prone-personality',
      'rate-limited-personality',
    ]);

    this.requestHistory = [];
  }

  /**
   * Mock function to create a chat completion
   * @param {Object} params - Chat completion parameters
   * @returns {Promise<Object>} Chat completion response
   */
  async createChatCompletion(params) {
    // Record the request for test assertions
    this.requestHistory.push({
      timestamp: Date.now(),
      params,
      type: 'chat',
    });

    // Simulate network delay
    if (this.options.responseDelay > 0) {
      await new Promise(resolve => setTimeout(resolve, this.options.responseDelay));
    }

    // Check if we should return an error
    if (this.options.shouldError || Math.random() < this.options.errorRate) {
      throw this._createRandomError();
    }

    // If the personality is in the problem list, return an error sometimes
    const personality = this._extractPersonalityFromParams(params);
    if (this.problemProfiles.has(personality) && Math.random() < 0.7) {
      throw this._createErrorForPersonality(personality);
    }

    // Return a successful response
    return {
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: params.model || 'gpt-3.5-turbo',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: this._generateResponseContent(params),
          },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens:
          params.messages.reduce((sum, msg) => sum + (msg.content?.length || 0), 0) / 4,
        completion_tokens: 200,
        total_tokens:
          params.messages.reduce((sum, msg) => sum + (msg.content?.length || 0), 0) / 4 + 200,
      },
    };
  }

  /**
   * Mock function to create a completion
   * @param {Object} params - Completion parameters
   * @returns {Promise<Object>} Completion response
   */
  async createCompletion(params) {
    // Record the request for test assertions
    this.requestHistory.push({
      timestamp: Date.now(),
      params,
      type: 'completion',
    });

    // Simulate network delay
    if (this.options.responseDelay > 0) {
      await new Promise(resolve => setTimeout(resolve, this.options.responseDelay));
    }

    // Check if we should return an error
    if (this.options.shouldError || Math.random() < this.options.errorRate) {
      throw this._createRandomError();
    }

    // Return a successful response
    return {
      id: `cmpl-${Date.now()}`,
      object: 'text_completion',
      created: Math.floor(Date.now() / 1000),
      model: params.model || 'text-davinci-003',
      choices: [
        {
          text: this._generateResponseContent(params),
          index: 0,
          logprobs: null,
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: (params.prompt?.length || 0) / 4,
        completion_tokens: 200,
        total_tokens: (params.prompt?.length || 0) / 4 + 200,
      },
    };
  }

  /**
   * Clear request history
   */
  clearHistory() {
    this.requestHistory = [];
  }

  /**
   * Set whether requests should error
   * @param {boolean} shouldError - Whether requests should error
   */
  setShouldError(shouldError) {
    this.options.shouldError = shouldError;
  }

  /**
   * Add a problematic personality
   * @param {string} personalityName - Name of the problematic personality
   */
  addProblematicPersonality(personalityName) {
    this.problemProfiles.add(personalityName);
  }

  /**
   * Extract personality name from params
   * @param {Object} params - Request parameters
   * @returns {string|null} Personality name or null
   * @private
   */
  _extractPersonalityFromParams(params) {
    // Try to extract from system message
    if (params.messages && Array.isArray(params.messages)) {
      for (const msg of params.messages) {
        if (msg.role === 'system' && msg.content) {
          const match = msg.content.match(/personality:\s*([a-zA-Z0-9-]+)/i);
          if (match && match[1]) {
            return match[1].toLowerCase();
          }
        }
      }
    }

    // Try to extract from prompt
    if (params.prompt) {
      const match = params.prompt.match(/personality:\s*([a-zA-Z0-9-]+)/i);
      if (match && match[1]) {
        return match[1].toLowerCase();
      }
    }

    return null;
  }

  /**
   * Generate a mock response
   * @param {Object} params - Request parameters
   * @returns {string} Generated response
   * @private
   */
  _generateResponseContent(params) {
    // Extract personality from params
    const personality = this._extractPersonalityFromParams(params);

    if (personality) {
      return `This is a mock response from the AI for personality: ${personality}. I am responding to your message about ${this._extractTopic(params)}.`;
    }

    return `This is a mock response from the AI. I am responding to your message about ${this._extractTopic(params)}.`;
  }

  /**
   * Extract topic from params
   * @param {Object} params - Request parameters
   * @returns {string} Extracted topic
   * @private
   */
  _extractTopic(params) {
    if (params.messages && Array.isArray(params.messages)) {
      // Find the last user message
      for (let i = params.messages.length - 1; i >= 0; i--) {
        if (params.messages[i].role === 'user' && params.messages[i].content) {
          // Extract first 3 words
          const words = params.messages[i].content.split(' ').slice(0, 3).join(' ');
          return words || 'unknown topic';
        }
      }
    }

    if (params.prompt) {
      // Extract first 3 words
      const words = params.prompt.split(' ').slice(0, 3).join(' ');
      return words || 'unknown topic';
    }

    return 'unknown topic';
  }

  /**
   * Create a random error
   * @returns {Error} Random error
   * @private
   */
  _createRandomError() {
    const errors = [
      { message: 'Rate limit exceeded', code: 429 },
      { message: 'The server is overloaded', code: 503 },
      { message: 'Internal server error', code: 500 },
      { message: 'Bad gateway', code: 502 },
      { message: 'Gateway timeout', code: 504 },
      { message: 'Service unavailable', code: 503 },
    ];

    const randomError = errors[Math.floor(Math.random() * errors.length)];
    const error = new Error(randomError.message);
    error.status = randomError.code;
    error.statusCode = randomError.code;
    error.code = randomError.code;

    return error;
  }

  /**
   * Create an error for a specific personality
   * @param {string} personality - Personality name
   * @returns {Error} Personality-specific error
   * @private
   */
  _createErrorForPersonality(personality) {
    const error = new Error(`Error processing request for personality: ${personality}`);

    if (personality === 'rate-limited-personality') {
      error.status = 429;
      error.statusCode = 429;
      error.code = 429;
      error.message = 'Rate limit exceeded for this personality';
    } else if (personality === 'error-prone-personality') {
      error.status = 500;
      error.statusCode = 500;
      error.code = 500;
      error.message = 'Internal server error processing this personality';
    } else {
      error.status = 400;
      error.statusCode = 400;
      error.code = 400;
      error.message = 'Bad request: This personality is problematic';
    }

    return error;
  }
}

/**
 * Create a mock fetch function for API calls
 * @param {Object} options - Options for the mock fetch
 * @returns {Function} Mock fetch function
 */
function createMockFetch(options = {}) {
  const defaults = {
    responses: new Map(),
    statusCodes: new Map(),
    shouldThrow: new Map(),
    defaultResponse: { success: true, message: 'Mock response' },
  };

  const settings = { ...defaults, ...options };

  return jest.fn().mockImplementation(async (url, requestOptions = {}) => {
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 50));

    // Check if this URL should throw an error
    if (settings.shouldThrow.has(url)) {
      throw new Error(`Network error for URL: ${url}`);
    }

    // Get the status code for this URL
    const status = settings.statusCodes.get(url) || 200;

    // Get the response for this URL
    let responseData;
    if (settings.responses.has(url)) {
      responseData = settings.responses.get(url);
    } else {
      // Try to match by URL pattern (start with)
      const matchingUrl = Array.from(settings.responses.keys()).find(key => url.startsWith(key));

      if (matchingUrl) {
        responseData = settings.responses.get(matchingUrl);
      } else {
        responseData = settings.defaultResponse;
      }
    }

    // Create a mock Response object
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => responseData,
      text: async () =>
        typeof responseData === 'string' ? responseData : JSON.stringify(responseData),
      blob: async () =>
        new Blob([typeof responseData === 'string' ? responseData : JSON.stringify(responseData)]),
      buffer: async () =>
        Buffer.from(typeof responseData === 'string' ? responseData : JSON.stringify(responseData)),
      headers: new Map([['content-type', 'application/json']]),
    };
  });
}

/**
 * Set up mock response for a URL
 * @param {Function} mockFetch - Mock fetch function
 * @param {string} url - URL to mock
 * @param {*} response - Response data
 * @param {number} status - HTTP status code
 */
function setMockResponse(mockFetch, url, response, status = 200) {
  mockFetch.mock.responses.set(url, response);
  mockFetch.mock.statusCodes.set(url, status);
}

/**
 * Set a URL to throw an error
 * @param {Function} mockFetch - Mock fetch function
 * @param {string} url - URL to throw error for
 * @param {boolean} shouldThrow - Whether it should throw
 */
function setMockThrow(mockFetch, url, shouldThrow = true) {
  mockFetch.mock.shouldThrow.set(url, shouldThrow);
}

/**
 * Create mock OpenAI configuration for testing
 * @returns {Object} Mock OpenAI configuration
 */
function createMockOpenAI() {
  const mockAIClient = new MockAIClient();

  return {
    OpenAIApi: jest.fn().mockImplementation(() => mockAIClient),
    Configuration: jest.fn().mockImplementation(() => ({
      apiKey: 'mock-api-key',
      organization: 'mock-org',
    })),
    _mockClient: mockAIClient,
  };
}

module.exports = {
  MockAIClient,
  createMockFetch,
  setMockResponse,
  setMockThrow,
  createMockOpenAI,
};
