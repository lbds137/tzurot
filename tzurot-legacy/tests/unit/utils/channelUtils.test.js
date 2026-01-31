const { isChannelNSFW } = require('../../../src/utils/channelUtils');
const logger = require('../../../src/logger');

// Mock logger
jest.mock('../../../src/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

describe('channelUtils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('isChannelNSFW', () => {
    it('should return false for null or undefined channel', () => {
      expect(isChannelNSFW(null)).toBe(false);
      expect(isChannelNSFW(undefined)).toBe(false);
    });

    it('should return true for channels with nsfw flag', () => {
      const channel = { nsfw: true };
      expect(isChannelNSFW(channel)).toBe(true);
    });

    it('should return false for channels without nsfw flag', () => {
      const channel = { nsfw: false };
      expect(isChannelNSFW(channel)).toBe(false);
    });

    it('should check parent channel for threads', () => {
      const parentChannel = { id: 'parent123', nsfw: true };
      const threadChannel = {
        id: 'thread123',
        nsfw: false,
        isThread: () => true,
        parent: parentChannel,
      };

      expect(isChannelNSFW(threadChannel)).toBe(true);
      expect(logger.debug).toHaveBeenCalledWith(
        '[ChannelUtils] Channel thread123 is a thread, checking parent parent123 for NSFW status'
      );
    });

    it('should try parentChannel property if parent is not available', () => {
      const parentChannel = { id: 'parent123', nsfw: true };
      const threadChannel = {
        id: 'thread123',
        nsfw: false,
        isThread: () => true,
        parentChannel: parentChannel,
      };

      expect(isChannelNSFW(threadChannel)).toBe(true);
    });

    it('should try parentTextChannel property if others are not available', () => {
      const parentChannel = { id: 'parent123', nsfw: true };
      const threadChannel = {
        id: 'thread123',
        nsfw: false,
        isThread: () => true,
        parentTextChannel: parentChannel,
      };

      expect(isChannelNSFW(threadChannel)).toBe(true);
    });

    it('should return false for non-NSFW parent channels', () => {
      const parentChannel = { id: 'parent123', nsfw: false };
      const threadChannel = {
        id: 'thread123',
        nsfw: false,
        isThread: () => true,
        parent: parentChannel,
      };

      expect(isChannelNSFW(threadChannel)).toBe(false);
    });

    it('should handle errors when checking thread parent', () => {
      const threadChannel = {
        id: 'thread123',
        nsfw: false,
        isThread: () => true,
        get parent() {
          throw new Error('Parent access error');
        },
      };

      expect(isChannelNSFW(threadChannel)).toBe(false);
      expect(logger.error).toHaveBeenCalledWith(
        '[ChannelUtils] Error checking thread parent NSFW status: Parent access error'
      );
    });

    it('should check forum thread parent using parentId', () => {
      const mockParent = { id: 'parent456', nsfw: true };
      const mockGuild = {
        channels: {
          cache: {
            get: jest.fn().mockReturnValue(mockParent),
          },
        },
      };

      const forumThread = {
        id: 'forum123',
        nsfw: false,
        parentId: 'parent456',
        guild: mockGuild,
      };

      expect(isChannelNSFW(forumThread)).toBe(true);
      expect(mockGuild.channels.cache.get).toHaveBeenCalledWith('parent456');
      expect(logger.debug).toHaveBeenCalledWith(
        '[ChannelUtils] Found parent channel parent456 for thread forum123'
      );
    });

    it('should return false if forum thread parent is not found', () => {
      const mockGuild = {
        channels: {
          cache: {
            get: jest.fn().mockReturnValue(null),
          },
        },
      };

      const forumThread = {
        id: 'forum123',
        nsfw: false,
        parentId: 'parent456',
        guild: mockGuild,
      };

      expect(isChannelNSFW(forumThread)).toBe(false);
    });

    it('should handle errors when checking forum thread parent', () => {
      const forumThread = {
        id: 'forum123',
        nsfw: false,
        parentId: 'parent456',
        get guild() {
          throw new Error('Guild access error');
        },
      };

      expect(isChannelNSFW(forumThread)).toBe(false);
      expect(logger.error).toHaveBeenCalledWith(
        '[ChannelUtils] Error checking forum thread parent: Guild access error'
      );
    });

    it('should handle channels without isThread method', () => {
      const channel = {
        id: 'channel123',
        nsfw: false,
        // No isThread method
      };

      expect(isChannelNSFW(channel)).toBe(false);
    });

    it('should handle thread with isThread returning false', () => {
      const channel = {
        id: 'channel123',
        nsfw: false,
        isThread: () => false,
        parent: { nsfw: true },
      };

      expect(isChannelNSFW(channel)).toBe(false);
    });

    it('should return false when guild is not available', () => {
      const forumThread = {
        id: 'forum123',
        nsfw: false,
        parentId: 'parent456',
        guild: null,
      };

      expect(isChannelNSFW(forumThread)).toBe(false);
    });
  });
});
