/**
 * Consolidated API Mock Implementation
 * Combines fetch mocking, AI API mocking, and other external API mocks
 */

/**
 * Enhanced Mock Response class
 */
class MockResponse {
  constructor(options = {}) {
    this.ok = options.ok !== false;
    this.status = options.status || (this.ok ? 200 : 404);
    this.statusText = options.statusText || (this.ok ? 'OK' : 'Not Found');
    this.headers = new Map(Object.entries(options.headers || {}));
    this._data = options.data;
    this._arrayBuffer = options.arrayBuffer || null;
    this._text = options.text || null;
  }

  async json() {
    if (this._data === undefined) {
      throw new Error('Response body is not JSON');
    }
    return this._data;
  }

  async text() {
    if (this._text !== null) return this._text;
    if (this._data !== undefined) return JSON.stringify(this._data);
    return '';
  }

  async arrayBuffer() {
    if (this._arrayBuffer) return this._arrayBuffer;
    const text = await this.text();
    return new TextEncoder().encode(text).buffer;
  }

  async blob() {
    const arrayBuffer = await this.arrayBuffer();
    return new Blob([arrayBuffer]);
  }

  clone() {
    return new MockResponse({
      ok: this.ok,
      status: this.status,
      statusText: this.statusText,
      headers: Object.fromEntries(this.headers),
      data: this._data,
      arrayBuffer: this._arrayBuffer,
      text: this._text,
    });
  }
}

/**
 * Comprehensive Mock Fetch Implementation
 */
class MockFetch {
  constructor(options = {}) {
    this.responses = new Map();
    this.errors = new Map();
    this.delays = new Map();
    this.defaultDelay = options.defaultDelay || 0;
    this.requestHistory = [];

    // Bind the fetch function
    this.fetch = this.fetch.bind(this);
  }

  /**
   * Mock fetch implementation
   */
  async fetch(url, options = {}) {
    // Record the request
    this.requestHistory.push({
      url,
      options: { ...options },
      timestamp: Date.now(),
    });

    // Apply delay
    const delay = this.delays.get(url) || this.defaultDelay;
    if (delay > 0) {
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    // Check for errors
    if (this.errors.has(url)) {
      const error = this.errors.get(url);
      throw typeof error === 'function' ? error() : error;
    }

    // Find matching response
    let response = this.responses.get(url);
    if (!response) {
      // Try pattern matching
      for (const [pattern, resp] of this.responses.entries()) {
        if (url.includes(pattern) || new RegExp(pattern).test(url)) {
          response = resp;
          break;
        }
      }
    }

    // Generate response
    if (typeof response === 'function') {
      response = response(url, options);
    }

    if (!response) {
      // Default 404 response
      response = new MockResponse({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        data: { error: 'Not Found' },
      });
    }

    return response instanceof MockResponse ? response : new MockResponse(response);
  }

  /**
   * Set response for a URL or pattern
   */
  setResponse(urlOrPattern, response) {
    this.responses.set(urlOrPattern, response);
    return this;
  }

  /**
   * Set error for a URL or pattern
   */
  setError(urlOrPattern, error) {
    this.errors.set(urlOrPattern, error || new Error('Network error'));
    return this;
  }

  /**
   * Set delay for a URL or pattern
   */
  setDelay(urlOrPattern, delay) {
    this.delays.set(urlOrPattern, delay);
    return this;
  }

  /**
   * Clear all mocks
   */
  clear() {
    this.responses.clear();
    this.errors.clear();
    this.delays.clear();
    this.requestHistory = [];
    return this;
  }

  /**
   * Get request history
   */
  getRequestHistory() {
    return [...this.requestHistory];
  }
}

/**
 * Mock AI Service (OpenAI-style)
 */
class MockAIService {
  constructor(options = {}) {
    this.apiKey = options.apiKey || 'mock-api-key';
    this.baseURL = options.baseURL || 'https://api.openai.com/v1';
    this.requestHistory = [];
    this.shouldError = options.shouldError || false;
    this.errorRate = options.errorRate || 0;
    this.responseDelay = options.responseDelay || 50;
  }

  async createChatCompletion(params) {
    this.requestHistory.push({
      type: 'chat_completion',
      params: { ...params },
      timestamp: Date.now(),
    });

    // Simulate delay
    if (this.responseDelay > 0) {
      await new Promise(resolve => setTimeout(resolve, this.responseDelay));
    }

    // Check for errors
    if (this.shouldError || Math.random() < this.errorRate) {
      const error = new Error('AI API Error');
      error.status = 429;
      error.code = 'rate_limit_exceeded';
      throw error;
    }

    // Generate response
    const content = this._generateAIResponse(params);
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
            content,
          },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: this._countTokens(params.messages),
        completion_tokens: Math.floor(content.length / 4),
        total_tokens: this._countTokens(params.messages) + Math.floor(content.length / 4),
      },
    };
  }

  _generateAIResponse(params) {
    const personality = this._extractPersonality(params);
    const topic = this._extractTopic(params);

    if (personality) {
      return `[${personality}] This is a mock AI response about ${topic}.`;
    }
    return `This is a mock AI response about ${topic}.`;
  }

  _extractPersonality(params) {
    if (!params.messages) return null;

    for (const msg of params.messages) {
      if (msg.role === 'system' && msg.content) {
        const match = msg.content.match(/personality[:\s]+([^\s,]+)/i);
        if (match) return match[1];
      }
    }
    return null;
  }

  _extractTopic(params) {
    if (!params.messages) return 'unknown topic';

    const userMessage = params.messages.filter(m => m.role === 'user').pop();

    if (userMessage && userMessage.content) {
      return userMessage.content.split(' ').slice(0, 3).join(' ') || 'unknown topic';
    }

    return 'unknown topic';
  }

  _countTokens(messages) {
    if (!Array.isArray(messages)) return 0;
    return messages.reduce((sum, msg) => sum + (msg.content?.length || 0), 0) / 4;
  }

  setShouldError(shouldError) {
    this.shouldError = shouldError;
  }

  clearHistory() {
    this.requestHistory = [];
  }
}

/**
 * Profile Info Fetcher Mock (specialized for your app's profile API)
 */
class MockProfileService {
  constructor(options = {}) {
    this.defaultProfile = {
      id: '12345',
      name: 'Test Profile',
      ...options.defaultProfile,
    };
    this.profileResponses = new Map();
    this.shouldError = options.shouldError || false;
  }

  setProfileResponse(profileId, response) {
    this.profileResponses.set(profileId, response);
  }

  async fetchProfile(profileId) {
    if (this.shouldError) {
      throw new Error('Profile fetch error');
    }

    const response = this.profileResponses.get(profileId) || this.defaultProfile;
    return new MockResponse({
      ok: true,
      status: 200,
      data: response,
    });
  }
}

/**
 * Factory function to create API mock environment
 */
function createApiEnvironment(options = {}) {
  const fetch = new MockFetch(options.fetch);
  const ai = new MockAIService(options.ai);
  const profiles = new MockProfileService(options.profiles);

  // Set up default responses if requested
  if (options.setupDefaults !== false) {
    // Default profile API response
    fetch.setResponse('/api/profiles/', {
      ok: true,
      status: 200,
      data: profiles.defaultProfile,
    });

    // Default AI API responses
    fetch.setResponse('/v1/chat/completions', (url, opts) => {
      const body = JSON.parse(opts.body || '{}');
      return ai
        .createChatCompletion(body)
        .then(response => ({
          ok: true,
          status: 200,
          data: response,
        }))
        .catch(error => ({
          ok: false,
          status: error.status || 500,
          data: { error: error.message },
        }));
    });
  }

  return {
    fetch,
    ai,
    profiles,
    createResponse: opts => new MockResponse(opts),
  };
}

module.exports = {
  MockResponse,
  MockFetch,
  MockAIService,
  MockProfileService,
  createApiEnvironment,
};
