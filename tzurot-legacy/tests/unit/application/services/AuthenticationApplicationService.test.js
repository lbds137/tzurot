/**
 * Tests for AuthenticationApplicationService
 */

// Mock OpenAI before any imports
jest.mock('openai', () => {
  const MockOpenAI = jest.fn().mockImplementation(() => ({
    baseURL: 'https://mock-api.example.com/v1',
    apiKey: 'mocked-key',
    defaultHeaders: {}
  }));
  
  return {
    OpenAI: MockOpenAI
  };
});

const { AuthenticationApplicationService } = require('../../../../src/application/services/AuthenticationApplicationService');
const { UserAuth, Token } = require('../../../../src/domain/authentication');
const { UserId } = require('../../../../src/domain/personality');
const { AuthContext } = require('../../../../src/domain/authentication/AuthContext');
const {
  UserAuthenticated,
  UserTokenRefreshed,
  UserTokenExpired,
  AuthenticationDenied,
  UserNsfwVerified,
  UserNsfwVerificationCleared,
} = require('../../../../src/domain/authentication/AuthenticationEvents');

describe('AuthenticationApplicationService', () => {
  let authService;
  let mockAuthRepository;
  let mockTokenService;
  let mockEventBus;
  let mockConfig;

  beforeEach(() => {
    // Mock environment variables
    jest.clearAllMocks();
    process.env.BOT_OWNER_ID = '987654321098765432';
    process.env.SERVICE_API_BASE_URL = 'https://mock-api.example.com';
    
    // Mock repository
    mockAuthRepository = {
      save: jest.fn(),
      findByUserId: jest.fn(),
      findBlacklisted: jest.fn().mockResolvedValue([]),
      findExpiredTokens: jest.fn().mockResolvedValue([]),
      delete: jest.fn(),
      countAuthenticated: jest.fn().mockResolvedValue(0),
    };

    // Mock token service
    mockTokenService = {
      getAuthorizationUrl: jest.fn(),
      exchangeCode: jest.fn(),
      exchangeToken: jest.fn(),
      validateToken: jest.fn(),
      refreshToken: jest.fn(),
      revokeToken: jest.fn(),
    };

    // Mock event bus
    mockEventBus = {
      publish: jest.fn().mockResolvedValue(undefined),
    };

    // Mock config
    mockConfig = {
      ownerId: '987654321098765432',
      tokenExpirationMs: 30 * 24 * 60 * 60 * 1000,
      nsfwVerificationExpiryMs: 24 * 60 * 60 * 1000,
    };

    // Create service instance
    authService = new AuthenticationApplicationService({
      authenticationRepository: mockAuthRepository,
      tokenService: mockTokenService,
      eventBus: mockEventBus,
      config: mockConfig,
    });
  });

  describe('constructor', () => {
    it('should require authenticationRepository', () => {
      expect(() => {
        new AuthenticationApplicationService({
          tokenService: mockTokenService,
        });
      }).toThrow('authenticationRepository is required');
    });

    it('should require tokenService', () => {
      expect(() => {
        new AuthenticationApplicationService({
          authenticationRepository: mockAuthRepository,
        });
      }).toThrow('tokenService is required');
    });

    it('should use default config values', () => {
      const service = new AuthenticationApplicationService({
        authenticationRepository: mockAuthRepository,
        tokenService: mockTokenService,
      });

      expect(service.config.ownerId).toBe('987654321098765432'); // Use mocked value
      // Token expiry and NSFW verification expiry are now handled by the AI service
    });
  });

  describe('getAuthorizationUrl', () => {
    it('should delegate to token service', async () => {
      const expectedUrl = 'https://example.com/oauth?state=abc123';
      mockTokenService.getAuthorizationUrl.mockResolvedValue(expectedUrl);

      const url = await authService.getAuthorizationUrl('abc123');

      expect(url).toBe(expectedUrl);
      expect(mockTokenService.getAuthorizationUrl).toHaveBeenCalledWith('abc123');
    });

    it('should handle errors', async () => {
      const error = new Error('Service unavailable');
      mockTokenService.getAuthorizationUrl.mockRejectedValue(error);

      await expect(authService.getAuthorizationUrl('abc123')).rejects.toThrow('Service unavailable');
    });
  });

  describe('exchangeCodeForToken', () => {
    const discordUserId = '123456789012345678';
    const code = 'oauth_code_123';

    it('should create new authenticated user', async () => {
      // No existing user
      mockAuthRepository.findByUserId.mockResolvedValue(null);

      // Successful token exchange
      const tokenData = {
        token: 'new_token_123',
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      };
      mockTokenService.exchangeCode.mockResolvedValue(tokenData);

      const result = await authService.exchangeCodeForToken(discordUserId, code);

      expect(result.token).toBe('new_token_123');
      expect(result.user).toBeDefined();
      expect(result.user.userId.value).toBe(discordUserId);
      expect(result.user.isAuthenticated()).toBe(true);

      // Verify save was called
      expect(mockAuthRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: expect.objectContaining({ value: discordUserId }),
        })
      );

      // Verify event was published
      expect(mockEventBus.publish).toHaveBeenCalledWith(
        expect.any(UserAuthenticated)
      );
    });

    it('should refresh token for existing user', async () => {
      // Existing user
      const existingUser = UserAuth.createAuthenticated(
        new UserId(discordUserId),
        new Token('old_token', new Date(Date.now() + 1000))
      );
      mockAuthRepository.findByUserId.mockResolvedValue(existingUser);

      // Successful token exchange
      const tokenData = {
        token: 'refreshed_token_123',
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      };
      mockTokenService.exchangeCode.mockResolvedValue(tokenData);

      const result = await authService.exchangeCodeForToken(discordUserId, code);

      expect(result.token).toBe('refreshed_token_123');
      expect(result.user.token.value).toBe('refreshed_token_123');

      // Verify save was called
      expect(mockAuthRepository.save).toHaveBeenCalled();

      // Verify refresh event was published
      expect(mockEventBus.publish).toHaveBeenCalledWith(
        expect.any(UserTokenRefreshed)
      );
    });

    it('should handle token exchange failure', async () => {
      mockAuthRepository.findByUserId.mockResolvedValue(null);
      mockTokenService.exchangeCode.mockResolvedValue({ token: null });

      await expect(authService.exchangeCodeForToken(discordUserId, code))
        .rejects.toThrow('Failed to exchange code for token');

      // Verify denial event was published
      expect(mockEventBus.publish).toHaveBeenCalledWith(
        expect.any(AuthenticationDenied)
      );
    });

    it('should handle service errors', async () => {
      const error = new Error('OAuth service error');
      mockTokenService.exchangeCode.mockRejectedValue(error);

      await expect(authService.exchangeCodeForToken(discordUserId, code))
        .rejects.toThrow('OAuth service error');

      // Verify denial event was published
      expect(mockEventBus.publish).toHaveBeenCalledWith(
        expect.any(AuthenticationDenied)
      );
    });
  });

  describe('getAuthenticationStatus', () => {
    const discordUserId = '123456789012345678';

    it('should return unauthenticated for non-existent user', async () => {
      mockAuthRepository.findByUserId.mockResolvedValue(null);

      const result = await authService.getAuthenticationStatus(discordUserId);

      expect(result.isAuthenticated).toBe(false);
      expect(result.user).toBeNull();
    });

    it('should return authenticated for valid user', async () => {
      const user = UserAuth.createAuthenticated(
        new UserId(discordUserId),
        new Token('valid_token', new Date(Date.now() + 1000000))
      );
      mockAuthRepository.findByUserId.mockResolvedValue(user);

      const result = await authService.getAuthenticationStatus(discordUserId);

      expect(result.isAuthenticated).toBe(true);
      expect(result.user).toBe(user);
    });

    it('should handle expired tokens', async () => {
      const user = UserAuth.createAuthenticated(
        new UserId(discordUserId),
        new Token('valid_token', new Date(Date.now() + 1000))
      );
      // Manually expire the token for testing
      user.expireToken();
      mockAuthRepository.findByUserId.mockResolvedValue(user);

      const result = await authService.getAuthenticationStatus(discordUserId);

      expect(result.isAuthenticated).toBe(false);
      expect(result.user).toBe(user);

      // getAuthenticationStatus is a query method - it doesn't publish events
      // Events are only published when state changes, not when querying state
    });
  });

  describe('refreshUserToken', () => {
    const discordUserId = '123456789012345678';

    it('should refresh existing token', async () => {
      const user = UserAuth.createAuthenticated(
        new UserId(discordUserId),
        new Token('old_token', new Date(Date.now() + 1000))
      );
      mockAuthRepository.findByUserId.mockResolvedValue(user);

      const refreshedTokenData = {
        token: 'new_token',
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      };
      mockTokenService.refreshToken.mockResolvedValue(refreshedTokenData);

      const result = await authService.refreshUserToken(discordUserId);

      expect(result.token).toBe('new_token');
      expect(result.user.token.value).toBe('new_token');
      expect(mockAuthRepository.save).toHaveBeenCalled();
      expect(mockEventBus.publish).toHaveBeenCalledWith(
        expect.any(UserTokenRefreshed)
      );
    });

    it('should handle non-existent user', async () => {
      mockAuthRepository.findByUserId.mockResolvedValue(null);

      await expect(authService.refreshUserToken(discordUserId))
        .rejects.toThrow('User not authenticated');
    });

    it('should handle user without token', async () => {
      const user = UserAuth.createAuthenticated(
        new UserId(discordUserId),
        new Token('valid_token', new Date(Date.now() + 1000000))
      );
      // Expire the token so user has no valid token
      user.expireToken();
      mockAuthRepository.findByUserId.mockResolvedValue(user);

      await expect(authService.refreshUserToken(discordUserId))
        .rejects.toThrow('No token to refresh');
    });

    it('should handle refresh failure', async () => {
      const user = UserAuth.createAuthenticated(
        new UserId(discordUserId),
        new Token('old_token', new Date(Date.now() + 1000))
      );
      mockAuthRepository.findByUserId.mockResolvedValue(user);
      mockTokenService.refreshToken.mockResolvedValue({ token: null });

      await expect(authService.refreshUserToken(discordUserId))
        .rejects.toThrow('Failed to refresh token');
    });
  });

  describe('revokeAuthentication', () => {
    const discordUserId = '123456789012345678';

    it('should revoke active token', async () => {
      const user = UserAuth.createAuthenticated(
        new UserId(discordUserId),
        new Token('active_token', new Date(Date.now() + 1000000))
      );
      mockAuthRepository.findByUserId.mockResolvedValue(user);

      await authService.revokeAuthentication(discordUserId);

      expect(mockTokenService.revokeToken).toHaveBeenCalledWith('active_token');
      expect(mockAuthRepository.save).toHaveBeenCalled();
      expect(user.token).toBeNull();
      expect(mockEventBus.publish).toHaveBeenCalledWith(
        expect.any(UserTokenExpired)
      );
    });

    it('should handle already expired token', async () => {
      const user = UserAuth.createAuthenticated(
        new UserId(discordUserId),
        new Token('valid_token', new Date(Date.now() + 1000))
      );
      // Manually expire the token
      user.expireToken();
      mockAuthRepository.findByUserId.mockResolvedValue(user);

      await authService.revokeAuthentication(discordUserId);

      expect(mockTokenService.revokeToken).not.toHaveBeenCalled();
      expect(mockAuthRepository.save).toHaveBeenCalled();
    });

    it('should handle non-existent user gracefully', async () => {
      mockAuthRepository.findByUserId.mockResolvedValue(null);

      await expect(authService.revokeAuthentication(discordUserId)).resolves.not.toThrow();
    });
  });

  describe('verifyNsfwAccess', () => {
    const discordUserId = '123456789012345678';

    it('should verify NSFW for existing user', async () => {
      const user = UserAuth.createAuthenticated(
        new UserId(discordUserId),
        new Token('valid_token', new Date(Date.now() + 1000000))
      );
      mockAuthRepository.findByUserId.mockResolvedValue(user);

      await authService.verifyNsfwAccess(discordUserId);

      expect(user.nsfwStatus.verified).toBe(true);
      expect(mockAuthRepository.save).toHaveBeenCalled();
      expect(mockEventBus.publish).toHaveBeenCalledWith(
        expect.any(UserNsfwVerified)
      );
    });

    it('should reject NSFW verification for non-existent user', async () => {
      mockAuthRepository.findByUserId.mockResolvedValue(null);

      await expect(authService.verifyNsfwAccess(discordUserId))
        .rejects.toThrow('User must be authenticated to verify NSFW access');

      expect(mockAuthRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('clearNsfwVerification', () => {
    const discordUserId = '123456789012345678';

    it('should clear verification for verified user', async () => {
      const user = UserAuth.createAuthenticated(
        new UserId(discordUserId),
        new Token('valid_token', new Date(Date.now() + 1000000))
      );
      user.verifyNsfw();
      mockAuthRepository.findByUserId.mockResolvedValue(user);

      const result = await authService.clearNsfwVerification(discordUserId);

      expect(result).toBe(true);
      expect(user.nsfwStatus.verified).toBe(false);
      expect(mockAuthRepository.save).toHaveBeenCalled();
      expect(mockEventBus.publish).toHaveBeenCalledWith(
        expect.any(UserNsfwVerificationCleared)
      );
    });

    it('should return false for non-verified user', async () => {
      const user = UserAuth.createAuthenticated(
        new UserId(discordUserId),
        new Token('valid_token', new Date(Date.now() + 1000000))
      );
      mockAuthRepository.findByUserId.mockResolvedValue(user);

      const result = await authService.clearNsfwVerification(discordUserId);

      expect(result).toBe(false);
      expect(mockAuthRepository.save).not.toHaveBeenCalled();
    });

    it('should return false for non-existent user', async () => {
      mockAuthRepository.findByUserId.mockResolvedValue(null);

      const result = await authService.clearNsfwVerification(discordUserId);

      expect(result).toBe(false);
    });
  });

  describe('checkPersonalityAccess', () => {
    const discordUserId = '123456789012345678';
    const personality = {
      name: 'TestBot',
      config: { requiresAuth: false },
      profile: { nsfw: false },
    };
    const context = new AuthContext({
      channelType: 'GUILD',
      channelId: 'channel123',
      isNsfwChannel: true, // Use NSFW channel to test other logic without NSFW blocking
      isProxyMessage: false,
    });

    it('should allow owner access to any personality', async () => {
      const result = await authService.checkPersonalityAccess('987654321098765432', personality, context);

      expect(result.allowed).toBe(true);
      expect(mockAuthRepository.findByUserId).not.toHaveBeenCalled();
    });

    it('should check auth requirement', async () => {
      const authPersonality = { ...personality, config: { requiresAuth: true } };
      mockAuthRepository.findByUserId.mockResolvedValue(null);

      const result = await authService.checkPersonalityAccess(discordUserId, authPersonality, context);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('authentication');
    });

    it('should check NSFW requirement', async () => {
      const nsfwPersonality = { ...personality, profile: { nsfw: true } };
      // Test in DM where NSFW verification is required
      const dmContext = new AuthContext({
        channelType: 'DM',
        channelId: 'dm123',
        isNsfwChannel: false,
        isProxyMessage: false,
      });

      const user = UserAuth.createAuthenticated(
        new UserId(discordUserId),
        new Token('valid_token', new Date(Date.now() + 1000000))
      );
      // User is not NSFW verified
      mockAuthRepository.findByUserId.mockResolvedValue(user);

      const result = await authService.checkPersonalityAccess(discordUserId, nsfwPersonality, dmContext);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('NSFW');
    });


    it('should allow access when all checks pass', async () => {
      const user = UserAuth.createAuthenticated(
        new UserId(discordUserId),
        new Token('valid_token', new Date(Date.now() + 1000000))
      );
      user.verifyNsfw();
      mockAuthRepository.findByUserId.mockResolvedValue(user);

      const result = await authService.checkPersonalityAccess(discordUserId, personality, context);

      expect(result.allowed).toBe(true);
    });
  });

  describe('cleanupExpiredTokens', () => {
    it('should clean up expired tokens', async () => {
      // Create users with valid tokens first
      const user1 = UserAuth.createAuthenticated(
        new UserId('111111111111111111'),
        new Token('token1', new Date(Date.now() + 1000))
      );
      const user2 = UserAuth.createAuthenticated(
        new UserId('222222222222222222'),
        new Token('token2', new Date(Date.now() + 1000))
      );
      // Expire them manually
      user1.expireToken();
      user2.expireToken();
      const expiredUsers = [user1, user2];
      mockAuthRepository.findExpiredTokens.mockResolvedValue(expiredUsers);

      const count = await authService.cleanupExpiredTokens();

      expect(count).toBe(2);
      expect(mockAuthRepository.save).toHaveBeenCalledTimes(2);
      expect(mockEventBus.publish).toHaveBeenCalledTimes(2);
    });

    it('should handle empty result', async () => {
      mockAuthRepository.findExpiredTokens.mockResolvedValue([]);

      const count = await authService.cleanupExpiredTokens();

      expect(count).toBe(0);
      expect(mockAuthRepository.save).not.toHaveBeenCalled();
    });

    it('should handle errors', async () => {
      mockAuthRepository.findExpiredTokens.mockRejectedValue(new Error('DB error'));

      await expect(authService.cleanupExpiredTokens()).rejects.toThrow('DB error');
    });
  });

  describe('getStatistics', () => {
    it('should return authentication statistics', async () => {
      mockAuthRepository.countAuthenticated.mockResolvedValue(10);
      mockAuthRepository.findBlacklisted.mockResolvedValue([{}, {}, {}]);
      mockAuthRepository.findExpiredTokens.mockResolvedValue([{}, {}]);

      const stats = await authService.getStatistics();

      expect(stats).toEqual({
        totalAuthenticated: 10,
        blacklistedCount: 3,
        expiredTokensCount: 2,
        timestamp: expect.any(Date),
      });
    });

    it('should handle errors', async () => {
      mockAuthRepository.countAuthenticated.mockRejectedValue(new Error('DB error'));

      await expect(authService.getStatistics()).rejects.toThrow('DB error');
    });
  });

  describe('createAIClient', () => {
    it('should create AI client for authenticated user', async () => {
      const user = UserAuth.createAuthenticated(
        new UserId('123456789012345678'),
        new Token('token', new Date(Date.now() + 1000000))
      );
      mockAuthRepository.findByUserId.mockResolvedValue(user);

      const client = await authService.createAIClient('123456789012345678');
      
      // Test that the client is configured correctly by checking its behavior
      expect(client).toBeDefined();
      expect(client.baseURL).toBe('https://mock-api.example.com/v1'); // Use mocked value
    });

    it('should require authenticated user', async () => {
      mockAuthRepository.findByUserId.mockResolvedValue(null);

      await expect(authService.createAIClient('123456789012345678'))
        .rejects.toThrow('User not authenticated');
    });
  });

});