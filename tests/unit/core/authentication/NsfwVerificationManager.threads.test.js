/**
 * Tests for NSFW verification in threads and forums
 */

jest.mock('../../../../src/logger', () => ({
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../../../../src/utils/webhookUserTracker', () => ({
  findRealUserId: jest.fn(),
}));

jest.mock('../../../../config', () => ({
  botPrefix: '!tz',
}));

jest.mock('../../../../src/utils/channelUtils', () => ({
  isChannelNSFW: jest.fn(),
}));

const NsfwVerificationManager = require('../../../../src/core/authentication/NsfwVerificationManager');
const channelUtils = require('../../../../src/utils/channelUtils');
const logger = require('../../../../src/logger');
const { botPrefix } = require('../../../../config');

describe('NsfwVerificationManager - Thread and Forum Support', () => {
  let manager;

  beforeEach(() => {
    jest.clearAllMocks();
    manager = new NsfwVerificationManager();
  });

  describe('requiresNsfwVerification - Threads', () => {
    it('should require verification for threads in NSFW channels', () => {
      const thread = {
        guild: { id: 'guild123' },
        isThread: () => true,
        parentId: 'nsfw-channel-123',
      };

      // Mock channelUtils to return true for NSFW thread
      channelUtils.isChannelNSFW.mockReturnValue(true);

      const result = manager.requiresNsfwVerification(thread);

      expect(result).toBe(true);
      expect(channelUtils.isChannelNSFW).toHaveBeenCalledWith(thread);
    });

    it('should not require verification for threads in SFW channels', () => {
      const thread = {
        guild: { id: 'guild123' },
        isThread: () => true,
        parentId: 'sfw-channel-123',
      };

      // Mock channelUtils to return false for SFW thread
      channelUtils.isChannelNSFW.mockReturnValue(false);

      const result = manager.requiresNsfwVerification(thread);

      expect(result).toBe(false);
      expect(channelUtils.isChannelNSFW).toHaveBeenCalledWith(thread);
    });

    it('should not require verification for DM threads', () => {
      const dmThread = {
        guild: null,
        isThread: () => true,
      };

      const result = manager.requiresNsfwVerification(dmThread);

      expect(result).toBe(false);
      expect(channelUtils.isChannelNSFW).not.toHaveBeenCalled();
    });
  });

  describe('shouldAutoVerify - Threads', () => {
    it('should auto-verify users in NSFW threads', () => {
      const thread = {
        guild: { id: 'guild123' },
        isThread: () => true,
        parentId: 'nsfw-channel-123',
        id: 'thread-123',
      };
      const userId = 'user123';

      // Mock channelUtils to return true for NSFW thread
      channelUtils.isChannelNSFW.mockReturnValue(true);

      const result = manager.shouldAutoVerify(thread, userId);

      expect(result).toBe(true);
      expect(logger.info).toHaveBeenCalledWith(
        '[NsfwVerificationManager] Auto-verifying user user123 in NSFW channel thread-123'
      );
    });

    it('should not auto-verify users in SFW threads', () => {
      const thread = {
        guild: { id: 'guild123' },
        isThread: () => true,
        parentId: 'sfw-channel-123',
        id: 'thread-123',
      };
      const userId = 'user123';

      // Mock channelUtils to return false for SFW thread
      channelUtils.isChannelNSFW.mockReturnValue(false);

      const result = manager.shouldAutoVerify(thread, userId);

      expect(result).toBe(false);
      expect(logger.info).not.toHaveBeenCalled();
    });
  });

  describe('verifyAccess - Thread Scenarios', () => {
    const mockUserId = '123456789012345678';

    it('should auto-verify non-verified users in NSFW threads', () => {
      const nsfwThread = {
        guild: { id: 'guild-123' },
        isThread: () => true,
        parentId: 'nsfw-channel-123',
        id: 'thread-123',
      };

      // Mock channelUtils to return true for NSFW thread
      channelUtils.isChannelNSFW.mockReturnValue(true);

      const result = manager.verifyAccess(nsfwThread, mockUserId);

      expect(result.isAllowed).toBe(true);
      expect(result.reason).toBe('User auto-verified in NSFW channel');
      expect(result.autoVerified).toBe(true);
      expect(manager.isNsfwVerified(mockUserId)).toBe(true);
      expect(logger.info).toHaveBeenCalledWith(
        `[NsfwVerificationManager] Auto-verifying user ${mockUserId} in NSFW channel thread-123`
      );
    });

    it('should block non-verified users in SFW threads', () => {
      const sfwThread = {
        guild: { id: 'guild-123' },
        isThread: () => true,
        parentId: 'sfw-channel-123',
        id: 'thread-123',
      };

      // Mock channelUtils to return false for SFW thread
      channelUtils.isChannelNSFW.mockReturnValue(false);

      const result = manager.verifyAccess(sfwThread, mockUserId);

      expect(result.isAllowed).toBe(false);
      expect(result.reason).toContain(`<@${mockUserId}> has not completed NSFW verification`);
      expect(result.reason).toContain(`\`${botPrefix} verify\``);
    });

    it('should allow verified users in NSFW threads', () => {
      const nsfwThread = {
        guild: { id: 'guild-123' },
        isThread: () => true,
        parentId: 'nsfw-channel-123',
        id: 'thread-123',
      };

      // Pre-verify the user
      manager.storeNsfwVerification(mockUserId, true);

      // Mock channelUtils to return true for NSFW thread
      channelUtils.isChannelNSFW.mockReturnValue(true);

      const result = manager.verifyAccess(nsfwThread, mockUserId);

      expect(result.isAllowed).toBe(true);
      expect(result.reason).toBe('User is verified and channel is NSFW');
    });

    it('should block verified users in SFW threads', () => {
      const sfwThread = {
        guild: { id: 'guild-123' },
        isThread: () => true,
        parentId: 'sfw-channel-123',
        id: 'thread-123',
      };

      // Pre-verify the user
      manager.storeNsfwVerification(mockUserId, true);

      // Mock channelUtils to return false for SFW thread
      channelUtils.isChannelNSFW.mockReturnValue(false);

      const result = manager.verifyAccess(sfwThread, mockUserId);

      expect(result.isAllowed).toBe(false);
      expect(result.reason).toBe(
        'NSFW-verified users can only use personalities in NSFW channels or DMs'
      );
    });
  });

  describe('verifyAccess - Forum Thread Scenarios', () => {
    const mockUserId = '123456789012345678';

    it('should handle forum threads with parentId', () => {
      const forumThread = {
        guild: { id: 'guild-123' },
        isThread: () => true,
        parentId: 'nsfw-forum-123', // Forum channel ID
        id: 'forum-thread-123',
        type: 11, // Public thread type
      };

      // Mock channelUtils to return true for NSFW forum thread
      channelUtils.isChannelNSFW.mockReturnValue(true);

      const result = manager.verifyAccess(forumThread, mockUserId);

      expect(result.isAllowed).toBe(true);
      expect(result.reason).toBe('User auto-verified in NSFW channel');
      expect(result.autoVerified).toBe(true);
      expect(channelUtils.isChannelNSFW).toHaveBeenCalledWith(forumThread);
    });

    it('should block access in SFW forum threads', () => {
      const forumThread = {
        guild: { id: 'guild-123' },
        isThread: () => true,
        parentId: 'sfw-forum-123',
        id: 'forum-thread-123',
        type: 11,
      };

      // Mock channelUtils to return false for SFW forum thread
      channelUtils.isChannelNSFW.mockReturnValue(false);

      const result = manager.verifyAccess(forumThread, mockUserId);

      expect(result.isAllowed).toBe(false);
      expect(result.reason).toContain('has not completed NSFW verification');
    });
  });

  describe('verifyAccess - Proxy Systems in Threads', () => {
    const mockUserId = '123456789012345678';
    const webhookUserTracker = require('../../../../src/utils/webhookUserTracker');

    it('should auto-verify proxy users in NSFW threads', () => {
      const nsfwThread = {
        guild: { id: 'guild-123' },
        isThread: () => true,
        parentId: 'nsfw-channel-123',
        id: 'thread-123',
      };

      const proxyMessage = {
        author: {
          bot: true,
          username: 'pk; System[APP]',
          discriminator: '0000',
          id: 'webhook123',
        },
      };

      // Mock channelUtils to return true for NSFW thread
      channelUtils.isChannelNSFW.mockReturnValue(true);

      // Mock webhook tracker to return real user
      webhookUserTracker.findRealUserId.mockReturnValue(mockUserId);

      const result = manager.verifyAccess(nsfwThread, mockUserId, proxyMessage);

      expect(result.isAllowed).toBe(true);
      expect(result.reason).toBe(`Proxy user ${mockUserId} auto-verified in NSFW channel`);
      expect(result.autoVerified).toBe(true);
      expect(result.isProxy).toBe(true);
      expect(result.systemType).toBe('pluralkit');
      expect(manager.isNsfwVerified(mockUserId)).toBe(true);
    });

    it('should block proxy users in SFW threads', () => {
      const sfwThread = {
        guild: { id: 'guild-123' },
        isThread: () => true,
        parentId: 'sfw-channel-123',
        id: 'thread-123',
      };

      const proxyMessage = {
        author: {
          bot: true,
          username: 'pk; System[APP]',
          discriminator: '0000',
          id: 'webhook123',
        },
      };

      // Mock channelUtils to return false for SFW thread
      channelUtils.isChannelNSFW.mockReturnValue(false);

      // Mock webhook tracker to return real user
      webhookUserTracker.findRealUserId.mockReturnValue(mockUserId);

      const result = manager.verifyAccess(sfwThread, mockUserId, proxyMessage);

      expect(result.isAllowed).toBe(false);
      expect(result.reason).toContain('has not completed NSFW verification');
      expect(result.isProxy).toBe(true);
      expect(result.systemType).toBe('pluralkit');
    });
  });

  describe('Edge Cases', () => {
    it('should handle threads without parent reference gracefully', () => {
      const brokenThread = {
        guild: { id: 'guild-123' },
        isThread: () => true,
        // No parentId or parent reference
        id: 'broken-thread-123',
      };

      // Mock channelUtils to handle broken thread gracefully
      channelUtils.isChannelNSFW.mockReturnValue(false);

      const result = manager.requiresNsfwVerification(brokenThread);

      expect(result).toBe(false);
      expect(channelUtils.isChannelNSFW).toHaveBeenCalledWith(brokenThread);
    });

    it('should handle regular channels that are not threads', () => {
      const regularChannel = {
        guild: { id: 'guild-123' },
        nsfw: true,
        id: 'channel-123',
      };

      // Mock channelUtils to return true for NSFW channel
      channelUtils.isChannelNSFW.mockReturnValue(true);

      const result = manager.requiresNsfwVerification(regularChannel);

      expect(result).toBe(true);
      expect(channelUtils.isChannelNSFW).toHaveBeenCalledWith(regularChannel);
    });
  });
});
