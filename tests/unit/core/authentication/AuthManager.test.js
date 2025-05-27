/**
 * Tests for AuthManager
 */

const AuthManager = require('../../../../src/core/authentication/AuthManager');

jest.mock('../../../../src/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn()
}));

// We'll manually mock the sub-modules to have full control
jest.mock('../../../../src/core/authentication/UserTokenManager');
jest.mock('../../../../src/core/authentication/NsfwVerificationManager');
jest.mock('../../../../src/core/authentication/AIClientFactory');
jest.mock('../../../../src/core/authentication/PersonalityAuthValidator');
jest.mock('../../../../src/core/authentication/AuthPersistence');

describe('AuthManager', () => {
  let manager;
  let logger;
  let mockUserTokenManager;
  let mockNsfwManager;
  let mockAIFactory;
  let mockAuthValidator;
  let mockPersistence;
  
  const config = {
    appId: 'test-app-id',
    apiKey: 'test-api-key',
    authWebsite: 'https://auth.example.com',
    authApiEndpoint: 'https://api.example.com/auth',
    serviceApiBaseUrl: 'https://service.example.com',
    ownerId: 'owner123',
    dataDir: '/test/data'
  };
  
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    
    // Create mock instances
    mockUserTokenManager = {
      getAuthorizationUrl: jest.fn().mockReturnValue('https://auth.url'),
      exchangeCodeForToken: jest.fn().mockResolvedValue('token123'),
      storeUserToken: jest.fn(),
      getUserToken: jest.fn().mockReturnValue(null),
      hasValidToken: jest.fn().mockReturnValue(false),
      deleteUserToken: jest.fn().mockReturnValue(true),
      getTokenAge: jest.fn().mockReturnValue(10),
      getTokenExpirationInfo: jest.fn().mockReturnValue({ daysUntilExpiration: 20, percentRemaining: 66 }),
      cleanupExpiredTokens: jest.fn().mockReturnValue(0),
      getAllTokens: jest.fn().mockReturnValue({}),
      setAllTokens: jest.fn()
    };
    
    mockNsfwManager = {
      storeVerification: jest.fn(),
      removeVerification: jest.fn(),
      isVerified: jest.fn().mockReturnValue(false),
      getAllVerifications: jest.fn().mockReturnValue({}),
      setAllVerifications: jest.fn()
    };
    
    mockAIFactory = {
      initialize: jest.fn().mockResolvedValue(undefined),
      getDefaultClient: jest.fn().mockReturnValue({ _type: 'default-client' }),
      createAuthenticatedClient: jest.fn().mockReturnValue({ _type: 'auth-client' }),
      createBypassClient: jest.fn().mockReturnValue({ _type: 'bypass-client' }),
      getClientForUser: jest.fn().mockReturnValue({ _type: 'user-client' }),
      clearUserClient: jest.fn(),
      getCacheStats: jest.fn().mockReturnValue({ cached: 0, hits: 0, misses: 0 })
    };
    
    mockAuthValidator = {
      validateAccess: jest.fn().mockResolvedValue({ authorized: false, reason: 'token_required' }),
      getUserAuthStatus: jest.fn().mockReturnValue({ hasToken: false, isVerified: false }),
      getAuthHelpMessage: jest.fn().mockReturnValue('Please authenticate')
    };
    
    mockPersistence = {
      loadUserTokens: jest.fn().mockResolvedValue({}),
      saveUserTokens: jest.fn().mockResolvedValue(true),
      loadNsfwVerifications: jest.fn().mockResolvedValue({}),
      saveNsfwVerifications: jest.fn().mockResolvedValue(true),
      getFileStats: jest.fn().mockResolvedValue({ tokens: { size: 0 }, verifications: { size: 0 } })
    };
    
    // Set up mocks
    const UserTokenManager = require('../../../../src/core/authentication/UserTokenManager');
    UserTokenManager.mockImplementation(() => mockUserTokenManager);
    
    const NsfwVerificationManager = require('../../../../src/core/authentication/NsfwVerificationManager');
    NsfwVerificationManager.mockImplementation(() => mockNsfwManager);
    
    const AIClientFactory = require('../../../../src/core/authentication/AIClientFactory');
    AIClientFactory.mockImplementation(() => mockAIFactory);
    
    const PersonalityAuthValidator = require('../../../../src/core/authentication/PersonalityAuthValidator');
    PersonalityAuthValidator.mockImplementation(() => mockAuthValidator);
    
    const AuthPersistence = require('../../../../src/core/authentication/AuthPersistence');
    AuthPersistence.mockImplementation(() => mockPersistence);
    
    manager = new AuthManager(config);
    logger = require('../../../../src/logger');
  });
  
  afterEach(() => {
    jest.useRealTimers();
  });
  
  describe('Constructor', () => {
    it('should initialize with provided configuration', () => {
      expect(manager.appId).toBe(config.appId);
      expect(manager.apiKey).toBe(config.apiKey);
      expect(manager.authWebsite).toBe(config.authWebsite);
      expect(manager.authApiEndpoint).toBe(config.authApiEndpoint);
      expect(manager.serviceApiBaseUrl).toBe(config.serviceApiBaseUrl);
      expect(manager.ownerId).toBe(config.ownerId);
      expect(manager.dataDir).toBe(config.dataDir);
    });
    
    it('should create all sub-modules', () => {
      expect(manager.userTokenManager).toBe(mockUserTokenManager);
      expect(manager.nsfwVerificationManager).toBe(mockNsfwManager);
      expect(manager.aiClientFactory).toBe(mockAIFactory);
      expect(manager.personalityAuthValidator).toBe(mockAuthValidator);
      expect(manager.authPersistence).toBe(mockPersistence);
    });
    
    it('should use environment variables when config not provided', () => {
      const envManager = new AuthManager();
      expect(envManager.appId).toBe(process.env.SERVICE_APP_ID);
    });
  });
  
  describe('initialize', () => {
    it('should initialize all components and load data', async () => {
      const tokens = { user1: { token: 'token1' } };
      const verifications = { user2: { verified: true } };
      
      mockPersistence.loadUserTokens.mockResolvedValueOnce(tokens);
      mockPersistence.loadNsfwVerifications.mockResolvedValueOnce(verifications);
      
      await manager.initialize();
      
      expect(mockAIFactory.initialize).toHaveBeenCalled();
      expect(mockPersistence.loadUserTokens).toHaveBeenCalled();
      expect(mockPersistence.loadNsfwVerifications).toHaveBeenCalled();
      expect(mockUserTokenManager.setAllTokens).toHaveBeenCalledWith(tokens);
      expect(mockNsfwManager.setAllVerifications).toHaveBeenCalledWith(verifications);
      expect(logger.info).toHaveBeenCalledWith('[AuthManager] Auth system initialized successfully');
    });
    
    it('should clean up expired tokens on startup', async () => {
      mockUserTokenManager.cleanupExpiredTokens.mockReturnValueOnce(2);
      
      await manager.initialize();
      
      expect(mockUserTokenManager.cleanupExpiredTokens).toHaveBeenCalled();
      expect(mockPersistence.saveUserTokens).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith('[AuthManager] Cleaned up 2 expired tokens on startup');
    });
    
    it('should schedule periodic cleanup', async () => {
      await manager.initialize();
      
      expect(manager.cleanupInterval).toBeDefined();
      
      // Fast forward 24 hours
      jest.advanceTimersByTime(24 * 60 * 60 * 1000);
      
      // Wait for async cleanup
      await Promise.resolve();
      
      expect(mockUserTokenManager.cleanupExpiredTokens).toHaveBeenCalledTimes(2); // Once on init, once scheduled
    });
    
    it('should handle initialization errors', async () => {
      const error = new Error('Init failed');
      mockAIFactory.initialize.mockRejectedValueOnce(error);
      
      await expect(manager.initialize()).rejects.toThrow('Init failed');
      expect(logger.error).toHaveBeenCalledWith('[AuthManager] Failed to initialize:', error);
    });
  });
  
  describe('getAuthorizationUrl', () => {
    it('should delegate to UserTokenManager', () => {
      const url = manager.getAuthorizationUrl();
      
      expect(url).toBe('https://auth.url');
      expect(mockUserTokenManager.getAuthorizationUrl).toHaveBeenCalled();
    });
  });
  
  describe('exchangeCodeForToken', () => {
    it('should exchange code and store token', async () => {
      const code = 'auth-code';
      const userId = 'user123';
      
      const result = await manager.exchangeCodeForToken(code, userId);
      
      expect(result).toBe(true);
      expect(mockUserTokenManager.exchangeCodeForToken).toHaveBeenCalledWith(code);
      expect(mockUserTokenManager.storeUserToken).toHaveBeenCalledWith(userId, 'token123');
      expect(mockPersistence.saveUserTokens).toHaveBeenCalled();
      expect(mockAIFactory.clearUserClient).toHaveBeenCalledWith(userId);
    });
    
    it('should handle exchange failure', async () => {
      mockUserTokenManager.exchangeCodeForToken.mockResolvedValueOnce(null);
      
      const result = await manager.exchangeCodeForToken('bad-code', 'user123');
      
      expect(result).toBe(false);
      expect(mockUserTokenManager.storeUserToken).not.toHaveBeenCalled();
    });
    
    it('should handle exchange errors', async () => {
      const error = new Error('Exchange failed');
      mockUserTokenManager.exchangeCodeForToken.mockRejectedValueOnce(error);
      
      const result = await manager.exchangeCodeForToken('code', 'user123');
      
      expect(result).toBe(false);
      expect(logger.error).toHaveBeenCalledWith('[AuthManager] Error exchanging code for user user123:', error);
    });
  });
  
  describe('deleteUserToken', () => {
    it('should delete token and save', async () => {
      const userId = 'user123';
      
      const result = await manager.deleteUserToken(userId);
      
      expect(result).toBe(true);
      expect(mockUserTokenManager.deleteUserToken).toHaveBeenCalledWith(userId);
      expect(mockPersistence.saveUserTokens).toHaveBeenCalled();
    });
    
    it('should handle delete failure', async () => {
      mockUserTokenManager.deleteUserToken.mockReturnValueOnce(false);
      
      const result = await manager.deleteUserToken('user123');
      
      expect(result).toBe(false);
      expect(mockPersistence.saveUserTokens).not.toHaveBeenCalled();
    });
  });
  
  describe('storeNsfwVerification', () => {
    it('should store verification and save', async () => {
      const userId = 'user123';
      
      const result = await manager.storeNsfwVerification(userId, true);
      
      expect(result).toBe(true);
      expect(mockNsfwManager.storeVerification).toHaveBeenCalledWith(userId, true);
      expect(mockPersistence.saveNsfwVerifications).toHaveBeenCalled();
    });
    
    it('should handle save errors', async () => {
      const error = new Error('Save failed');
      mockPersistence.saveNsfwVerifications.mockRejectedValueOnce(error);
      
      const result = await manager.storeNsfwVerification('user123', true);
      
      expect(result).toBe(false);
      expect(logger.error).toHaveBeenCalledWith('[AuthManager] Error storing NSFW verification for user user123:', error);
    });
  });
  
  describe('getAIClient', () => {
    it('should get authenticated client for user with token', async () => {
      mockUserTokenManager.getUserToken.mockReturnValueOnce('user-token');
      
      const client = await manager.getAIClient({ userId: 'user123' });
      
      expect(mockAIFactory.createAuthenticatedClient).toHaveBeenCalledWith('user-token');
      expect(client._type).toBe('auth-client');
    });
    
    it('should get bypass client for webhook', async () => {
      const client = await manager.getAIClient({ isWebhook: true });
      
      expect(mockAIFactory.createBypassClient).toHaveBeenCalled();
      expect(client._type).toBe('bypass-client');
    });
    
    it('should get default client when no token', async () => {
      const client = await manager.getAIClient({ userId: 'user123' });
      
      expect(mockAIFactory.getDefaultClient).toHaveBeenCalled();
      expect(client._type).toBe('default-client');
    });
    
    it('should handle errors and return default client', async () => {
      const error = new Error('Client creation failed');
      mockAIFactory.createAuthenticatedClient.mockImplementationOnce(() => { throw error; });
      mockUserTokenManager.getUserToken.mockReturnValueOnce('user-token');
      
      const client = await manager.getAIClient({ userId: 'user123' });
      
      expect(logger.error).toHaveBeenCalledWith('[AuthManager] Error getting AI client:', error);
      expect(mockAIFactory.getDefaultClient).toHaveBeenCalled();
      expect(client._type).toBe('default-client');
    });
  });
  
  describe('validation methods', () => {
    it('should validate personality access', async () => {
      const options = { userId: 'user123', personality: 'TestBot' };
      const result = await manager.validatePersonalityAccess(options);
      
      expect(mockAuthValidator.validateAccess).toHaveBeenCalledWith(options);
      expect(result).toEqual({ authorized: false, reason: 'token_required' });
    });
    
    it('should get user auth status', () => {
      const userId = 'user123';
      const status = manager.getUserAuthStatus(userId);
      
      expect(mockAuthValidator.getUserAuthStatus).toHaveBeenCalledWith(userId);
      expect(status).toEqual({ hasToken: false, isVerified: false });
    });
    
    it('should get auth help message', () => {
      const validationResult = { authorized: false, reason: 'token_required' };
      const message = manager.getAuthHelpMessage(validationResult);
      
      expect(mockAuthValidator.getAuthHelpMessage).toHaveBeenCalledWith(validationResult);
      expect(message).toBe('Please authenticate');
    });
  });
  
  describe('status checks', () => {
    it('should check if user has valid token', () => {
      mockUserTokenManager.hasValidToken.mockReturnValueOnce(true);
      
      expect(manager.hasValidToken('user123')).toBe(true);
      expect(mockUserTokenManager.hasValidToken).toHaveBeenCalledWith('user123');
    });
    
    it('should check if user is NSFW verified', () => {
      mockNsfwManager.isVerified.mockReturnValueOnce(true);
      
      expect(manager.isNsfwVerified('user123')).toBe(true);
      expect(mockNsfwManager.isVerified).toHaveBeenCalledWith('user123');
    });
    
    it('should get token info', () => {
      const userId = 'user123';
      const info = manager.getTokenExpirationInfo(userId);
      
      expect(mockUserTokenManager.getTokenExpirationInfo).toHaveBeenCalledWith(userId);
      expect(info).toEqual({ daysUntilExpiration: 20, percentRemaining: 66 });
    });
    
    it('should get user token', () => {
      mockUserTokenManager.getUserToken.mockReturnValueOnce('token123');
      
      expect(manager.getUserToken('user123')).toBe('token123');
    });
    
    it('should get token age', () => {
      expect(manager.getTokenAge('user123')).toBe(10);
      expect(mockUserTokenManager.getTokenAge).toHaveBeenCalledWith('user123');
    });
  });
  
  describe('shutdown', () => {
    it('should clear interval and save data', async () => {
      await manager.initialize();
      
      const clearIntervalSpy = jest.spyOn(global, 'clearInterval');
      
      await manager.shutdown();
      
      expect(clearIntervalSpy).toHaveBeenCalledWith(manager.cleanupInterval);
      expect(manager.cleanupInterval).toBeNull();
      expect(mockPersistence.saveUserTokens).toHaveBeenCalled();
      expect(mockPersistence.saveNsfwVerifications).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith('[AuthManager] Auth system shut down');
    });
    
    it('should handle shutdown when not initialized', async () => {
      await manager.shutdown();
      
      expect(logger.info).toHaveBeenCalledWith('[AuthManager] Auth system shut down');
    });
  });
  
  describe('performScheduledCleanup', () => {
    it('should perform cleanup and save if tokens removed', async () => {
      mockUserTokenManager.cleanupExpiredTokens.mockReturnValueOnce(3);
      
      await manager.performScheduledCleanup();
      
      expect(mockPersistence.saveUserTokens).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith('[AuthManager] Scheduled cleanup removed 3 expired tokens');
    });
    
    it('should handle cleanup errors', async () => {
      const error = new Error('Cleanup failed');
      mockUserTokenManager.cleanupExpiredTokens.mockImplementationOnce(() => {
        throw error;
      });
      
      await manager.performScheduledCleanup();
      
      expect(logger.error).toHaveBeenCalledWith('[AuthManager] Error during scheduled cleanup:', error);
    });
  });
  
  describe('cleanupExpiredTokens', () => {
    it('should cleanup and save tokens', async () => {
      mockUserTokenManager.cleanupExpiredTokens.mockReturnValueOnce(2);
      
      const count = await manager.cleanupExpiredTokens();
      
      expect(count).toBe(2);
      expect(mockPersistence.saveUserTokens).toHaveBeenCalled();
    });
    
    it('should not save if no tokens cleaned', async () => {
      mockUserTokenManager.cleanupExpiredTokens.mockReturnValueOnce(0);
      
      const count = await manager.cleanupExpiredTokens();
      
      expect(count).toBe(0);
      expect(mockPersistence.saveUserTokens).not.toHaveBeenCalled();
    });
  });
  
  describe('getStatistics', () => {
    it('should return system statistics', async () => {
      const tokens = {
        user1: { token: 'token1' },
        user2: { token: 'token2' }
      };
      const verifications = {
        user1: { verified: true }
      };
      
      mockUserTokenManager.getAllTokens.mockReturnValueOnce(tokens);
      mockNsfwManager.getAllVerifications.mockReturnValueOnce(verifications);
      
      const stats = await manager.getStatistics();
      
      expect(stats).toEqual({
        tokens: {
          total: 2,
          expired: 0
        },
        verifications: {
          total: 1
        },
        aiClients: { cached: 0, hits: 0, misses: 0 },
        files: { tokens: { size: 0 }, verifications: { size: 0 } }
      });
    });
  });
});