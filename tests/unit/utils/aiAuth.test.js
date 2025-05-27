/**
 * Test suite for aiAuth module
 */

// Create a mock OpenAI constructor
const mockOpenAI = jest.fn();

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
  let auth;
  let mockAuthManager;
  let mockAIClient;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Reset the module to clear any cached state
    jest.resetModules();
    
    // Create mock AI client
    mockAIClient = {
      _config: { apiKey: mockApiKey },
      _type: 'mock-openai-client'
    };
    
    // Reset and configure the OpenAI mock
    mockOpenAI.mockReset();
    mockOpenAI.mockImplementation((config) => ({ 
      _config: config,
      _type: 'mock-openai-client' 
    }));
    
    // Create mock auth manager
    mockAuthManager = {
      aiClientFactory: {
        getDefaultClient: jest.fn().mockReturnValue(mockAIClient)
      },
      getAIClient: jest.fn().mockResolvedValue(mockAIClient)
    };
    
    // Setup mocks before requiring any modules
    jest.doMock('../../../src/auth', () => ({
      API_KEY: mockApiKey,
      APP_ID: mockAppId,
      hasValidToken: jest.fn(),
      getUserToken: jest.fn(),
      getAuthManager: jest.fn().mockReturnValue(mockAuthManager)
    }));
    
    // Now require the modules after mocks are set up
    auth = require('../../../src/auth');
    
    // Require the module under test
    aiAuth = require('../../../src/utils/aiAuth');
  });

  describe('initAI', () => {
    it('should log that initialization is handled by auth system', async () => {
      const logger = require('../../../src/logger');
      
      await aiAuth.initAI();
      
      expect(logger.info).toHaveBeenCalledWith('[AIAuth] AI client initialization is now handled by auth system');
    });
    
    it('should support legacy initAiClient alias', async () => {
      const logger = require('../../../src/logger');
      
      await aiAuth.initAiClient();
      
      expect(logger.info).toHaveBeenCalledWith('[AIAuth] AI client initialization is now handled by auth system');
    });
  });

  describe('getAI', () => {
    it('should return the default AI client from auth manager', () => {
      const client = aiAuth.getAI();
      
      expect(auth.getAuthManager).toHaveBeenCalled();
      expect(mockAuthManager.aiClientFactory.getDefaultClient).toHaveBeenCalled();
      expect(client).toBe(mockAIClient);
    });
    
    it('should return a test client when auth manager is not available in test mode', () => {
      // Mock auth manager not available
      auth.getAuthManager.mockReturnValue(null);
      
      // Ensure we're in test mode
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'test';
      
      try {
        const client = aiAuth.getAI();
        
        expect(mockOpenAI).toHaveBeenCalledWith({
          apiKey: 'test-key',
          baseURL: 'http://test.example.com'
        });
        expect(client._type).toBe('mock-openai-client');
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });
    
    it('should throw error when auth manager is not available in non-test mode', () => {
      // Mock auth manager not available
      auth.getAuthManager.mockReturnValue(null);
      
      // Ensure we're not in test mode
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      
      try {
        expect(() => aiAuth.getAI()).toThrow('Auth system not initialized. Call initAuth() first.');
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
      
      expect(auth.getAuthManager).toHaveBeenCalled();
      expect(mockAuthManager.getAIClient).toHaveBeenCalledWith({ userId, isWebhook: false });
      expect(client).toBe(mockAIClient);
      expect(logger.debug).toHaveBeenCalledWith('[AIAuth] Got AI client for user user123 (webhook: false)');
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
      
      expect(logger.error).toHaveBeenCalledWith('[AIAuth] Failed to get AI client for user user123:', error);
      expect(mockAuthManager.aiClientFactory.getDefaultClient).toHaveBeenCalled();
      expect(client).toBe(mockAIClient);
    });
    
    it('should return test client when auth manager not available in test mode', async () => {
      auth.getAuthManager.mockReturnValue(null);
      
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'test';
      
      try {
        const client = await aiAuth.getAIForUser({ userId: 'user123' });
        
        expect(mockOpenAI).toHaveBeenCalledWith({
          apiKey: 'test-key',
          baseURL: 'http://test.example.com'
        });
        expect(client._type).toBe('mock-openai-client');
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
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