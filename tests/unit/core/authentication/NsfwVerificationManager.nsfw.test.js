/**
 * Tests for NSFW verification enforcement in SFW channels
 */

jest.mock('../../../../src/logger', () => ({
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));

jest.mock('../../../../src/utils/webhookUserTracker', () => ({
  findRealUserId: jest.fn()
}));

const NsfwVerificationManager = require('../../../../src/core/authentication/NsfwVerificationManager');
const webhookUserTracker = require('../../../../src/utils/webhookUserTracker');
const logger = require('../../../../src/logger');

describe('NsfwVerificationManager - NSFW Channel Enforcement', () => {
  let manager;

  beforeEach(() => {
    jest.clearAllMocks();
    manager = new NsfwVerificationManager();
  });

  describe('verifyAccess - Channel Type Enforcement', () => {
    const mockUserId = '123456789012345678';
    
    it('should block access in DMs for non-verified users', () => {
      const dmChannel = {
        guild: null, // DM channel
        nsfw: false
      };

      const result = manager.verifyAccess(dmChannel, mockUserId);
      
      expect(result.isAllowed).toBe(false);
      expect(result.reason).toContain(`<@${mockUserId}> has not completed NSFW verification`);
    });

    it('should allow access in DMs for verified users', () => {
      const dmChannel = {
        guild: null, // DM channel
        nsfw: false
      };

      // First verify the user
      manager.storeNsfwVerification(mockUserId, true);

      const result = manager.verifyAccess(dmChannel, mockUserId);
      
      expect(result.isAllowed).toBe(true);
      expect(result.reason).toBe('User is verified and can use DMs');
    });

    it('should block NSFW-verified users in SFW channels', () => {
      // First verify the user
      manager.storeNsfwVerification(mockUserId, true);
      
      const sfwChannel = {
        guild: { id: 'guild-123' },
        nsfw: false // SFW channel
      };

      const result = manager.verifyAccess(sfwChannel, mockUserId);
      
      expect(result.isAllowed).toBe(false);
      expect(result.reason).toBe('NSFW-verified users can only use personalities in NSFW channels or DMs');
    });

    it('should allow NSFW-verified users in NSFW channels', () => {
      // First verify the user
      manager.storeNsfwVerification(mockUserId, true);
      
      const nsfwChannel = {
        guild: { id: 'guild-123' },
        nsfw: true // NSFW channel
      };

      const result = manager.verifyAccess(nsfwChannel, mockUserId);
      
      expect(result.isAllowed).toBe(true);
      expect(result.reason).toBe('User is verified and channel is NSFW');
    });

    it('should auto-verify non-verified users in NSFW channels', () => {
      const nsfwChannel = {
        guild: { id: 'guild-123' },
        nsfw: true,
        id: 'channel-123'
      };

      // User is not verified initially
      expect(manager.isNsfwVerified(mockUserId)).toBe(false);

      const result = manager.verifyAccess(nsfwChannel, mockUserId);
      
      expect(result.isAllowed).toBe(true);
      expect(result.reason).toBe('User auto-verified in NSFW channel');
      expect(result.autoVerified).toBe(true);
      
      // User should now be verified
      expect(manager.isNsfwVerified(mockUserId)).toBe(true);
      expect(logger.info).toHaveBeenCalledWith('[NsfwVerificationManager] Auto-verifying user 123456789012345678 in NSFW channel channel-123');
    });

    it('should include user mention in error messages', () => {
      const sfwChannel = {
        guild: { id: 'guild-123' },
        nsfw: false
      };

      const result = manager.verifyAccess(sfwChannel, mockUserId);
      
      expect(result.reason).toContain(`<@${mockUserId}>`);
      expect(result.userId).toBe(mockUserId);
    });
  });

  describe('Proxy System Integration', () => {
    const mockUserId = '123456789012345678';
    const mockProxyUserId = '987654321098765432';
    
    beforeEach(() => {
      webhookUserTracker.findRealUserId.mockReturnValue(mockProxyUserId);
    });

    it('should inherit NSFW verification from real user behind proxy', () => {
      // Verify the real user
      manager.storeNsfwVerification(mockProxyUserId, true);
      
      const nsfwChannel = {
        guild: { id: 'guild-123' },
        nsfw: true
      };

      const mockMessage = {
        author: { bot: true, username: 'pk;system[APP]', discriminator: '0000' },
        webhookId: 'webhook-123'
      };

      const result = manager.verifyAccess(nsfwChannel, mockUserId, mockMessage);
      
      expect(result.isAllowed).toBe(true);
      expect(result.reason).toContain(`Proxy user ${mockProxyUserId} is verified`);
      expect(result.isProxy).toBe(true);
      expect(result.systemType).toBe('pluralkit');
    });

    it('should block proxy systems in SFW channels even if real user is verified', () => {
      // Verify the real user
      manager.storeNsfwVerification(mockProxyUserId, true);
      
      const sfwChannel = {
        guild: { id: 'guild-123' },
        nsfw: false // SFW channel
      };

      const mockMessage = {
        author: { bot: true, username: 'pk;system[APP]', discriminator: '0000' },
        webhookId: 'webhook-123'
      };

      const result = manager.verifyAccess(sfwChannel, mockUserId, mockMessage);
      
      expect(result.isAllowed).toBe(false);
      expect(result.reason).toBe('NSFW-verified users can only use personalities in NSFW channels or DMs');
      expect(result.isProxy).toBe(true);
    });

    it('should handle unknown proxy users gracefully', () => {
      webhookUserTracker.findRealUserId.mockReturnValue('proxy-system-user');
      
      const nsfwChannel = {
        guild: { id: 'guild-123' },
        nsfw: true
      };

      const mockMessage = {
        author: { bot: true, username: 'pk;system[APP]', discriminator: '0000' },
        webhookId: 'webhook-123'
      };

      const result = manager.verifyAccess(nsfwChannel, mockUserId, mockMessage);
      
      expect(result.isAllowed).toBe(false);
      expect(result.reason).toContain('Cannot verify proxy system user');
      expect(result.isProxy).toBe(true);
    });

    it('should auto-verify unverified proxy users in NSFW channels', () => {
      webhookUserTracker.findRealUserId.mockReturnValue(mockProxyUserId);
      
      const nsfwChannel = {
        guild: { id: 'guild-123' },
        nsfw: true,
        id: 'channel-123'
      };

      const mockMessage = {
        author: { bot: true, username: 'pk;system[APP]', discriminator: '0000' },
        webhookId: 'webhook-123'
      };

      // User is not verified initially
      expect(manager.isNsfwVerified(mockProxyUserId)).toBe(false);

      const result = manager.verifyAccess(nsfwChannel, mockUserId, mockMessage);
      
      expect(result.isAllowed).toBe(true);
      expect(result.reason).toBe(`Proxy user ${mockProxyUserId} auto-verified in NSFW channel`);
      expect(result.autoVerified).toBe(true);
      expect(result.isProxy).toBe(true);
      expect(result.systemType).toBe('pluralkit');
      
      // User should now be verified
      expect(manager.isNsfwVerified(mockProxyUserId)).toBe(true);
      expect(logger.info).toHaveBeenCalledWith(`[NsfwVerificationManager] Auto-verifying proxy user ${mockProxyUserId} in NSFW channel channel-123`);
    });
  });

  describe('Legacy Behavior', () => {
    it('should maintain requiresNsfwVerification for NSFW channels', () => {
      const nsfwChannel = {
        guild: { id: 'guild-123' },
        nsfw: true
      };

      expect(manager.requiresNsfwVerification(nsfwChannel)).toBe(true);
    });

    it('should not require NSFW verification for DMs', () => {
      const dmChannel = {
        guild: null
      };

      expect(manager.requiresNsfwVerification(dmChannel)).toBe(false);
    });

    it('should store and retrieve verification status', () => {
      const userId = '123456789012345678';
      
      expect(manager.isNsfwVerified(userId)).toBe(false);
      
      manager.storeNsfwVerification(userId, true);
      
      expect(manager.isNsfwVerified(userId)).toBe(true);
      
      const info = manager.getVerificationInfo(userId);
      expect(info.verified).toBe(true);
      expect(info.verifiedAt).toBeDefined();
    });
  });
});