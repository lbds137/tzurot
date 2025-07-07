/**
 * Tests for auth.js
 */

// Mock dependencies before imports
jest.mock('../../src/logger');
jest.mock('../../src/core/authentication');
jest.mock('../../src/dataStorage');
jest.mock('../../config', () => ({
  botConfig: {
    isDevelopment: false
  }
}));

const auth = require('../../src/auth');
const logger = require('../../src/logger');
const AuthManager = require('../../src/core/authentication');
const { getDataDirectory } = require('../../src/dataStorage');

describe('auth', () => {
  let mockAuthManager;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock logger
    logger.info = jest.fn();
    logger.error = jest.fn();
    logger.debug = jest.fn();
    logger.warn = jest.fn();
    
    // Mock data directory
    getDataDirectory.mockReturnValue('/tmp/test-data');
    
    // Set required environment variables
    process.env.SERVICE_APP_ID = 'test-app-id';
    process.env.SERVICE_API_KEY = 'test-api-key';
    process.env.SERVICE_WEBSITE = 'https://test.example.com';
    process.env.SERVICE_API_BASE_URL = 'https://api.test.example.com';
    process.env.BOT_OWNER_ID = 'test-owner-id';
    
    // Create mock AuthManager instance
    mockAuthManager = {
      initialize: jest.fn().mockResolvedValue(undefined),
      shutdown: jest.fn().mockResolvedValue(undefined),
      getAuthorizationUrl: jest.fn().mockReturnValue('https://test.example.com/authorize'),
      getUserToken: jest.fn(),
      hasValidToken: jest.fn(),
      storeUserToken: jest.fn().mockResolvedValue(true),
      deleteUserToken: jest.fn().mockResolvedValue(true),
      storeNsfwVerification: jest.fn().mockResolvedValue(true),
      isNsfwVerified: jest.fn(),
      cleanupExpiredTokens: jest.fn().mockResolvedValue(0),
      getTokenAge: jest.fn(),
      getTokenExpirationInfo: jest.fn(),
      userTokenManager: {
        exchangeCodeForToken: jest.fn(),
      },
    };
    
    // Mock AuthManager constructor
    AuthManager.mockImplementation(() => mockAuthManager);
    AuthManager.TOKEN_EXPIRATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
  });

  afterEach(async () => {
    // Clean up
    // Don't shutdown here as some tests check shutdown behavior
  });

  describe('initAuth', () => {
    test('should initialize auth manager successfully', async () => {
      await auth.initAuth();
      
      expect(AuthManager).toHaveBeenCalledWith({
        appId: 'test-app-id',
        apiKey: 'test-api-key',
        authWebsite: 'https://test.example.com',
        authApiEndpoint: 'https://api.test.example.com/auth',
        serviceApiBaseUrl: 'https://api.test.example.com/v1',
        ownerId: 'test-owner-id',
        isDevelopment: false,
        dataDir: '/tmp/test-data',
      });
      
      expect(mockAuthManager.initialize).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith('[Auth] Authentication system initialized successfully');
    });

    test('should handle initialization errors', async () => {
      const error = new Error('Init failed');
      mockAuthManager.initialize.mockRejectedValue(error);
      
      await expect(auth.initAuth()).rejects.toThrow('Init failed');
      expect(logger.error).toHaveBeenCalledWith('[Auth] Failed to initialize auth system:', error);
    });

    test('should reuse existing auth manager', async () => {
      await auth.initAuth();
      const firstCallCount = AuthManager.mock.calls.length;
      
      await auth.initAuth();
      expect(AuthManager.mock.calls.length).toBe(firstCallCount);
    });
  });

  describe('getAuthManager', () => {
    test('should return auth manager instance', () => {
      const manager = auth.getAuthManager();
      expect(manager).toBe(mockAuthManager);
    });

    test('should create auth manager on first call', () => {
      expect(AuthManager).not.toHaveBeenCalled();
      auth.getAuthManager();
      expect(AuthManager).toHaveBeenCalledTimes(1);
    });
  });

  describe('delegated methods', () => {
    beforeEach(async () => {
      await auth.initAuth();
    });

    test('getAuthorizationUrl should delegate to auth manager', () => {
      const url = auth.getAuthorizationUrl();
      expect(url).toBe('https://test.example.com/authorize');
      expect(mockAuthManager.getAuthorizationUrl).toHaveBeenCalled();
    });

    test('exchangeCodeForToken should delegate to token manager', async () => {
      mockAuthManager.userTokenManager.exchangeCodeForToken.mockResolvedValue({ token: 'new-token' });
      
      const result = await auth.exchangeCodeForToken('test-code');
      
      expect(result).toEqual({ token: 'new-token' });
      expect(mockAuthManager.userTokenManager.exchangeCodeForToken).toHaveBeenCalledWith('test-code');
    });

    test('getUserToken should delegate to auth manager', () => {
      mockAuthManager.getUserToken.mockReturnValue('user-token');
      
      const token = auth.getUserToken('user123');
      
      expect(token).toBe('user-token');
      expect(mockAuthManager.getUserToken).toHaveBeenCalledWith('user123');
    });

    test('hasValidToken should delegate to auth manager', () => {
      mockAuthManager.hasValidToken.mockReturnValue(true);
      
      const isValid = auth.hasValidToken('user123');
      
      expect(isValid).toBe(true);
      expect(mockAuthManager.hasValidToken).toHaveBeenCalledWith('user123');
    });

    test('storeUserToken should delegate to auth manager', async () => {
      const result = await auth.storeUserToken('user123', 'new-token');
      
      expect(result).toBe(true);
      expect(mockAuthManager.storeUserToken).toHaveBeenCalledWith('user123', 'new-token');
    });

    test('deleteUserToken should delegate to auth manager', async () => {
      const result = await auth.deleteUserToken('user123');
      
      expect(result).toBe(true);
      expect(mockAuthManager.deleteUserToken).toHaveBeenCalledWith('user123');
    });

    test('storeNsfwVerification should delegate to auth manager', async () => {
      const result = await auth.storeNsfwVerification('user123', true);
      
      expect(result).toBe(true);
      expect(mockAuthManager.storeNsfwVerification).toHaveBeenCalledWith('user123', true);
    });

    test('isNsfwVerified should delegate to auth manager', () => {
      mockAuthManager.isNsfwVerified.mockReturnValue(true);
      
      const isVerified = auth.isNsfwVerified('user123');
      
      expect(isVerified).toBe(true);
      expect(mockAuthManager.isNsfwVerified).toHaveBeenCalledWith('user123');
    });

    test('cleanupExpiredTokens should delegate to auth manager', async () => {
      const count = await auth.cleanupExpiredTokens();
      
      expect(count).toBe(0);
      expect(mockAuthManager.cleanupExpiredTokens).toHaveBeenCalled();
    });

    test('getTokenAge should delegate to auth manager', () => {
      mockAuthManager.getTokenAge.mockReturnValue(5);
      
      const age = auth.getTokenAge('user123');
      
      expect(age).toBe(5);
      expect(mockAuthManager.getTokenAge).toHaveBeenCalledWith('user123');
    });

    test('getTokenExpirationInfo should delegate to auth manager', () => {
      const info = { daysUntilExpiration: 25, percentRemaining: 83.33 };
      mockAuthManager.getTokenExpirationInfo.mockReturnValue(info);
      
      const result = auth.getTokenExpirationInfo('user123');
      
      expect(result).toEqual(info);
      expect(mockAuthManager.getTokenExpirationInfo).toHaveBeenCalledWith('user123');
    });
  });

  describe('constants', () => {
    test('should export TOKEN_EXPIRATION_MS', () => {
      expect(auth.TOKEN_EXPIRATION_MS).toBe(30 * 24 * 60 * 60 * 1000);
    });

    test('should export APP_ID', () => {
      expect(auth.APP_ID).toBe('test-app-id');
    });

    test('should export API_KEY', () => {
      expect(auth.API_KEY).toBe('test-api-key');
    });
  });

  describe('shutdown', () => {
    test('should shutdown auth manager', async () => {
      await auth.initAuth();
      await auth.shutdown();
      
      expect(mockAuthManager.shutdown).toHaveBeenCalled();
    });

    test('should handle multiple shutdowns gracefully', async () => {
      // First ensure auth manager exists
      await auth.initAuth();
      
      // Clear the mock call count
      mockAuthManager.shutdown.mockClear();
      
      // Now test multiple shutdowns
      await auth.shutdown();
      await auth.shutdown();
      
      expect(mockAuthManager.shutdown).toHaveBeenCalledTimes(1);
    });
  });
});