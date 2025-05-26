const personalityAuth = require('../../../src/utils/personalityAuth');
const logger = require('../../../src/logger');
const auth = require('../../../src/auth');
const channelUtils = require('../../../src/utils/channelUtils');
const webhookUserTracker = require('../../../src/utils/webhookUserTracker');

// Mock dependencies
jest.mock('../../../src/logger');
jest.mock('../../../src/auth');
jest.mock('../../../src/utils/channelUtils');
jest.mock('../../../src/utils/webhookUserTracker');

describe('Personality Authentication Module', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('checkNSFWRequirements', () => {
    it('should allow DM channels', () => {
      const channel = {
        isDMBased: jest.fn().mockReturnValue(true)
      };
      
      const result = personalityAuth.checkNSFWRequirements(channel);
      
      expect(result.isAllowed).toBe(true);
      expect(result.isDM).toBe(true);
    });

    it('should allow NSFW channels', () => {
      const channel = {
        isDMBased: jest.fn().mockReturnValue(false)
      };
      channelUtils.isChannelNSFW.mockReturnValue(true);
      
      const result = personalityAuth.checkNSFWRequirements(channel);
      
      expect(result.isAllowed).toBe(true);
      expect(result.isNSFW).toBe(true);
    });

    it('should reject non-NSFW guild channels', () => {
      const channel = {
        isDMBased: jest.fn().mockReturnValue(false)
      };
      channelUtils.isChannelNSFW.mockReturnValue(false);
      
      const result = personalityAuth.checkNSFWRequirements(channel);
      
      expect(result.isAllowed).toBe(false);
      expect(result.reason).toBe('not_nsfw_channel');
      expect(result.errorMessage).toContain('safety and compliance reasons');
    });
  });

  describe('checkProxySystemAuth', () => {
    it('should pass regular messages', () => {
      const message = {
        author: { id: 'user123', username: 'testuser' }
      };
      webhookUserTracker.isProxySystemWebhook.mockReturnValue(false);
      
      const result = personalityAuth.checkProxySystemAuth(message);
      
      expect(result.isProxySystem).toBe(false);
      expect(result.isAuthenticated).toBe(true);
      expect(result.userId).toBe('user123');
    });

    it('should check PluralKit authentication', () => {
      const message = {
        author: { id: 'webhook123', username: 'TestSystem' }
      };
      webhookUserTracker.isProxySystemWebhook.mockReturnValue(true);
      webhookUserTracker.checkProxySystemAuthentication.mockReturnValue({
        isAuthenticated: true,
        userId: 'realuser123',
        username: 'RealUser'
      });
      
      const result = personalityAuth.checkProxySystemAuth(message);
      
      expect(result.isProxySystem).toBe(true);
      expect(result.isAuthenticated).toBe(true);
      expect(result.userId).toBe('realuser123');
      expect(result.username).toBe('RealUser');
    });

    it('should reject unauthenticated PluralKit users', () => {
      const message = {
        author: { id: 'webhook123', username: 'TestSystem' }
      };
      webhookUserTracker.isProxySystemWebhook.mockReturnValue(true);
      webhookUserTracker.checkProxySystemAuthentication.mockReturnValue({
        isAuthenticated: false
      });
      
      const result = personalityAuth.checkProxySystemAuth(message);
      
      expect(result.isProxySystem).toBe(true);
      expect(result.isAuthenticated).toBe(false);
      expect(result.reason).toBe('pluralkit_not_authenticated');
      expect(result.errorMessage).toContain('PluralKit Users');
    });
  });

  describe('checkUserAuth', () => {
    it('should pass authenticated users', () => {
      auth.hasValidToken.mockReturnValue(true);
      
      const result = personalityAuth.checkUserAuth('user123', false);
      
      expect(result.isAuthenticated).toBe(true);
    });

    it('should reject unauthenticated users', () => {
      auth.hasValidToken.mockReturnValue(false);
      
      const result = personalityAuth.checkUserAuth('user123', true);
      
      expect(result.isAuthenticated).toBe(false);
      expect(result.reason).toBe('not_authenticated');
      expect(result.errorMessage).toContain('Authentication Required');
    });
  });

  describe('checkAgeVerification', () => {
    it('should pass verified users', async () => {
      auth.isNsfwVerified.mockReturnValue(true);
      
      const result = await personalityAuth.checkAgeVerification('user123', true, false);
      
      expect(result.isVerified).toBe(true);
    });

    it('should auto-verify users in NSFW channels', async () => {
      auth.isNsfwVerified.mockReturnValue(false);
      auth.storeNsfwVerification.mockResolvedValue(true);
      
      const result = await personalityAuth.checkAgeVerification('user123', true, false);
      
      expect(result.isVerified).toBe(true);
      expect(auth.storeNsfwVerification).toHaveBeenCalledWith('user123', true);
    });

    it('should not auto-verify users in DMs', async () => {
      auth.isNsfwVerified.mockReturnValue(false);
      
      const result = await personalityAuth.checkAgeVerification('user123', true, true);
      
      expect(result.isVerified).toBe(false);
      expect(auth.storeNsfwVerification).not.toHaveBeenCalled();
      expect(result.reason).toBe('not_verified');
    });

    it('should handle auto-verification failure', async () => {
      auth.isNsfwVerified.mockReturnValue(false);
      auth.storeNsfwVerification.mockResolvedValue(false);
      
      const result = await personalityAuth.checkAgeVerification('user123', true, false);
      
      expect(result.isVerified).toBe(false);
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('checkPersonalityAuth', () => {
    let mockMessage;

    beforeEach(() => {
      mockMessage = {
        author: { id: 'user123', username: 'testuser' },
        channel: {
          isDMBased: jest.fn().mockReturnValue(false)
        }
      };
    });

    it('should pass all checks for valid user', async () => {
      channelUtils.isChannelNSFW.mockReturnValue(true);
      webhookUserTracker.isProxySystemWebhook.mockReturnValue(false);
      auth.hasValidToken.mockReturnValue(true);
      auth.isNsfwVerified.mockReturnValue(true);
      
      const result = await personalityAuth.checkPersonalityAuth(mockMessage);
      
      expect(result.isAllowed).toBe(true);
      expect(result.authUserId).toBe('user123');
      expect(result.isNSFW).toBe(true);
    });

    it('should fail NSFW check first', async () => {
      channelUtils.isChannelNSFW.mockReturnValue(false);
      
      const result = await personalityAuth.checkPersonalityAuth(mockMessage);
      
      expect(result.isAllowed).toBe(false);
      expect(result.reason).toBe('not_nsfw_channel');
    });

    it('should fail proxy auth check', async () => {
      channelUtils.isChannelNSFW.mockReturnValue(true);
      webhookUserTracker.isProxySystemWebhook.mockReturnValue(true);
      webhookUserTracker.checkProxySystemAuthentication.mockReturnValue({
        isAuthenticated: false
      });
      
      const result = await personalityAuth.checkPersonalityAuth(mockMessage);
      
      expect(result.isAllowed).toBe(false);
      expect(result.reason).toBe('pluralkit_not_authenticated');
    });

    it('should fail regular auth check', async () => {
      channelUtils.isChannelNSFW.mockReturnValue(true);
      webhookUserTracker.isProxySystemWebhook.mockReturnValue(false);
      auth.hasValidToken.mockReturnValue(false);
      
      const result = await personalityAuth.checkPersonalityAuth(mockMessage);
      
      expect(result.isAllowed).toBe(false);
      expect(result.reason).toBe('not_authenticated');
    });

    it('should fail age verification check', async () => {
      channelUtils.isChannelNSFW.mockReturnValue(true);
      webhookUserTracker.isProxySystemWebhook.mockReturnValue(false);
      auth.hasValidToken.mockReturnValue(true);
      auth.isNsfwVerified.mockReturnValue(false);
      
      const result = await personalityAuth.checkPersonalityAuth(mockMessage);
      
      expect(result.isAllowed).toBe(false);
      expect(result.reason).toBe('not_verified');
    });
  });

  describe('sendAuthError', () => {
    it('should send error message', async () => {
      const mockMessage = {
        reply: jest.fn().mockResolvedValue({})
      };
      
      await personalityAuth.sendAuthError(mockMessage, 'Test error', 'test_error');
      
      expect(mockMessage.reply).toHaveBeenCalledWith({
        content: 'Test error',
        ephemeral: true
      });
    });

    it('should handle send failure', async () => {
      const mockMessage = {
        reply: jest.fn().mockRejectedValue(new Error('Send failed'))
      };
      
      await personalityAuth.sendAuthError(mockMessage, 'Test error', 'test_error');
      
      expect(logger.error).toHaveBeenCalledWith(
        '[PersonalityAuth] Failed to send test_error notice: Send failed'
      );
    });
  });
});