/**
 * Tests for Authentication Anti-Corruption Layer
 * Focus on shadow mode and legacy bridging
 */

// Unmock since we're testing it directly
jest.unmock('../../../../src/application/services/AuthenticationAntiCorruptionLayer');

// Mock dependencies
jest.mock('../../../../src/logger');
jest.mock('../../../../src/domain/authentication/AuthContext');

const { AuthenticationAntiCorruptionLayer } = require('../../../../src/application/services/AuthenticationAntiCorruptionLayer');
const logger = require('../../../../src/logger');
const { AuthContext } = require('../../../../src/domain/authentication/AuthContext');

describe('AuthenticationAntiCorruptionLayer', () => {
  let mockLegacyAuthManager;
  let mockAuthApplicationService;
  let acl;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Reset logger mocks
    logger.info.mockClear();
    logger.warn.mockClear();
    logger.error.mockClear();

    // Mock legacy auth manager
    mockLegacyAuthManager = {
      initialize: jest.fn().mockResolvedValue(undefined),
      getAuthorizationUrl: jest.fn().mockResolvedValue('https://legacy.auth/url'),
      handleOAuthCallback: jest.fn().mockResolvedValue({ success: true, message: 'Legacy auth success' }),
      isUserAuthenticated: jest.fn().mockReturnValue(true),
      getUserToken: jest.fn().mockReturnValue('legacy-token'),
      storeUserToken: jest.fn().mockResolvedValue(true),
      deleteUserToken: jest.fn().mockResolvedValue(true),
      hasValidToken: jest.fn().mockReturnValue(true),
      getTokenAge: jest.fn().mockReturnValue('3 days'),
      getTokenExpirationInfo: jest.fn().mockReturnValue({ expiresIn: 27, unit: 'days' }),
      getTokenFromCode: jest.fn().mockResolvedValue('token-from-code'),
      revokeUserAuth: jest.fn().mockResolvedValue({ success: true, message: 'Revoked' }),
      cleanupExpiredTokens: jest.fn().mockResolvedValue(5),
      userTokenManager: {
        getAllTokens: jest.fn().mockReturnValue(new Map([['user1', 'token1'], ['user2', 'token2']])),
      },
      nsfwVerificationManager: {
        verifyUser: jest.fn(),
        isUserVerified: jest.fn().mockReturnValue(true),
        verifications: new Map([['user1', true]]),
      },
      personalityAuthValidator: {
        validateAccess: jest.fn().mockResolvedValue({
          allowed: true,
          requiresAuth: false,
          requiresNsfwVerification: false,
        }),
      },
      aiClientFactory: {
        createUserClient: jest.fn().mockResolvedValue({ type: 'ai-client' }),
      },
    };

    // Mock DDD auth application service
    mockAuthApplicationService = {
      getAuthorizationUrl: jest.fn().mockResolvedValue('https://ddd.auth/url'),
      exchangeCodeForToken: jest.fn().mockResolvedValue({ token: 'ddd-token', expiresAt: new Date() }),
      getAuthenticationStatus: jest.fn().mockResolvedValue({
        isAuthenticated: true,
        user: {
          id: { value: '123456789012345678' },
          nsfwStatus: { verified: true },
        },
      }),
      checkPersonalityAccess: jest.fn().mockResolvedValue({
        allowed: true,
        reason: null,
      }),
      verifyNsfwAccess: jest.fn().mockResolvedValue(undefined),
      revokeAuthentication: jest.fn().mockResolvedValue(undefined),
      cleanupExpiredTokens: jest.fn().mockResolvedValue(5),
      getStatistics: jest.fn().mockResolvedValue({
        authenticatedUsers: 2,
        verifiedUsers: 1,
        expiredTokens: 5,
      }),
    };

    // Mock AuthContext
    AuthContext.mockImplementation((data) => data);
  });

  describe('Constructor', () => {
    it('should require at least one auth implementation', () => {
      expect(() => new AuthenticationAntiCorruptionLayer({}))
        .toThrow('At least one auth implementation is required');
    });

    it('should create with legacy only', () => {
      acl = new AuthenticationAntiCorruptionLayer({
        legacyAuthManager: mockLegacyAuthManager,
      });

      expect(acl.legacyAuthManager).toBe(mockLegacyAuthManager);
      expect(acl.authApplicationService).toBeUndefined();
      expect(acl.shadowMode).toBe(false);
      expect(acl.useDDD).toBe(false);
    });

    it('should create with DDD only', () => {
      acl = new AuthenticationAntiCorruptionLayer({
        authApplicationService: mockAuthApplicationService,
      });

      expect(acl.legacyAuthManager).toBeUndefined();
      expect(acl.authApplicationService).toBe(mockAuthApplicationService);
      expect(acl.shadowMode).toBe(false);
      expect(acl.useDDD).toBe(false);
    });

    it('should create with both in shadow mode', () => {
      acl = new AuthenticationAntiCorruptionLayer({
        legacyAuthManager: mockLegacyAuthManager,
        authApplicationService: mockAuthApplicationService,
        shadowMode: true,
      });

      expect(acl.legacyAuthManager).toBe(mockLegacyAuthManager);
      expect(acl.authApplicationService).toBe(mockAuthApplicationService);
      expect(acl.shadowMode).toBe(true);
      expect(acl.useDDD).toBe(false);
    });
  });

  describe('Initialization', () => {
    it('should initialize legacy when available', async () => {
      acl = new AuthenticationAntiCorruptionLayer({
        legacyAuthManager: mockLegacyAuthManager,
      });

      await acl.initialize();

      expect(mockLegacyAuthManager.initialize).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith('[AuthACL] Legacy auth manager initialized');
    });

    it('should initialize both in shadow mode', async () => {
      acl = new AuthenticationAntiCorruptionLayer({
        legacyAuthManager: mockLegacyAuthManager,
        authApplicationService: mockAuthApplicationService,
        shadowMode: true,
      });

      await acl.initialize();

      expect(mockLegacyAuthManager.initialize).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith('[AuthACL] Legacy auth manager initialized');
      expect(logger.info).toHaveBeenCalledWith('[AuthACL] DDD auth service ready');
    });

    it('should handle initialization errors', async () => {
      const error = new Error('Init failed');
      mockLegacyAuthManager.initialize.mockRejectedValue(error);

      acl = new AuthenticationAntiCorruptionLayer({
        legacyAuthManager: mockLegacyAuthManager,
      });

      await expect(acl.initialize()).rejects.toThrow('Init failed');
      expect(logger.error).toHaveBeenCalledWith('[AuthACL] Failed to initialize:', error);
    });
  });

  describe('Shadow Mode Operations', () => {
    beforeEach(() => {
      acl = new AuthenticationAntiCorruptionLayer({
        legacyAuthManager: mockLegacyAuthManager,
        authApplicationService: mockAuthApplicationService,
        shadowMode: true,
      });
    });

    describe('getAuthorizationUrl', () => {
      it('should compare results and return legacy in shadow mode', async () => {
        // Reset mock counts from initialization
        logger.info.mockClear();
        logger.warn.mockClear();
        
        // Ensure both return the same value
        mockLegacyAuthManager.getAuthorizationUrl.mockResolvedValue('https://same.auth/url');
        mockAuthApplicationService.getAuthorizationUrl.mockResolvedValue('https://same.auth/url');
        
        const result = await acl.getAuthorizationUrl('user123');

        expect(result).toBe('https://same.auth/url');
        expect(mockLegacyAuthManager.getAuthorizationUrl).toHaveBeenCalledWith('user123');
        expect(mockAuthApplicationService.getAuthorizationUrl).toHaveBeenCalledWith('user123');
        expect(logger.info).toHaveBeenCalledWith('[AuthACL] Shadow mode match for getAuthorizationUrl');
      });

      it('should log discrepancy when results differ', async () => {
        mockAuthApplicationService.getAuthorizationUrl.mockResolvedValue('https://different.url');

        const result = await acl.getAuthorizationUrl('user123');

        expect(result).toBe('https://legacy.auth/url');
        expect(logger.warn).toHaveBeenCalledWith(
          '[AuthACL] Shadow mode discrepancy in getAuthorizationUrl:',
          expect.stringContaining('String mismatch')
        );
      });
    });

    describe('exchangeCodeForToken', () => {
      it('should transform and compare results', async () => {
        // Reset mock counts from previous tests
        logger.info.mockClear();
        logger.warn.mockClear();
        
        const result = await acl.exchangeCodeForToken('user123', 'auth-code');

        expect(result).toEqual({ success: true, message: 'Legacy auth success' });
        expect(mockLegacyAuthManager.handleOAuthCallback).toHaveBeenCalledWith('user123', 'auth-code');
        expect(mockAuthApplicationService.exchangeCodeForToken).toHaveBeenCalledWith('user123', 'auth-code');
        
        // The transform creates different objects, so they won't match exactly
        // But we should see some comparison happening
        expect(logger.warn).toHaveBeenCalledWith(
          '[AuthACL] Shadow mode discrepancy in exchangeCodeForToken:',
          expect.any(String)
        );
      });
    });

    describe('isUserAuthenticated', () => {
      it('should compare boolean results', async () => {
        const result = await acl.isUserAuthenticated('user123');

        expect(result).toBe(true);
        expect(mockLegacyAuthManager.isUserAuthenticated).toHaveBeenCalledWith('user123');
        expect(mockAuthApplicationService.getAuthenticationStatus).toHaveBeenCalledWith('user123');
        expect(logger.info).toHaveBeenCalledWith('[AuthACL] Shadow mode match for isUserAuthenticated');
      });

      it('should detect boolean mismatch', async () => {
        mockAuthApplicationService.getAuthenticationStatus.mockResolvedValue({
          isAuthenticated: false,
          user: null,
        });

        const result = await acl.isUserAuthenticated('user123');

        expect(result).toBe(true); // Legacy result
        expect(logger.warn).toHaveBeenCalledWith(
          '[AuthACL] Shadow mode discrepancy in isUserAuthenticated:',
          'Boolean mismatch: legacy=true, ddd=false'
        );
      });
    });

    describe('validateUserAccess', () => {
      it('should create AuthContext and compare results', async () => {
        const personality = { name: 'TestBot', nsfw: false };
        const context = {
          channelType: 'text',
          channelId: 'channel123',
          isNsfw: false,
          isProxyMessage: false,
        };

        const result = await acl.validateUserAccess('user123', personality, context);

        expect(result).toEqual({
          allowed: true,
          requiresAuth: false,
          requiresNsfwVerification: false,
        });

        expect(AuthContext).toHaveBeenCalledWith({
          channelType: 'GUILD',
          channelId: 'channel123',
          isNsfwChannel: false,
          isProxyMessage: false,
        });

        expect(mockAuthApplicationService.checkPersonalityAccess).toHaveBeenCalledWith(
          'user123',
          personality,
          expect.objectContaining({ channelType: 'GUILD' })
        );
      });

      it('should handle DM channels', async () => {
        const personality = { name: 'TestBot' };
        const context = {
          channelType: 'DM',
          channelId: 'dm123',
        };

        await acl.validateUserAccess('user123', personality, context);

        expect(AuthContext).toHaveBeenCalledWith({
          channelType: 'DM',
          channelId: 'dm123',
          isNsfwChannel: false,
          isProxyMessage: false,
        });
      });
    });

    describe('cleanupExpiredTokens', () => {
      it('should compare cleanup counts', async () => {
        const result = await acl.cleanupExpiredTokens();

        expect(result).toBe(5);
        expect(mockLegacyAuthManager.cleanupExpiredTokens).toHaveBeenCalled();
        expect(mockAuthApplicationService.cleanupExpiredTokens).toHaveBeenCalled();
        expect(logger.info).toHaveBeenCalledWith('[AuthACL] Shadow mode match for cleanupExpiredTokens');
      });
    });
  });

  describe('Legacy Compatibility Methods', () => {
    beforeEach(() => {
      acl = new AuthenticationAntiCorruptionLayer({
        legacyAuthManager: mockLegacyAuthManager,
        authApplicationService: mockAuthApplicationService,
        shadowMode: true,
      });
    });

    describe('getUserToken', () => {
      it('should return legacy token', () => {
        const token = acl.getUserToken('user123');
        
        expect(token).toBe('legacy-token');
        expect(mockLegacyAuthManager.getUserToken).toHaveBeenCalledWith('user123');
      });

      it('should return null without legacy manager', () => {
        acl = new AuthenticationAntiCorruptionLayer({
          authApplicationService: mockAuthApplicationService,
        });

        const token = acl.getUserToken('user123');
        
        expect(token).toBeNull();
        expect(logger.warn).toHaveBeenCalledWith('[AuthACL] getUserToken not available in DDD mode');
      });
    });

    describe('hasValidToken', () => {
      it('should use legacy synchronous check', () => {
        const result = acl.hasValidToken('user123');
        
        expect(result).toBe(true);
        expect(mockLegacyAuthManager.hasValidToken).toHaveBeenCalledWith('user123');
      });

      it('should return false without shadow mode', () => {
        acl = new AuthenticationAntiCorruptionLayer({
          authApplicationService: mockAuthApplicationService,
        });

        const result = acl.hasValidToken('user123');
        
        expect(result).toBe(false);
      });
    });

    describe('getTokenAge', () => {
      it('should return legacy token age', () => {
        const age = acl.getTokenAge('user123');
        
        expect(age).toBe('3 days');
        expect(mockLegacyAuthManager.getTokenAge).toHaveBeenCalledWith('user123');
      });
    });

    describe('getTokenExpirationInfo', () => {
      it('should return legacy expiration info', () => {
        const info = acl.getTokenExpirationInfo('user123');
        
        expect(info).toEqual({ expiresIn: 27, unit: 'days' });
        expect(mockLegacyAuthManager.getTokenExpirationInfo).toHaveBeenCalledWith('user123');
      });
    });

    describe('storeUserToken', () => {
      it('should store in both systems and compare', async () => {
        const result = await acl.storeUserToken('user123', 'new-token');

        expect(result).toBe(true);
        expect(mockLegacyAuthManager.storeUserToken).toHaveBeenCalledWith('user123', 'new-token');
        expect(mockAuthApplicationService.exchangeCodeForToken).toHaveBeenCalledWith('user123', 'new-token');
        expect(logger.info).toHaveBeenCalledWith('[AuthACL] Shadow mode match for storeUserToken');
      });

      it('should handle DDD failure gracefully', async () => {
        mockAuthApplicationService.exchangeCodeForToken.mockRejectedValue(new Error('DDD failed'));

        const result = await acl.storeUserToken('user123', 'new-token');

        expect(result).toBe(true); // Legacy succeeded
        expect(logger.error).toHaveBeenCalledWith('[ACL] DDD storeUserToken failed: DDD failed');
      });
    });

    describe('deleteUserToken', () => {
      it('should delete in both systems', async () => {
        const result = await acl.deleteUserToken('user123');

        expect(result).toBe(true);
        expect(mockLegacyAuthManager.deleteUserToken).toHaveBeenCalledWith('user123');
        expect(mockAuthApplicationService.revokeAuthentication).toHaveBeenCalledWith('user123');
        expect(logger.info).toHaveBeenCalledWith('[AuthACL] Shadow mode match for deleteUserToken');
      });
    });
  });

  describe('DDD Mode Operations', () => {
    beforeEach(() => {
      acl = new AuthenticationAntiCorruptionLayer({
        authApplicationService: mockAuthApplicationService,
        useDDD: true,
      });
    });

    describe('getAuthorizationUrl', () => {
      it('should use DDD directly', async () => {
        const result = await acl.getAuthorizationUrl('user123');

        expect(result).toBe('https://ddd.auth/url');
        expect(mockAuthApplicationService.getAuthorizationUrl).toHaveBeenCalledWith('user123');
        expect(mockLegacyAuthManager.getAuthorizationUrl).not.toHaveBeenCalled();
      });
    });

    describe('isUserAuthenticated', () => {
      it('should use DDD status check', async () => {
        const result = await acl.isUserAuthenticated('user123');

        expect(result).toBe(true);
        expect(mockAuthApplicationService.getAuthenticationStatus).toHaveBeenCalledWith('user123');
      });
    });

    describe('validateUserAccess', () => {
      it('should transform DDD result format', async () => {
        mockAuthApplicationService.checkPersonalityAccess.mockResolvedValue({
          allowed: false,
          reason: 'User requires authentication',
        });

        const result = await acl.validateUserAccess('user123', {}, { channelType: 'text' });

        expect(result).toEqual({
          allowed: false,
          requiresAuth: true,
          requiresNsfwVerification: false,
          error: 'User requires authentication',
        });
      });

      it('should detect NSFW verification requirement', async () => {
        mockAuthApplicationService.checkPersonalityAccess.mockResolvedValue({
          allowed: false,
          reason: 'NSFW verification required',
        });

        const result = await acl.validateUserAccess('user123', {}, { channelType: 'text' });

        expect(result).toEqual({
          allowed: false,
          requiresAuth: false,
          requiresNsfwVerification: true,
          error: 'NSFW verification required',
        });
      });
    });

    describe('getStatistics', () => {
      it('should return DDD statistics', async () => {
        const stats = await acl.getStatistics();

        expect(stats).toEqual({
          authenticatedUsers: 2,
          verifiedUsers: 1,
          expiredTokens: 5,
        });
        expect(mockAuthApplicationService.getStatistics).toHaveBeenCalled();
      });
    });
  });

  describe('Error Handling', () => {
    beforeEach(() => {
      acl = new AuthenticationAntiCorruptionLayer({
        legacyAuthManager: mockLegacyAuthManager,
        authApplicationService: mockAuthApplicationService,
        shadowMode: true,
      });
    });

    it('should handle DDD failure in shadow mode', async () => {
      const error = new Error('DDD service error');
      
      mockAuthApplicationService.getAuthorizationUrl.mockRejectedValue(error);

      const result = await acl.getAuthorizationUrl('user123');

      expect(result).toBe('https://legacy.auth/url');
      expect(logger.error).toHaveBeenCalledWith(
        '[AuthACL] DDD getAuthorizationUrl failed: DDD service error'
      );
      expect(logger.warn).toHaveBeenCalledWith(
        '[AuthACL] Shadow mode discrepancy in getAuthorizationUrl:',
        expect.stringContaining('String mismatch')
      );
    });

    it('should handle createUserAIClient when legacy not available', async () => {
      acl = new AuthenticationAntiCorruptionLayer({
        authApplicationService: mockAuthApplicationService,
      });

      await expect(acl.createUserAIClient('user123'))
        .rejects.toThrow('AI client creation not yet implemented in DDD mode');
    });
  });

  describe('Discrepancy Tracking', () => {
    beforeEach(() => {
      acl = new AuthenticationAntiCorruptionLayer({
        legacyAuthManager: mockLegacyAuthManager,
        authApplicationService: mockAuthApplicationService,
        shadowMode: true,
      });
    });

    it('should track discrepancies', async () => {
      // Create a discrepancy
      mockAuthApplicationService.getAuthorizationUrl.mockResolvedValue('https://different.url');
      
      await acl.getAuthorizationUrl('user123');
      
      const discrepancies = acl.getDiscrepancies();
      
      expect(discrepancies).toHaveLength(1);
      expect(discrepancies[0]).toMatchObject({
        operation: 'getAuthorizationUrl',
        legacy: 'https://legacy.auth/url',
        ddd: 'https://different.url',
        discrepancy: expect.stringContaining('String mismatch'),
      });
    });

    it('should clear discrepancies', async () => {
      // Create a discrepancy
      mockAuthApplicationService.getAuthorizationUrl.mockResolvedValue('https://different.url');
      await acl.getAuthorizationUrl('user123');
      
      expect(acl.getDiscrepancies()).toHaveLength(1);
      
      acl.clearDiscrepancies();
      
      expect(acl.getDiscrepancies()).toHaveLength(0);
    });
  });
});