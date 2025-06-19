/**
 * Tests for AIClientFactory
 */

// Setup module mocks before any imports
jest.mock('../../../../src/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
}));

jest.mock('openai', () => ({
  OpenAI: jest.fn(),
}));

// Import after mocking
const AIClientFactory = require('../../../../src/core/authentication/AIClientFactory');
const { OpenAI } = require('openai');

describe('AIClientFactory', () => {
  let factory;
  let logger;
  const serviceApiKey = 'test-api-key';
  const serviceApiBaseUrl = 'https://api.example.com';

  // Mock OpenAI instance
  let mockOpenAIInstance;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create fresh mock instance
    mockOpenAIInstance = {
      _config: null,
    };

    // Configure OpenAI mock
    OpenAI.mockImplementation(config => {
      mockOpenAIInstance._config = config;
      return mockOpenAIInstance;
    });

    factory = new AIClientFactory(serviceApiKey, serviceApiBaseUrl);
    logger = require('../../../../src/logger');
  });

  describe('Constructor', () => {
    it('should initialize with provided configuration', () => {
      expect(factory.serviceApiKey).toBe(serviceApiKey);
      expect(factory.serviceApiBaseUrl).toBe(serviceApiBaseUrl);
      expect(factory.defaultClient).toBeNull();
      expect(factory.userClients).toBeInstanceOf(Map);
      expect(factory.userClients.size).toBe(0);
    });
  });

  describe('initialize', () => {
    it('should create default client on initialization', async () => {
      await factory.initialize();

      expect(factory.defaultClient).toBe(mockOpenAIInstance);
      expect(OpenAI).toHaveBeenCalledWith({
        apiKey: serviceApiKey,
        baseURL: serviceApiBaseUrl,
      });
      expect(logger.info).toHaveBeenCalledWith('[AIClientFactory] Initialized default AI client');
    });

    it('should handle initialization errors', async () => {
      const error = new Error('OpenAI initialization failed');
      OpenAI.mockImplementation(() => {
        throw error;
      });

      await expect(factory.initialize()).rejects.toThrow(error);
      expect(logger.error).toHaveBeenCalledWith('[AIClientFactory] Failed to initialize:', error);
    });
  });

  describe('getDefaultClient', () => {
    it('should return default client after initialization', async () => {
      await factory.initialize();

      const client = factory.getDefaultClient();

      expect(client).toBe(mockOpenAIInstance);
    });

    it('should throw error if not initialized', () => {
      expect(() => factory.getDefaultClient()).toThrow(
        'AIClientFactory not initialized. Call initialize() first.'
      );
    });
  });

  describe('createUserClient', () => {
    it('should create client with user token', async () => {
      const userId = 'user123';
      const userToken = 'user-auth-token';

      const client = await factory.createUserClient(userId, userToken, false);

      expect(OpenAI).toHaveBeenCalledWith({
        apiKey: serviceApiKey,
        baseURL: serviceApiBaseUrl,
        defaultHeaders: {
          'X-User-Auth': userToken,
        },
      });
      expect(client).toBe(mockOpenAIInstance);
      expect(factory.userClients.has('user123-false')).toBe(true);
    });

    it('should create webhook client with bypass header', async () => {
      const userId = 'user123';

      const client = await factory.createUserClient(userId, null, true);

      expect(OpenAI).toHaveBeenCalledWith({
        apiKey: serviceApiKey,
        baseURL: serviceApiBaseUrl,
        defaultHeaders: {
          'Tzurot-Webhook-Bypass': 'true',
        },
      });
      expect(client).toBe(mockOpenAIInstance);
      expect(factory.userClients.has('user123-true')).toBe(true);
    });

    it('should create client with both token and webhook bypass', async () => {
      const userId = 'user123';
      const userToken = 'user-auth-token';

      const client = await factory.createUserClient(userId, userToken, true);

      expect(OpenAI).toHaveBeenCalledWith({
        apiKey: serviceApiKey,
        baseURL: serviceApiBaseUrl,
        defaultHeaders: {
          'X-User-Auth': userToken,
          'Tzurot-Webhook-Bypass': 'true',
        },
      });
      expect(client).toBe(mockOpenAIInstance);
    });

    it('should return cached client on subsequent calls', async () => {
      const userId = 'user123';
      const userToken = 'user-auth-token';

      const client1 = await factory.createUserClient(userId, userToken, false);
      OpenAI.mockClear();

      const client2 = await factory.createUserClient(userId, userToken, false);

      expect(client1).toBe(client2);
      expect(OpenAI).not.toHaveBeenCalled();
      expect(logger.debug).toHaveBeenCalledWith(
        '[AIClientFactory] Returning cached client for user user123'
      );
    });

    it('should handle errors during client creation', async () => {
      const error = new Error('OpenAI error');
      OpenAI.mockImplementationOnce(() => {
        throw error;
      });

      await expect(factory.createUserClient('user123', 'token', false)).rejects.toThrow(error);
      expect(logger.error).toHaveBeenCalledWith(
        '[AIClientFactory] Failed to create user client for user123:',
        error
      );
    });
  });

  describe('getClient', () => {
    beforeEach(async () => {
      await factory.initialize();
    });

    it('should return default client when useDefault is true', async () => {
      const client = await factory.getClient({ useDefault: true });

      expect(client).toBe(factory.defaultClient);
    });

    it('should return default client when no user context provided', async () => {
      const client = await factory.getClient({});

      expect(client).toBe(factory.defaultClient);
    });

    it('should create user client when userId provided', async () => {
      // Clear the mock count from initialization
      OpenAI.mockClear();

      const client = await factory.getClient({
        userId: 'user123',
        userToken: 'token',
        isWebhook: false,
      });

      expect(OpenAI).toHaveBeenCalledWith({
        apiKey: serviceApiKey,
        baseURL: serviceApiBaseUrl,
        defaultHeaders: {
          'X-User-Auth': 'token',
        },
      });
      expect(client).toBe(mockOpenAIInstance);
    });
  });

  describe('clearUserClient', () => {
    it('should clear cached clients for a user', async () => {
      const userId = 'user123';

      // Create both webhook and non-webhook clients
      await factory.createUserClient(userId, 'token', false);
      await factory.createUserClient(userId, 'token', true);

      expect(factory.userClients.size).toBe(2);

      factory.clearUserClient(userId);

      expect(factory.userClients.size).toBe(0);
      expect(factory.userClients.has('user123-false')).toBe(false);
      expect(factory.userClients.has('user123-true')).toBe(false);
      expect(logger.debug).toHaveBeenCalledWith(
        '[AIClientFactory] Cleared cached clients for user user123'
      );
    });
  });

  describe('clearAllClients', () => {
    it('should clear all cached clients', async () => {
      // Create multiple clients
      await factory.createUserClient('user1', 'token1', false);
      await factory.createUserClient('user2', 'token2', false);
      await factory.createUserClient('user3', null, true);

      expect(factory.userClients.size).toBe(3);

      factory.clearAllClients();

      expect(factory.userClients.size).toBe(0);
      expect(logger.info).toHaveBeenCalledWith('[AIClientFactory] Cleared all cached clients');
    });
  });

  describe('getCacheStats', () => {
    it('should return cache statistics', async () => {
      const stats = factory.getCacheStats();

      expect(stats).toEqual({
        cachedClients: 0,
        hasDefaultClient: false,
      });

      await factory.initialize();
      await factory.createUserClient('user1', 'token', false);
      await factory.createUserClient('user2', null, true);

      const updatedStats = factory.getCacheStats();

      expect(updatedStats).toEqual({
        cachedClients: 2,
        hasDefaultClient: true,
      });
    });
  });
});
