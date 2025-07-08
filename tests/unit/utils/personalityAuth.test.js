// Mock dependencies first
jest.mock('../../../src/logger');

// Import after mocking
const personalityAuth = require('../../../src/utils/personalityAuth');
const logger = require('../../../src/logger');

describe('Personality Authentication Module', () => {
  let mockAuthManager;

  beforeEach(() => {
    jest.clearAllMocks();

    // Reset the personalityAuth module's internal state
    personalityAuth._resetForTesting();

    // Setup mock auth manager
    mockAuthManager = {
      validatePersonalityAccess: jest.fn(),
      personalityAuthValidator: {
        requiresAuth: jest.fn(),
      },
      nsfwVerificationManager: {
        requiresNsfwVerification: jest.fn(),
      },
      getUserAuthStatus: jest.fn(),
    };

    // Initialize the personalityAuth module with our mock auth manager
    personalityAuth.initialize(mockAuthManager);
  });

  describe('checkPersonalityAuth', () => {
    it('should return isAllowed true when validation passes', async () => {
      const mockMessage = {
        author: { id: 'user123', username: 'testuser' },
        channel: {
          id: 'channel123',
          isDMBased: jest.fn().mockReturnValue(false),
        },
      };
      const mockPersonality = {
        name: 'test-personality',
        requiresAuth: false,
      };

      mockAuthManager.validatePersonalityAccess.mockResolvedValue({
        isAuthorized: true,
        details: {
          hasValidToken: true,
          nsfwCheck: { channelRequiresVerification: true },
          proxySystem: { detected: false },
        },
      });

      const result = await personalityAuth.checkPersonalityAuth(mockMessage, mockPersonality);

      expect(result.isAllowed).toBe(true);
      expect(result.isAuthorized).toBe(true); // Also check new format
      expect(result.authUserId).toBe('user123');
      expect(result.authUsername).toBe('testuser');
      expect(result.isProxySystem).toBe(false);
      expect(result.isDM).toBe(false);
      expect(result.isNSFW).toBe(true);
      expect(result.details).toEqual({
        hasValidToken: true,
        nsfwCheck: { channelRequiresVerification: true },
        proxySystem: { detected: false },
      });
      expect(mockAuthManager.validatePersonalityAccess).toHaveBeenCalledWith({
        message: mockMessage,
        personality: mockPersonality,
        channel: mockMessage.channel,
        userId: mockMessage.author.id,
      });
    });

    it('should return isAllowed false with error message when validation fails', async () => {
      const mockMessage = {
        author: { id: 'user123', username: 'testuser' },
        channel: {
          id: 'channel123',
          isDMBased: jest.fn().mockReturnValue(false),
        },
      };
      const mockPersonality = {
        name: 'test-personality',
        requiresAuth: true,
      };

      mockAuthManager.validatePersonalityAccess.mockResolvedValue({
        isAuthorized: false,
        errors: ['Authentication required', 'Please authenticate first'],
      });

      const result = await personalityAuth.checkPersonalityAuth(mockMessage, mockPersonality);

      expect(result.isAllowed).toBe(false);
      expect(result.isAuthorized).toBe(false); // Also check new format
      expect(result.errorMessage).toBe('Authentication required Please authenticate first');
      expect(result.error).toBe('Authentication required Please authenticate first');
      expect(result.reason).toBe('auth_failed');
    });

    it('should handle auth manager not initialized', async () => {
      // Reset auth manager to uninitialized state
      personalityAuth._resetForTesting();

      const mockMessage = {
        author: { id: 'user123', username: 'testuser' },
        channel: {
          id: 'channel123',
          isDMBased: jest.fn().mockReturnValue(false),
        },
      };
      const mockPersonality = { name: 'test-personality' };

      await expect(
        personalityAuth.checkPersonalityAuth(mockMessage, mockPersonality)
      ).rejects.toThrow('Auth manager not initialized');
    });

    it('should handle validation errors gracefully', async () => {
      const mockMessage = {
        author: { id: 'user123', username: 'testuser' },
        channel: {
          id: 'channel123',
          isDMBased: jest.fn().mockReturnValue(false),
        },
      };
      const mockPersonality = { name: 'test-personality' };

      mockAuthManager.validatePersonalityAccess.mockRejectedValue(new Error('Validation failed'));

      const result = await personalityAuth.checkPersonalityAuth(mockMessage, mockPersonality);

      expect(result.isAllowed).toBe(false);
      expect(result.isAuthorized).toBe(false);
      expect(result.errorMessage).toBe('An error occurred while checking authorization.');
      expect(result.error).toBe('An error occurred while checking authorization.');
      expect(result.reason).toBe('error');
      expect(logger.error).toHaveBeenCalledWith(
        '[PersonalityAuth] Error checking personality auth:',
        expect.any(Error)
      );
    });
  });

  describe('requiresAuth', () => {
    it('should return true when personality requires auth', () => {
      const mockPersonality = { requiresAuth: true };
      mockAuthManager.personalityAuthValidator.requiresAuth.mockReturnValue(true);

      const result = personalityAuth.requiresAuth(mockPersonality);

      expect(result).toBe(true);
      expect(mockAuthManager.personalityAuthValidator.requiresAuth).toHaveBeenCalledWith(
        mockPersonality
      );
    });

    it('should return false when personality does not require auth', () => {
      const mockPersonality = { requiresAuth: false };
      mockAuthManager.personalityAuthValidator.requiresAuth.mockReturnValue(false);

      const result = personalityAuth.requiresAuth(mockPersonality);

      expect(result).toBe(false);
    });

    it('should return false when auth manager not initialized', () => {
      // Reset auth manager to uninitialized state
      personalityAuth._resetForTesting();

      expect(() => {
        personalityAuth.requiresAuth({ requiresAuth: true });
      }).toThrow('Auth manager not initialized');
    });
  });

  describe('requiresNsfwVerification', () => {
    it('should return true for NSFW channels', () => {
      const mockChannel = { nsfw: true };
      mockAuthManager.nsfwVerificationManager.requiresNsfwVerification.mockReturnValue(true);

      const result = personalityAuth.requiresNsfwVerification(mockChannel);

      expect(result).toBe(true);
      expect(mockAuthManager.nsfwVerificationManager.requiresNsfwVerification).toHaveBeenCalledWith(
        mockChannel
      );
    });

    it('should return false for non-NSFW channels', () => {
      const mockChannel = { nsfw: false };
      mockAuthManager.nsfwVerificationManager.requiresNsfwVerification.mockReturnValue(false);

      const result = personalityAuth.requiresNsfwVerification(mockChannel);

      expect(result).toBe(false);
    });

    it('should return false when auth manager not initialized', () => {
      // Reset auth manager to uninitialized state
      personalityAuth._resetForTesting();

      expect(() => {
        personalityAuth.requiresNsfwVerification({ nsfw: true });
      }).toThrow('Auth manager not initialized');
    });
  });

  describe('getUserAuthStatus', () => {
    it('should return user auth status from auth manager', () => {
      const mockStatus = {
        userId: 'user123',
        isOwner: false,
        hasValidToken: true,
        tokenExpiration: '2024-01-01',
        nsfwVerified: true,
        nsfwVerificationDate: '2023-12-01',
      };

      mockAuthManager.getUserAuthStatus.mockReturnValue(mockStatus);

      const result = personalityAuth.getUserAuthStatus('user123');

      expect(result).toEqual(mockStatus);
      expect(mockAuthManager.getUserAuthStatus).toHaveBeenCalledWith('user123');
    });

    it('should return default status when auth manager not initialized', () => {
      // Reset auth manager to uninitialized state
      personalityAuth._resetForTesting();

      expect(() => {
        personalityAuth.getUserAuthStatus('user123');
      }).toThrow('Auth manager not initialized');
    });
  });

  describe('sendAuthError', () => {
    it('should send ephemeral reply with error message', async () => {
      const mockMessage = {
        reply: jest.fn().mockResolvedValue({}),
      };
      const errorMessage = 'Authentication required';
      const reason = 'not_authenticated';

      await personalityAuth.sendAuthError(mockMessage, errorMessage, reason);

      expect(mockMessage.reply).toHaveBeenCalledWith({
        content: errorMessage,
        // Note: ephemeral only works for slash command interactions, not regular messages
      });
    });

    it('should handle reply errors gracefully', async () => {
      const mockMessage = {
        reply: jest.fn().mockRejectedValue(new Error('Failed to send')),
      };
      const errorMessage = 'Authentication required';

      await personalityAuth.sendAuthError(mockMessage, errorMessage, 'test_reason');

      expect(logger.error).toHaveBeenCalledWith(
        '[PersonalityAuth] Error sending auth error message:',
        expect.any(Error)
      );
    });
  });
});
