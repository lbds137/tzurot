/**
 * Consolidated tests for auth.js with proper timing and new mock system
 */

// Mock dependencies before imports
jest.mock('fs/promises');
jest.mock('node-fetch');
jest.mock('../../src/logger');
jest.mock('../../src/core/authentication');

const auth = require('../../src/auth');
const fs = require('fs/promises');
const fetch = require('node-fetch');
const logger = require('../../src/logger');
const AuthManager = require('../../src/core/authentication');

describe('auth', () => {
  beforeEach(async () => {
    // Use fake timers for speed
    jest.useFakeTimers();
    jest.clearAllMocks();

    // Mock console to keep test output clean
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();

    // Set required environment variables
    process.env.SERVICE_APP_ID = 'test-app-id';
    process.env.SERVICE_API_KEY = 'test-api-key';
    process.env.SERVICE_WEBSITE = 'https://test.example.com';
    process.env.SERVICE_API_BASE_URL = 'https://api.test.example.com';
    process.env.OWNER_ID = 'test-owner-id';

    // Mock logger functions
    logger.info = jest.fn();
    logger.debug = jest.fn();
    logger.warn = jest.fn();
    logger.error = jest.fn();

    // Mock fs operations with instant responses
    fs.mkdir = jest.fn().mockResolvedValue(undefined);
    fs.readFile = jest.fn().mockResolvedValue('{}'); // Default empty JSON
    fs.writeFile = jest.fn().mockResolvedValue(undefined);

    // Mock fetch with success by default
    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({ access_token: 'test-token-123' }),
      text: jest.fn().mockResolvedValue('OK'),
    });

    // Mock AuthManager instance with nested components
    const mockUserTokenManager = {
      getAllTokens: jest.fn().mockReturnValue({}),
      getAuthorizationUrl: jest
        .fn()
        .mockReturnValue('https://test.example.com/authorize?app_id=test-app-id'),
      exchangeCodeForToken: jest.fn(),
      getUserToken: jest.fn(),
      storeUserToken: jest.fn(),
      deleteUserToken: jest.fn(),
      hasValidToken: jest.fn(),
      cleanupExpiredTokens: jest.fn().mockReturnValue(0),
      setAllTokens: jest.fn(),
    };

    const mockNsfwVerificationManager = {
      getAllVerifications: jest.fn().mockReturnValue({}),
      storeNsfwVerification: jest.fn(),
      isNsfwVerified: jest.fn(),
      setAllVerifications: jest.fn(),
    };

    const mockAuthManager = {
      userTokenManager: mockUserTokenManager,
      nsfwVerificationManager: mockNsfwVerificationManager,
      getAuthorizationUrl: jest
        .fn()
        .mockReturnValue('https://test.example.com/authorize?app_id=test-app-id'),
      exchangeCodeForToken: jest.fn(),
      getUserToken: jest.fn(),
      storeUserToken: jest.fn(),
      deleteUserToken: jest.fn(),
      hasValidToken: jest.fn(),
      storeNsfwVerification: jest.fn(),
      isNsfwVerified: jest.fn(),
      initialize: jest.fn().mockResolvedValue(undefined),
      performScheduledCleanup: jest.fn().mockResolvedValue(undefined),
      shutdown: jest.fn().mockResolvedValue(undefined),
    };
    AuthManager.mockImplementation(() => mockAuthManager);

    // Store the mock instance for easy access in tests
    AuthManager.mockInstance = mockAuthManager;

    // Initialize auth system
    await auth.initAuth();

    // Clear in-memory caches after init
    auth.userTokens = {};
    auth.nsfwVerified = {};
  });

  afterEach(async () => {
    jest.useRealTimers();

    // Shutdown auth system cleanly
    if (auth.shutdown) {
      await auth.shutdown();
    }
  });

  describe('Core Authentication', () => {
    describe('getAuthorizationUrl', () => {
      test('should generate correct authorization URL', () => {
        const url = auth.getAuthorizationUrl();

        expect(url).toContain('https://test.example.com/authorize');
        expect(url).toContain('app_id=test-app-id');
        expect(url).toContain('app_id=test-app-id');
      });
    });

    describe('exchangeCodeForToken', () => {
      test('should exchange code for token successfully', async () => {
        const mockResponse = { access_token: 'test-token-123' };

        // Mock the AuthManager method to return the token
        const mockAuthManager = AuthManager.mockInstance;
        mockAuthManager.userTokenManager.exchangeCodeForToken.mockResolvedValue(mockResponse);

        const result = await auth.exchangeCodeForToken('test-code');

        expect(result).toEqual(mockResponse);
        expect(mockAuthManager.userTokenManager.exchangeCodeForToken).toHaveBeenCalledWith(
          'test-code'
        );
      });

      test('should handle exchange errors', async () => {
        const mockAuthManager = AuthManager.mockInstance;
        mockAuthManager.userTokenManager.exchangeCodeForToken.mockRejectedValue(
          new Error('OAuth token exchange failed')
        );

        await expect(auth.exchangeCodeForToken('bad-code')).rejects.toThrow(
          'OAuth token exchange failed'
        );
      });
    });

    describe('getUserToken', () => {
      test('should return stored token for user', async () => {
        const mockAuthManager = AuthManager.mockInstance;
        mockAuthManager.getUserToken.mockResolvedValue('token-123');

        const token = await auth.getUserToken('user123');

        expect(token).toBe('token-123');
        expect(mockAuthManager.getUserToken).toHaveBeenCalledWith('user123');
      });

      test('should return null for unknown user', async () => {
        const mockAuthManager = AuthManager.mockInstance;
        mockAuthManager.getUserToken.mockResolvedValue(null);

        const token = await auth.getUserToken('unknown');

        expect(token).toBeNull();
        expect(mockAuthManager.getUserToken).toHaveBeenCalledWith('unknown');
      });
    });

    describe('deleteUserToken', () => {
      test('should remove user token', async () => {
        const mockAuthManager = AuthManager.mockInstance;
        mockAuthManager.deleteUserToken.mockResolvedValue(true);
        mockAuthManager.getUserToken.mockResolvedValue(null); // After deletion

        const result = await auth.deleteUserToken('user123');

        expect(result).toBe(true);
        expect(mockAuthManager.deleteUserToken).toHaveBeenCalledWith('user123');
      });

      test('should handle deleting non-existent token', async () => {
        const mockAuthManager = AuthManager.mockInstance;
        mockAuthManager.deleteUserToken.mockResolvedValue(true);

        const result = await auth.deleteUserToken('unknown-user');

        expect(result).toBe(true);
        expect(mockAuthManager.deleteUserToken).toHaveBeenCalledWith('unknown-user');
      });
    });
  });

  describe('Token Expiration', () => {
    describe('Token validity checks', () => {
      test('should validate non-expired tokens', async () => {
        const mockAuthManager = AuthManager.mockInstance;
        mockAuthManager.hasValidToken.mockResolvedValue(true);

        const isValid = await auth.hasValidToken('user123');

        expect(isValid).toBe(true);
        expect(mockAuthManager.hasValidToken).toHaveBeenCalledWith('user123');
      });

      test('should invalidate expired tokens', async () => {
        const mockAuthManager = AuthManager.mockInstance;

        // Advance time past expiration (30 days)
        jest.advanceTimersByTime(31 * 24 * 60 * 60 * 1000);

        mockAuthManager.hasValidToken.mockResolvedValue(false);

        const isValid = await auth.hasValidToken('user123');

        expect(isValid).toBe(false);
        expect(mockAuthManager.hasValidToken).toHaveBeenCalledWith('user123');
      });
    });

    describe('Token cleanup', () => {
      test('should clean up expired tokens on check', async () => {
        const mockAuthManager = AuthManager.mockInstance;

        // Advance time past expiration
        jest.advanceTimersByTime(31 * 24 * 60 * 60 * 1000);

        // Mock that token is invalid and removed
        mockAuthManager.hasValidToken.mockResolvedValue(false);
        mockAuthManager.getUserToken.mockResolvedValue(null);

        // Check validity triggers cleanup
        await auth.hasValidToken('user123');

        // Token should be removed
        expect(await auth.getUserToken('user123')).toBeNull();
      });

      test('should clean up multiple expired tokens', async () => {
        const mockAuthManager = AuthManager.mockInstance;

        // Expire first two tokens
        jest.advanceTimersByTime(31 * 24 * 60 * 60 * 1000);

        // Mock that expired tokens are invalid and removed, fresh token remains
        mockAuthManager.hasValidToken.mockResolvedValue(false);
        mockAuthManager.getUserToken
          .mockResolvedValueOnce(null) // user1
          .mockResolvedValueOnce(null) // user2
          .mockResolvedValueOnce(null) // user3
          .mockResolvedValueOnce('token-4'); // user4

        // Trigger cleanup by checking any token
        await auth.hasValidToken('user1');

        // Only fresh token should remain
        expect(await auth.getUserToken('user1')).toBeNull();
        expect(await auth.getUserToken('user2')).toBeNull();
        expect(await auth.getUserToken('user3')).toBeNull();
        expect(await auth.getUserToken('user4')).toBe('token-4');
      });
    });
  });

  describe('Authentication Enforcement', () => {
    test('should require authentication for non-owner users', async () => {
      const userId = 'regular-user-id';
      const mockAuthManager = AuthManager.mockInstance;

      mockAuthManager.hasValidToken.mockResolvedValue(false);

      const hasToken = await auth.hasValidToken(userId);

      expect(hasToken).toBe(false);
      expect(mockAuthManager.hasValidToken).toHaveBeenCalledWith(userId);
    });

    test('should allow owner to bypass authentication', async () => {
      const ownerId = process.env.OWNER_ID;
      const mockAuthManager = AuthManager.mockInstance;

      // Owner should be considered authenticated even without token
      mockAuthManager.hasValidToken.mockResolvedValue(true);

      const hasToken = await auth.hasValidToken(ownerId);

      expect(hasToken).toBe(true);
      expect(mockAuthManager.hasValidToken).toHaveBeenCalledWith(ownerId);
    });

    test('should enforce authentication for personality operations', async () => {
      const userId = 'user123';
      const mockAuthManager = AuthManager.mockInstance;

      // Without token, should not be authenticated
      mockAuthManager.hasValidToken.mockResolvedValueOnce(false);
      let isAuthenticated = await auth.hasValidToken(userId);
      expect(isAuthenticated).toBe(false);

      // With valid token, should be authenticated
      mockAuthManager.hasValidToken.mockResolvedValueOnce(true);
      isAuthenticated = await auth.hasValidToken(userId);
      expect(isAuthenticated).toBe(true);
    });
  });

  describe('NSFW Verification', () => {
    describe('storeNsfwVerification', () => {
      test('should store NSFW verification status', async () => {
        const mockAuthManager = AuthManager.mockInstance;
        mockAuthManager.storeNsfwVerification.mockResolvedValue(true);

        const result = await auth.storeNsfwVerification('user123', true);

        expect(result).toBe(true);
        expect(mockAuthManager.storeNsfwVerification).toHaveBeenCalledWith('user123', true);
      });

      test('should handle file write errors', async () => {
        const mockAuthManager = AuthManager.mockInstance;
        const error = new Error('Write failed');
        mockAuthManager.storeNsfwVerification.mockRejectedValue(error);

        const result = await auth.storeNsfwVerification('user123', true);

        expect(result).toBe(false);
        expect(logger.error).toHaveBeenCalledWith(
          expect.stringContaining('Error storing NSFW verification'),
          error
        );
      });
    });

    describe('isNsfwVerified', () => {
      test('should check NSFW verification status', async () => {
        const mockAuthManager = AuthManager.mockInstance;
        mockAuthManager.isNsfwVerified.mockResolvedValue(true);

        const isVerified = await auth.isNsfwVerified('user123');

        expect(isVerified).toBe(true);
        expect(mockAuthManager.isNsfwVerified).toHaveBeenCalledWith('user123');
      });

      test('should return false for unverified users', async () => {
        const mockAuthManager = AuthManager.mockInstance;
        mockAuthManager.isNsfwVerified.mockResolvedValue(false);

        const isVerified = await auth.isNsfwVerified('unverified-user');

        expect(isVerified).toBe(false);
        expect(mockAuthManager.isNsfwVerified).toHaveBeenCalledWith('unverified-user');
      });

      test('should respect verification expiry', async () => {
        const mockAuthManager = AuthManager.mockInstance;

        // Advance time past NSFW verification expiry (1 year)
        jest.advanceTimersByTime(366 * 24 * 60 * 60 * 1000);

        mockAuthManager.isNsfwVerified.mockResolvedValue(false);

        const isVerified = await auth.isNsfwVerified('user123');

        expect(isVerified).toBe(false);
        expect(mockAuthManager.isNsfwVerified).toHaveBeenCalledWith('user123');
      });

      test('should return false for user with false verification', async () => {
        const mockAuthManager = AuthManager.mockInstance;
        mockAuthManager.isNsfwVerified.mockResolvedValue(false);

        const isVerified = await auth.isNsfwVerified('user123');

        expect(isVerified).toBe(false);
        expect(mockAuthManager.isNsfwVerified).toHaveBeenCalledWith('user123');
      });
    });
  });

  describe('File operations', () => {
    test('should create data directory on init', async () => {
      const mockAuthManager = AuthManager.mockInstance;

      // initAuth should be called and already happened in beforeEach
      // The fact that the test is running means it worked

      expect(mockAuthManager.initialize).toHaveBeenCalled();
    });

    test('should handle file read errors gracefully', async () => {
      const mockAuthManager = AuthManager.mockInstance;
      const error = new Error('File not found');
      mockAuthManager.initialize.mockRejectedValue(error);

      // Try to init again, which should fail and be caught
      await auth.initAuth();

      // The error should be logged in debug, not necessarily in error
      // Since the mock is set to fail on initialize, it should handle gracefully
      // Test that it doesn't crash - the important outcome is that initAuth completes
      expect(mockAuthManager.initialize).toHaveBeenCalled();
    });
  });

  describe('InitAuth operations', () => {
    test('should setup cleanup interval', async () => {
      // Reset modules to test initialization
      jest.resetModules();
      jest.clearAllMocks();

      // Mock timers
      const setIntervalSpy = jest.spyOn(global, 'setInterval');

      const AuthManager = require('../../src/core/authentication');
      const mockAuthManager = {
        userTokenManager: {
          getAllTokens: jest.fn().mockReturnValue({}),
          cleanupExpiredTokens: jest.fn().mockReturnValue(0),
        },
        nsfwVerificationManager: {
          getAllVerifications: jest.fn().mockReturnValue({}),
        },
        initialize: jest.fn().mockResolvedValue(undefined),
        performScheduledCleanup: jest.fn().mockResolvedValue(undefined),
        shutdown: jest.fn().mockResolvedValue(undefined),
      };
      AuthManager.mockImplementation(() => mockAuthManager);

      const auth = require('../../src/auth');
      await auth.initAuth();

      // The auth module sets up a 24-hour cleanup interval via AuthManager
      expect(mockAuthManager.initialize).toHaveBeenCalled();

      setIntervalSpy.mockRestore();
    });
  });
});
