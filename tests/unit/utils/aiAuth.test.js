/**
 * Test suite for aiAuth module
 */

// Create a mock OpenAI constructor
const mockOpenAI = jest.fn();

// These will be set in beforeEach after mocking
let auth;
let webhookUserTracker;

// Mock dependencies
jest.mock('openai', () => ({
  OpenAI: mockOpenAI
}));
jest.mock('../../../src/logger', () => ({
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('aiAuth', () => {
  const mockApiEndpoint = 'https://api.example.com';
  const mockApiKey = 'test-api-key';
  const mockAppId = 'test-app-id';
  const mockUserToken = 'user-token-123';
  let aiAuth;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Reset the module to clear the default client
    jest.resetModules();
    
    // Reset and configure the OpenAI mock
    mockOpenAI.mockReset();
    mockOpenAI.mockImplementation((config) => ({ 
      _config: config,
      _type: 'mock-openai-client' 
    }));
    
    // Setup mocks before requiring any modules
    jest.doMock('../../../config', () => ({
      getApiEndpoint: jest.fn().mockReturnValue(mockApiEndpoint)
    }));
    
    jest.doMock('../../../src/auth', () => ({
      API_KEY: mockApiKey,
      APP_ID: mockAppId,
      hasValidToken: jest.fn(),
      getUserToken: jest.fn()
    }));
    
    jest.doMock('../../../src/utils/webhookUserTracker', () => ({
      shouldBypassNsfwVerification: jest.fn()
    }));
    
    // Now require the modules after mocks are set up
    const { getApiEndpoint } = require('../../../config');
    auth = require('../../../src/auth');
    webhookUserTracker = require('../../../src/utils/webhookUserTracker');
    
    // Require the module under test
    aiAuth = require('../../../src/utils/aiAuth');
  });

  describe('initAiClient', () => {
    it('should initialize the default AI client', () => {
      // Clear the mock before the call
      mockOpenAI.mockClear();
      
      aiAuth.initAiClient();

      expect(mockOpenAI).toHaveBeenCalledTimes(1);
      expect(mockOpenAI).toHaveBeenCalledWith({
        apiKey: mockApiKey,
        baseURL: mockApiEndpoint,
        defaultHeaders: {},
      });
    });
  });

  describe('getDefaultClient', () => {
    it('should return the default client after initialization', () => {
      aiAuth.initAiClient();
      const client = aiAuth.getDefaultClient();

      expect(client._type).toBe('mock-openai-client');
    });

    it('should throw error if called before initialization', () => {
      expect(() => aiAuth.getDefaultClient()).toThrow(
        '[AIAuth] Default AI client not initialized. Call initAiClient() first.'
      );
    });
  });

  describe('createAiClient', () => {
    it('should create a new AI client with provided headers', () => {
      const headers = { 'X-Custom': 'value' };
      
      const client = aiAuth.createAiClient(headers);

      expect(mockOpenAI).toHaveBeenCalledWith({
        apiKey: mockApiKey,
        baseURL: mockApiEndpoint,
        defaultHeaders: headers,
      });
      expect(client._type).toBe('mock-openai-client');
    });

    it('should create a client with empty headers if none provided', () => {
      aiAuth.createAiClient();

      expect(mockOpenAI).toHaveBeenCalledWith({
        apiKey: mockApiKey,
        baseURL: mockApiEndpoint,
        defaultHeaders: {},
      });
    });
  });

  describe('shouldBypassAuth', () => {
    it('should return true when webhook message should bypass auth', () => {
      const context = {
        message: { webhookId: 'webhook123' }
      };
      webhookUserTracker.shouldBypassNsfwVerification.mockReturnValue(true);

      const result = aiAuth.shouldBypassAuth(context);

      expect(result).toBe(true);
      expect(webhookUserTracker.shouldBypassNsfwVerification).toHaveBeenCalledWith(context.message);
    });

    it('should return false when webhook message should not bypass auth', () => {
      const context = {
        message: { webhookId: 'webhook123' }
      };
      webhookUserTracker.shouldBypassNsfwVerification.mockReturnValue(false);

      const result = aiAuth.shouldBypassAuth(context);

      expect(result).toBe(false);
    });

    it('should return false when no webhook message in context', () => {
      expect(aiAuth.shouldBypassAuth({})).toBe(false);
      expect(aiAuth.shouldBypassAuth({ message: {} })).toBe(false);
    });
  });

  describe('getAiClientForUser', () => {
    it('should return client with bypass auth when webhook bypass is enabled', () => {
      const context = {
        message: { webhookId: 'webhook123' }
      };
      webhookUserTracker.shouldBypassNsfwVerification.mockReturnValue(true);

      const client = aiAuth.getAiClientForUser('user123', context);

      expect(client).toBeTruthy();
      expect(mockOpenAI).toHaveBeenCalledWith({
        apiKey: mockApiKey,
        baseURL: mockApiEndpoint,
        defaultHeaders: {
          'X-App-ID': mockAppId,
        },
      });
    });

    it('should return client with user token when user has valid token', () => {
      auth.hasValidToken.mockReturnValue(true);
      auth.getUserToken.mockReturnValue(mockUserToken);

      const client = aiAuth.getAiClientForUser('user123');

      expect(client).toBeTruthy();
      expect(mockOpenAI).toHaveBeenCalledWith({
        apiKey: mockApiKey,
        baseURL: mockApiEndpoint,
        defaultHeaders: {
          'X-App-ID': mockAppId,
          'X-User-Auth': mockUserToken,
        },
      });
    });

    it('should return null when user has no valid token and no bypass', () => {
      auth.hasValidToken.mockReturnValue(false);
      webhookUserTracker.shouldBypassNsfwVerification.mockReturnValue(false);

      const client = aiAuth.getAiClientForUser('user123');

      expect(client).toBeNull();
    });

    it('should handle null userId gracefully', () => {
      auth.hasValidToken.mockReturnValue(false);

      const client = aiAuth.getAiClientForUser(null);

      expect(client).toBeNull();
    });
  });

  describe('hasValidAuth', () => {
    it('should return true when auth bypass is enabled', () => {
      const context = {
        message: { webhookId: 'webhook123' }
      };
      webhookUserTracker.shouldBypassNsfwVerification.mockReturnValue(true);

      const result = aiAuth.hasValidAuth('user123', context);

      expect(result).toBe(true);
    });

    it('should return true when user has valid token', () => {
      auth.hasValidToken.mockReturnValue(true);

      const result = aiAuth.hasValidAuth('user123');

      expect(result).toBe(true);
      expect(auth.hasValidToken).toHaveBeenCalledWith('user123');
    });

    it('should return false when no bypass and no valid token', () => {
      auth.hasValidToken.mockReturnValue(false);
      webhookUserTracker.shouldBypassNsfwVerification.mockReturnValue(false);

      const result = aiAuth.hasValidAuth('user123');

      expect(result).toBe(false);
    });

    it('should return false for null userId without bypass', () => {
      auth.hasValidToken.mockReturnValue(false);
      webhookUserTracker.shouldBypassNsfwVerification.mockReturnValue(false);

      const result = aiAuth.hasValidAuth(null);

      expect(result).toBe(false);
    });
  });
});