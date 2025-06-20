/**
 * Tests for UserTokenManager
 */

const UserTokenManager = require('../../../../src/core/authentication/UserTokenManager');

// Mock node-fetch
const mockFetch = jest.fn();
jest.mock('node-fetch', () => mockFetch);

jest.mock('../../../../src/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
}));

describe('UserTokenManager', () => {
  let manager;
  let logger;
  const appId = 'test-app-id';
  const apiKey = 'test-api-key';
  const authApiEndpoint = 'https://api.example.com/auth';
  const authWebsite = 'https://auth.example.com';

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    manager = new UserTokenManager(appId, apiKey, authApiEndpoint, authWebsite);
    logger = require('../../../../src/logger');
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('Constructor', () => {
    it('should initialize with provided configuration', () => {
      expect(manager.appId).toBe(appId);
      expect(manager.apiKey).toBe(apiKey);
      expect(manager.authApiEndpoint).toBe(authApiEndpoint);
      expect(manager.authWebsite).toBe(authWebsite);
      expect(manager.userTokens).toEqual({});
      expect(manager.tokenExpirationMs).toBe(30 * 24 * 60 * 60 * 1000);
    });
  });

  describe('getAuthorizationUrl', () => {
    it('should return correctly formatted authorization URL', () => {
      const url = manager.getAuthorizationUrl();

      expect(url).toBe(`${authWebsite}/authorize?app_id=${appId}`);
    });
  });

  describe('exchangeCodeForToken', () => {
    it('should successfully exchange code for token', async () => {
      const code = 'auth-code-123';
      const responseToken = 'user-token-456';

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ auth_token: responseToken }),
      });

      const token = await manager.exchangeCodeForToken(code);

      expect(token).toBe(responseToken);
      expect(mockFetch).toHaveBeenCalledWith(`${authApiEndpoint}/nonce`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ app_id: appId, code }),
      });
      expect(logger.info).toHaveBeenCalledWith(
        '[UserTokenManager] Successfully exchanged code for token'
      );
    });

    it('should handle failed exchange with error message', async () => {
      const code = 'invalid-code';

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
      });

      const token = await manager.exchangeCodeForToken(code);

      expect(token).toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        '[UserTokenManager] Failed to exchange code for token: 400 Bad Request'
      );
    });

    it('should handle network errors', async () => {
      const code = 'auth-code';
      const error = new Error('Network error');

      mockFetch.mockRejectedValueOnce(error);

      const token = await manager.exchangeCodeForToken(code);

      expect(token).toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        '[UserTokenManager] Error exchanging code for token:',
        error
      );
    });
  });

  describe('storeUserToken', () => {
    it('should store token with expiration date', () => {
      const userId = 'user123';
      const token = 'token123';
      const now = Date.now();

      manager.storeUserToken(userId, token);

      expect(manager.userTokens[userId]).toEqual({
        token: token,
        createdAt: now,
        expiresAt: now + manager.tokenExpirationMs,
      });
      expect(logger.debug).toHaveBeenCalledWith(
        `[UserTokenManager] Stored token for user ${userId}`
      );
    });
  });

  describe('getUserToken', () => {
    it('should return token for existing user', () => {
      const userId = 'user123';
      const token = 'token123';

      manager.storeUserToken(userId, token);

      expect(manager.getUserToken(userId)).toBe(token);
    });

    it('should return null for non-existent user', () => {
      expect(manager.getUserToken('nonexistent')).toBeNull();
    });
  });

  describe('hasValidToken', () => {
    it('should return true for valid unexpired token', () => {
      const userId = 'user123';

      manager.storeUserToken(userId, 'token123');

      expect(manager.hasValidToken(userId)).toBe(true);
    });

    it('should return false for expired token', () => {
      const userId = 'user123';
      const expiredTime = Date.now() - 31 * 24 * 60 * 60 * 1000;

      manager.userTokens[userId] = {
        token: 'expired-token',
        createdAt: expiredTime,
        expiresAt: expiredTime + manager.tokenExpirationMs,
      };

      expect(manager.hasValidToken(userId)).toBe(false);
    });

    it('should return false for non-existent user', () => {
      expect(manager.hasValidToken('nonexistent')).toBe(false);
    });

    it('should handle old format tokens without expiresAt', () => {
      const userId = 'user123';

      manager.userTokens[userId] = {
        token: 'old-token',
        createdAt: Date.now() - 10 * 24 * 60 * 60 * 1000,
        // No expiresAt field
      };

      // Old tokens without expiration are considered valid
      expect(manager.hasValidToken(userId)).toBe(true);
    });
  });

  describe('deleteUserToken', () => {
    it('should delete existing token', () => {
      const userId = 'user123';

      manager.storeUserToken(userId, 'token123');
      expect(manager.userTokens[userId]).toBeDefined();

      const result = manager.deleteUserToken(userId);

      expect(result).toBe(true);
      expect(manager.userTokens[userId]).toBeUndefined();
      expect(logger.debug).toHaveBeenCalledWith(
        `[UserTokenManager] Deleted token for user ${userId}`
      );
    });

    it('should return true for non-existent token', () => {
      const result = manager.deleteUserToken('nonexistent');

      expect(result).toBe(true);
      // No warning is logged - this is treated as a successful no-op
      expect(logger.info).not.toHaveBeenCalled();
    });
  });

  describe('getTokenAge', () => {
    it('should calculate token age in days', () => {
      const userId = 'user123';
      const tenDaysAgo = Date.now() - 10 * 24 * 60 * 60 * 1000;

      manager.userTokens[userId] = {
        token: 'token',
        createdAt: tenDaysAgo,
        expiresAt: tenDaysAgo + manager.tokenExpirationMs,
      };

      expect(manager.getTokenAge(userId)).toBe(10);
    });

    it('should return null for non-existent user', () => {
      expect(manager.getTokenAge('nonexistent')).toBeNull();
    });

    it('should return null for token without createdAt', () => {
      const userId = 'user123';

      manager.userTokens[userId] = {
        token: 'token',
        expiresAt: Date.now() + 1000,
        // No createdAt
      };

      expect(manager.getTokenAge(userId)).toBeNull();
    });
  });

  describe('getTokenExpirationInfo', () => {
    it('should return expiration info for valid token', () => {
      const userId = 'user123';
      const now = Date.now();
      const createdAt = now - 29 * 24 * 60 * 60 * 1000; // 29 days ago
      const expiresAt = now + 1 * 24 * 60 * 60 * 1000; // 1 day left

      manager.userTokens[userId] = {
        token: 'token',
        createdAt: createdAt,
        expiresAt: expiresAt,
      };

      const info = manager.getTokenExpirationInfo(userId);

      expect(info).toEqual({
        daysUntilExpiration: 1,
        percentRemaining: 3, // ~3% of 30 days
      });
    });

    it('should return null for token without expiresAt', () => {
      const userId = 'user123';

      manager.userTokens[userId] = {
        token: 'token',
        createdAt: Date.now(),
        // No expiresAt
      };

      expect(manager.getTokenExpirationInfo(userId)).toBeNull();
    });

    it('should handle expired tokens', () => {
      const userId = 'user123';
      const now = Date.now();

      manager.userTokens[userId] = {
        token: 'token',
        createdAt: now - 35 * 24 * 60 * 60 * 1000,
        expiresAt: now - 5 * 24 * 60 * 60 * 1000, // Expired 5 days ago
      };

      const info = manager.getTokenExpirationInfo(userId);

      expect(info).toEqual({
        daysUntilExpiration: 0,
        percentRemaining: 0,
      });
    });
  });

  describe('cleanupExpiredTokens', () => {
    it('should remove expired tokens', () => {
      const now = Date.now();

      manager.userTokens = {
        valid: {
          token: 'valid',
          createdAt: now,
          expiresAt: now + 10 * 24 * 60 * 60 * 1000,
        },
        expired1: {
          token: 'expired1',
          createdAt: now - 40 * 24 * 60 * 60 * 1000,
          expiresAt: now - 10 * 24 * 60 * 60 * 1000,
        },
        expired2: {
          token: 'expired2',
          createdAt: now - 35 * 24 * 60 * 60 * 1000,
          expiresAt: now - 5 * 24 * 60 * 60 * 1000,
        },
        noExpiry: {
          token: 'noexpiry',
          createdAt: now - 100 * 24 * 60 * 60 * 1000,
          // No expiresAt - should not be removed
        },
      };

      const removed = manager.cleanupExpiredTokens();

      expect(removed).toBe(2);
      expect(manager.userTokens.valid).toBeDefined();
      expect(manager.userTokens.expired1).toBeUndefined();
      expect(manager.userTokens.expired2).toBeUndefined();
      expect(manager.userTokens.noExpiry).toBeDefined();
      expect(logger.info).toHaveBeenCalledWith('[UserTokenManager] Cleaned up 2 expired tokens');
    });

    it('should handle no expired tokens', () => {
      const now = Date.now();

      manager.userTokens = {
        user1: {
          token: 'token1',
          createdAt: now,
          expiresAt: now + 10 * 24 * 60 * 60 * 1000,
        },
      };

      const removed = manager.cleanupExpiredTokens();

      expect(removed).toBe(0);
      expect(logger.debug).toHaveBeenCalledWith(
        '[UserTokenManager] No expired tokens found during cleanup'
      );
    });
  });

  describe('getAllTokens', () => {
    it('should return all tokens', () => {
      manager.storeUserToken('user1', 'token1');
      manager.storeUserToken('user2', 'token2');

      const all = manager.getAllTokens();

      expect(Object.keys(all)).toHaveLength(2);
      expect(all.user1.token).toBe('token1');
      expect(all.user2.token).toBe('token2');
    });
  });

  describe('setAllTokens', () => {
    it('should set all tokens and migrate old format', () => {
      const now = Date.now();
      const tokens = {
        user1: {
          token: 'token1',
          createdAt: now,
          expiresAt: now + 10 * 24 * 60 * 60 * 1000,
        },
        user2: {
          token: 'token2',
          createdAt: now - 5 * 24 * 60 * 60 * 1000,
          // No expiresAt - should be migrated
        },
      };

      manager.setAllTokens(tokens);

      expect(manager.userTokens.user1.expiresAt).toBe(tokens.user1.expiresAt);
      expect(manager.userTokens.user2.expiresAt).toBe(
        tokens.user2.createdAt + manager.tokenExpirationMs
      );
      expect(logger.info).toHaveBeenCalledWith(
        '[UserTokenManager] Updated 1 tokens with expiration dates'
      );
    });

    it('should handle null/undefined tokens', () => {
      manager.storeUserToken('user1', 'token1');

      manager.setAllTokens(null);
      expect(manager.userTokens).toEqual({});

      manager.storeUserToken('user1', 'token1');

      manager.setAllTokens(undefined);
      expect(manager.userTokens).toEqual({});
    });
  });
});
