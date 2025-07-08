/**
 * Test suite for aiAuth module
 */

// Create a mock OpenAI constructor
const mockOpenAI = jest.fn();

// Mock dependencies
jest.mock('openai', () => ({
  OpenAI: mockOpenAI,
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
  let mockAuthManager;
  let mockAIClient;

  beforeEach(() => {
    jest.clearAllMocks();

    // Reset the module to clear any cached state
    jest.resetModules();

    // Create mock AI client
    mockAIClient = {
      _config: { apiKey: mockApiKey },
      _type: 'mock-openai-client',
    };

    // Reset and configure the OpenAI mock
    mockOpenAI.mockReset();
    mockOpenAI.mockImplementation(config => ({
      _config: config,
      _type: 'mock-openai-client',
    }));

    // Create mock auth manager
    mockAuthManager = {
      aiClientFactory: {
        getDefaultClient: jest.fn().mockReturnValue(mockAIClient),
      },
      getAIClient: jest.fn().mockResolvedValue(mockAIClient),
    };

    // Require the module under test
    aiAuth = require('../../../src/utils/aiAuth');
    
    // Initialize aiAuth with mockAuthManager
    aiAuth.initAiClient(mockAuthManager);
  });

  describe('initAI', () => {
    it('should initialize with auth manager', async () => {
      const logger = require('../../../src/logger');
      
      // Reset modules to test initialization
      jest.resetModules();
      const freshAiAuth = require('../../../src/utils/aiAuth');

      await freshAiAuth.initAI(mockAuthManager);

      expect(logger.info).toHaveBeenCalledWith(
        '[AIAuth] AI client initialized with auth manager'
      );
    });

    it('should support legacy initAiClient alias', async () => {
      const logger = require('../../../src/logger');
      
      // Reset modules to test initialization
      jest.resetModules();
      const freshAiAuth = require('../../../src/utils/aiAuth');

      await freshAiAuth.initAiClient(mockAuthManager);

      expect(logger.info).toHaveBeenCalledWith(
        '[AIAuth] AI client initialized with auth manager'
      );
    });
  });

  describe('getAI', () => {
    it('should return the default AI client from auth manager', () => {
      const client = aiAuth.getAI();

      // Auth manager is now injected directly
      expect(mockAuthManager.aiClientFactory.getDefaultClient).toHaveBeenCalled();
      expect(client).toBe(mockAIClient);
    });

    it('should return a test client when auth manager is not available in test mode', () => {
      // Test uninitialized state by creating fresh instance
      jest.resetModules();
      const freshAiAuth = require('../../../src/utils/aiAuth');

      // Since we removed NODE_ENV check, this should now throw
      expect(() => freshAiAuth.getAI()).toThrow('Auth manager not initialized. Call initAiClient() with authManager first.');
    });

    it('should throw error when auth manager is not available in non-test mode', () => {
      // Test uninitialized state by creating fresh instance
      jest.resetModules();
      const freshAiAuth = require('../../../src/utils/aiAuth');

      // Ensure we're not in test mode
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      try {
        expect(() => freshAiAuth.getAI()).toThrow('Auth manager not initialized. Call initAiClient() with authManager first.');
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });
  });

  describe('getAIForUser', () => {
    it('should return AI client for user from auth manager', async () => {
      const logger = require('../../../src/logger');
      const userId = 'user123';

      const client = await aiAuth.getAIForUser({ userId, isWebhook: false });

      // Auth manager is now provided during initialization
      expect(mockAuthManager.getAIClient).toHaveBeenCalledWith({ userId, isWebhook: false });
      expect(client).toBe(mockAIClient);
      expect(logger.debug).toHaveBeenCalledWith(
        '[AIAuth] Got AI client for user user123 (webhook: false)'
      );
    });

    it('should handle webhook context', async () => {
      const userId = 'user123';

      const client = await aiAuth.getAIForUser({ userId, isWebhook: true });

      expect(mockAuthManager.getAIClient).toHaveBeenCalledWith({ userId, isWebhook: true });
      expect(client).toBe(mockAIClient);
    });

    it('should fall back to default client on error', async () => {
      const logger = require('../../../src/logger');
      const userId = 'user123';
      const error = new Error('Test error');

      mockAuthManager.getAIClient.mockRejectedValue(error);

      const client = await aiAuth.getAIForUser({ userId });

      expect(logger.error).toHaveBeenCalledWith(
        '[AIAuth] Failed to get AI client for user user123:',
        error
      );
      expect(mockAuthManager.aiClientFactory.getDefaultClient).toHaveBeenCalled();
      expect(client).toBe(mockAIClient);
    });

    it('should throw when auth manager not initialized', async () => {
      // Reset modules to test uninitialized state
      jest.resetModules();
      const freshAiAuth = require('../../../src/utils/aiAuth');

      // Should throw when not initialized
      await expect(freshAiAuth.getAIForUser({ userId: 'user123' })).rejects.toThrow(
        'Auth manager not initialized. Call initAiClient() with authManager first.'
      );
    });
  });

  describe('getAiClientForUser (legacy)', () => {
    it('should delegate to getAIForUser with isWebhook from context', async () => {
      const userId = 'user123';
      const context = { isWebhook: true };

      const client = await aiAuth.getAiClientForUser(userId, context);

      // Verify it called the auth manager with the right parameters
      expect(mockAuthManager.getAIClient).toHaveBeenCalledWith({ userId, isWebhook: true });
      expect(client).toBe(mockAIClient);
    });

    it('should default isWebhook to false when no context', async () => {
      const userId = 'user123';

      const client = await aiAuth.getAiClientForUser(userId);

      // Verify it called the auth manager with the right parameters
      expect(mockAuthManager.getAIClient).toHaveBeenCalledWith({ userId, isWebhook: false });
      expect(client).toBe(mockAIClient);
    });
  });
});
