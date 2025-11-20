/**
 * Tests for authentication handling in personalityHandler
 * 
 * Focuses specifically on the checkPersonalityAuth function and its
 * handling of different message types (direct, webhook, PluralKit).
 */

// Mock config first, before any imports
jest.mock('../../../config', () => ({ 
  botPrefix: '!tz',
  botConfig: {
    isDevelopment: false
  }
}));

// Mock dependencies
jest.mock('../../../src/logger');
jest.mock('../../../src/utils/webhookUserTracker');
jest.mock('../../../src/utils/channelUtils');
jest.mock('../../../src/domain/authentication/AuthContext');

const { 
  checkPersonalityAuth,
  setAuthService,
  clearCache,
} = require('../../../src/handlers/personalityHandler');

const logger = require('../../../src/logger');
const webhookUserTracker = require('../../../src/utils/webhookUserTracker');
const { isChannelNSFW } = require('../../../src/utils/channelUtils');
const { AuthContext } = require('../../../src/domain/authentication/AuthContext');

describe('PersonalityHandler - checkPersonalityAuth', () => {
  let mockAuthService;
  let mockPersonality;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock console to avoid noise in tests
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();

    // Create mock authentication service
    mockAuthService = {
      checkPersonalityAccess: jest.fn(),
    };

    // Set up the auth service
    setAuthService(mockAuthService);

    // Mock personality
    mockPersonality = {
      name: 'test-personality',
      fullName: 'test-personality',
      displayName: 'Test Personality',
    };

    // Mock channel utils
    isChannelNSFW.mockReturnValue(true);

    // Mock AuthContext
    AuthContext.mockImplementation((config) => ({
      channelType: config.channelType,
      channelId: config.channelId,
      isNsfwChannel: config.isNsfwChannel,
      isProxyMessage: config.isProxyMessage,
      requestedPersonalityId: config.requestedPersonalityId,
      isDM: () => config.channelType === 'DM',
    }));
  });

  afterEach(() => {
    clearCache();
  });

  describe('Error Handling', () => {
    it('should throw error if auth service not initialized', async () => {
      clearCache(); // Remove auth service

      const mockMessage = {
        author: { id: 'user-123' },
        channel: { isDMBased: () => false },
      };

      const result = await checkPersonalityAuth(mockMessage, mockPersonality);

      expect(result).toEqual({
        isAllowed: false,
        errorMessage: 'An error occurred while checking authorization.',
        reason: 'error',
      });

      expect(logger.error).toHaveBeenCalledWith(
        '[PersonalityHandler] Error checking personality auth:',
        expect.any(Error)
      );
    });
  });

  describe('PluralKit Proxy System Messages', () => {
    let mockProxyMessage;

    beforeEach(() => {
      mockProxyMessage = {
        id: 'message-123',
        content: 'Hello personality!',
        author: {
          id: 'webhook-user-123',
          username: 'ProxyName',
        },
        channel: {
          id: 'channel-123',
          isDMBased: () => false,
          isThread: () => false,
        },
        webhookId: 'webhook-123',
      };

      // Mock as PluralKit webhook
      webhookUserTracker.isProxySystemWebhook.mockReturnValue(true);
    });

    it('should use proxy authentication for PluralKit messages', async () => {
      const realUserId = 'real-user-123';

      // Mock proxy authentication success
      webhookUserTracker.checkProxySystemAuthentication.mockResolvedValue({
        isAuthenticated: true,
        userId: realUserId,
        username: 'RealUser',
      });

      // Mock DDD auth success
      mockAuthService.checkPersonalityAccess.mockResolvedValue({
        allowed: true,
      });

      const result = await checkPersonalityAuth(mockProxyMessage, mockPersonality);

      expect(result).toEqual({
        isAllowed: true,
        isProxySystem: true,
        isDM: false,
        realUserId: realUserId,
      });

      // Verify proxy authentication was used
      expect(webhookUserTracker.isProxySystemWebhook).toHaveBeenCalledWith(mockProxyMessage);
      expect(webhookUserTracker.checkProxySystemAuthentication).toHaveBeenCalledWith(mockProxyMessage);

      // Verify DDD auth was called with real user ID
      expect(mockAuthService.checkPersonalityAccess).toHaveBeenCalledWith(
        realUserId,
        mockPersonality,
        expect.any(Object)
      );
    });

    it('should fail if proxy user is not authenticated', async () => {
      // Mock proxy authentication failure
      webhookUserTracker.checkProxySystemAuthentication.mockResolvedValue({
        isAuthenticated: false,
        userId: null,
      });

      const result = await checkPersonalityAuth(mockProxyMessage, mockPersonality);

      expect(result).toEqual({
        isAllowed: false,
        errorMessage: 'Authentication required. Use `!tz auth start` to authenticate first.',
        reason: 'auth_failed',
      });

      // Verify proxy authentication was attempted
      expect(webhookUserTracker.checkProxySystemAuthentication).toHaveBeenCalledWith(mockProxyMessage);

      // Verify DDD auth was NOT called since proxy auth failed
      expect(mockAuthService.checkPersonalityAccess).not.toHaveBeenCalled();
    });

    it('should fail if DDD auth denies access for proxy user', async () => {
      const realUserId = 'real-user-123';

      // Mock proxy authentication success
      webhookUserTracker.checkProxySystemAuthentication.mockResolvedValue({
        isAuthenticated: true,
        userId: realUserId,
        username: 'RealUser',
      });

      // Mock DDD auth failure
      mockAuthService.checkPersonalityAccess.mockResolvedValue({
        allowed: false,
        reason: 'User is blacklisted',
      });

      const result = await checkPersonalityAuth(mockProxyMessage, mockPersonality);

      expect(result).toEqual({
        isAllowed: false,
        errorMessage: 'User is blacklisted',
        reason: 'auth_failed',
      });

      // Verify both auth methods were called
      expect(webhookUserTracker.checkProxySystemAuthentication).toHaveBeenCalledWith(mockProxyMessage);
      expect(mockAuthService.checkPersonalityAccess).toHaveBeenCalledWith(
        realUserId,
        mockPersonality,
        expect.any(Object)
      );
    });

    it('should create proper auth context for proxy messages', async () => {
      webhookUserTracker.checkProxySystemAuthentication.mockResolvedValue({
        isAuthenticated: true,
        userId: 'real-user-123',
      });

      mockAuthService.checkPersonalityAccess.mockResolvedValue({
        allowed: true,
      });

      await checkPersonalityAuth(mockProxyMessage, mockPersonality);

      expect(AuthContext).toHaveBeenCalledWith({
        channelType: 'GUILD',
        channelId: 'channel-123',
        isNsfwChannel: true,
        isProxyMessage: true,
        requestedPersonalityId: 'test-personality',
      });
    });
  });

  describe('Regular Webhook Messages (Non-Proxy)', () => {
    let mockWebhookMessage;

    beforeEach(() => {
      mockWebhookMessage = {
        id: 'message-456',
        content: 'Hello personality!',
        author: {
          id: 'webhook-user-456',
          username: 'RegularWebhook',
        },
        channel: {
          id: 'channel-456',
          isDMBased: () => false,
          isThread: () => false,
        },
        webhookId: 'webhook-456',
      };

      // Mock as regular webhook (not proxy system)
      webhookUserTracker.isProxySystemWebhook.mockReturnValue(false);
      webhookUserTracker.getRealUserId.mockReturnValue('regular-user-456');
    });

    it('should use standard authentication for non-proxy webhooks', async () => {
      const regularUserId = 'regular-user-456';

      // Mock DDD auth success
      mockAuthService.checkPersonalityAccess.mockResolvedValue({
        allowed: true,
      });

      const result = await checkPersonalityAuth(mockWebhookMessage, mockPersonality);

      expect(result).toEqual({
        isAllowed: true,
        isProxySystem: false,
        isDM: false,
      });

      // Verify standard auth flow was used
      expect(webhookUserTracker.isProxySystemWebhook).toHaveBeenCalledWith(mockWebhookMessage);
      expect(webhookUserTracker.getRealUserId).toHaveBeenCalledWith(mockWebhookMessage);
      expect(webhookUserTracker.checkProxySystemAuthentication).not.toHaveBeenCalled();

      // Verify DDD auth was called with regular user ID
      expect(mockAuthService.checkPersonalityAccess).toHaveBeenCalledWith(
        regularUserId,
        mockPersonality,
        expect.any(Object)
      );
    });

    it('should create proper auth context for regular webhooks', async () => {
      mockAuthService.checkPersonalityAccess.mockResolvedValue({
        allowed: true,
      });

      await checkPersonalityAuth(mockWebhookMessage, mockPersonality);

      expect(AuthContext).toHaveBeenCalledWith({
        channelType: 'GUILD',
        channelId: 'channel-456',
        isNsfwChannel: true,
        isProxyMessage: true, // Still true because it has webhookId
        requestedPersonalityId: 'test-personality',
      });
    });
  });

  describe('Direct User Messages (No Webhook)', () => {
    let mockDirectMessage;

    beforeEach(() => {
      mockDirectMessage = {
        id: 'message-789',
        content: 'Hello personality!',
        author: {
          id: 'direct-user-789',
          username: 'DirectUser',
        },
        channel: {
          id: 'channel-789',
          isDMBased: () => false,
          isThread: () => false,
        },
        // No webhookId - this is a direct user message
      };

      webhookUserTracker.isProxySystemWebhook.mockReturnValue(false);
      webhookUserTracker.getRealUserId.mockReturnValue(null); // No real user found
    });

    it('should use message author ID for direct messages', async () => {
      // Mock DDD auth success
      mockAuthService.checkPersonalityAccess.mockResolvedValue({
        allowed: true,
      });

      const result = await checkPersonalityAuth(mockDirectMessage, mockPersonality);

      expect(result).toEqual({
        isAllowed: true,
        isProxySystem: false,
        isDM: false,
      });

      // Verify direct user ID was used (message.author.id)
      expect(mockAuthService.checkPersonalityAccess).toHaveBeenCalledWith(
        'direct-user-789',
        mockPersonality,
        expect.any(Object)
      );
    });

    it('should create proper auth context for direct messages', async () => {
      mockAuthService.checkPersonalityAccess.mockResolvedValue({
        allowed: true,
      });

      await checkPersonalityAuth(mockDirectMessage, mockPersonality);

      expect(AuthContext).toHaveBeenCalledWith({
        channelType: 'GUILD',
        channelId: 'channel-789',
        isNsfwChannel: true,
        isProxyMessage: false, // No webhookId
        requestedPersonalityId: 'test-personality',
      });
    });
  });

  describe('DM Messages', () => {
    let mockDMMessage;

    beforeEach(() => {
      mockDMMessage = {
        id: 'dm-message-123',
        content: 'Hello personality!',
        author: {
          id: 'dm-user-123',
          username: 'DMUser',
        },
        channel: {
          id: 'dm-channel-123',
          isDMBased: () => true, // This is a DM
          isThread: () => false,
        },
      };

      webhookUserTracker.isProxySystemWebhook.mockReturnValue(false);
      webhookUserTracker.getRealUserId.mockReturnValue(null);
    });

    it('should handle DM messages correctly', async () => {
      mockAuthService.checkPersonalityAccess.mockResolvedValue({
        allowed: true,
      });

      const result = await checkPersonalityAuth(mockDMMessage, mockPersonality);

      expect(result).toEqual({
        isAllowed: true,
        isProxySystem: false,
        isDM: true, // Should detect DM correctly
      });

      expect(AuthContext).toHaveBeenCalledWith({
        channelType: 'DM',
        channelId: 'dm-channel-123',
        isNsfwChannel: true,
        isProxyMessage: false,
        requestedPersonalityId: 'test-personality',
      });
    });
  });

  describe('Channel Type Detection', () => {
    it('should detect thread channels correctly', async () => {
      const mockThreadMessage = {
        author: { id: 'user-123' },
        channel: {
          id: 'thread-123',
          isDMBased: () => false,
          isThread: () => true, // This is a thread
        },
      };

      webhookUserTracker.isProxySystemWebhook.mockReturnValue(false);
      webhookUserTracker.getRealUserId.mockReturnValue(null);
      mockAuthService.checkPersonalityAccess.mockResolvedValue({ allowed: true });

      await checkPersonalityAuth(mockThreadMessage, mockPersonality);

      expect(AuthContext).toHaveBeenCalledWith({
        channelType: 'THREAD',
        channelId: 'thread-123',
        isNsfwChannel: true,
        isProxyMessage: false,
        requestedPersonalityId: 'test-personality',
      });
    });
  });

  describe('NSFW Channel Detection', () => {
    it('should pass NSFW channel status to auth context', async () => {
      const mockMessage = {
        author: { id: 'user-123' },
        channel: {
          id: 'channel-123',
          isDMBased: () => false,
          isThread: () => false,
        },
      };

      // Mock as non-NSFW channel
      isChannelNSFW.mockReturnValue(false);

      webhookUserTracker.isProxySystemWebhook.mockReturnValue(false);
      webhookUserTracker.getRealUserId.mockReturnValue(null);
      mockAuthService.checkPersonalityAccess.mockResolvedValue({ allowed: true });

      await checkPersonalityAuth(mockMessage, mockPersonality);

      expect(AuthContext).toHaveBeenCalledWith({
        channelType: 'GUILD',
        channelId: 'channel-123',
        isNsfwChannel: false, // Should reflect the mock return value
        isProxyMessage: false,
        requestedPersonalityId: 'test-personality',
      });
    });
  });
});