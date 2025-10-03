const threadHandler = require('../../../src/utils/threadHandler');
const logger = require('../../../src/logger');

// Mock dependencies
jest.mock('../../../src/logger');

describe('Thread Handler Module', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('detectThread', () => {
    it('should detect native threads', () => {
      const channel = {
        id: 'thread123',
        type: 'GUILD_PUBLIC_THREAD',
        isThread: jest.fn().mockReturnValue(true),
        parent: { id: 'parent123', name: 'general', type: 'GUILD_TEXT' },
      };

      const result = threadHandler.detectThread(channel);

      expect(result.isThread).toBe(true);
      expect(result.isNativeThread).toBe(true);
      expect(result.isForcedThread).toBe(false);
      expect(channel.isThread).toHaveBeenCalled();
    });

    it('should force thread detection for thread types', () => {
      const channel = {
        id: 'thread123',
        type: 'GUILD_PUBLIC_THREAD',
        isThread: jest.fn().mockReturnValue(false),
      };

      const result = threadHandler.detectThread(channel);

      expect(result.isThread).toBe(true);
      expect(result.isNativeThread).toBe(false);
      expect(result.isForcedThread).toBe(true);
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Thread detection was forced')
      );
    });

    it('should handle forum channels', () => {
      const channel = {
        id: 'forum123',
        type: 'FORUM',
      };

      const result = threadHandler.detectThread(channel);

      expect(result.isThread).toBe(true);
      expect(result.channelType).toBe('FORUM');
    });

    it('should handle numeric channel types', () => {
      const channel = {
        id: 'thread123',
        type: 11, // GuildPublicThread
        isThread: jest.fn().mockReturnValue(true),
      };

      const result = threadHandler.detectThread(channel);

      expect(result.isThread).toBe(true);
    });

    it('should detect non-threads', () => {
      const channel = {
        id: 'channel123',
        type: 'GUILD_TEXT',
        isThread: jest.fn().mockReturnValue(false),
      };

      const result = threadHandler.detectThread(channel);

      expect(result.isThread).toBe(false);
      expect(result.isNativeThread).toBe(false);
      expect(result.isForcedThread).toBe(false);
    });
  });

  describe('isForumChannel', () => {
    it('should detect direct forum channels', () => {
      const channel = { type: 'FORUM' };
      expect(threadHandler.isForumChannel(channel)).toBe(true);
    });

    it('should detect numeric forum types', () => {
      const channel = { type: 15 }; // GuildForum
      expect(threadHandler.isForumChannel(channel)).toBe(true);
    });

    it('should detect forum threads by parent', () => {
      const channel = {
        type: 'GUILD_PUBLIC_THREAD',
        parent: { type: 'FORUM' },
      };
      expect(threadHandler.isForumChannel(channel)).toBe(true);
    });

    it('should return false for non-forum channels', () => {
      const channel = { type: 'GUILD_TEXT' };
      expect(threadHandler.isForumChannel(channel)).toBe(false);
    });
  });

  describe('buildThreadWebhookOptions', () => {
    it('should build basic options for non-threads', () => {
      const channel = {
        id: 'channel123',
        type: 'GUILD_TEXT',
      };
      const threadInfo = { isThread: false };

      const options = threadHandler.buildThreadWebhookOptions(
        channel,
        'user123',
        threadInfo,
        false
      );

      expect(options).toEqual({
        userId: 'user123',
        channelType: 'GUILD_TEXT',
        isReplyToDMFormattedMessage: false,
      });
    });

    it('should add thread options for threads', () => {
      const channel = {
        id: 'thread123',
        type: 'GUILD_PUBLIC_THREAD',
      };
      const threadInfo = { isThread: true };

      const options = threadHandler.buildThreadWebhookOptions(channel, 'user123', threadInfo);

      expect(options.threadId).toBe('thread123');
      expect(options.channelType).toBe('GUILD_PUBLIC_THREAD');
    });

    it('should add forum options for forum channels', () => {
      const channel = {
        id: 'forum123',
        type: 'FORUM',
      };
      const threadInfo = { isThread: true };

      const options = threadHandler.buildThreadWebhookOptions(channel, 'user123', threadInfo);

      expect(options.isForum).toBe(true);
      expect(options.forum).toBe(true);
      expect(options.forumThreadId).toBe('forum123');
    });

    it('should handle missing thread ID', () => {
      const channel = {
        type: 'GUILD_PUBLIC_THREAD',
      };
      const threadInfo = { isThread: true };

      const options = threadHandler.buildThreadWebhookOptions(channel, 'user123', threadInfo);

      expect(options.threadId).toBeUndefined();
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Thread detected but threadId is not set')
      );
    });
  });

  describe('sendThreadMessage', () => {
    let mockWebhookManager;
    let mockChannel;
    let mockPersonality;

    beforeEach(() => {
      mockWebhookManager = {
        sendDirectThreadMessage: jest.fn(),
        sendWebhookMessage: jest.fn(),
      };

      mockChannel = {
        id: 'thread123',
        send: jest.fn(),
      };

      mockPersonality = {
        fullName: 'test-personality',
        displayName: 'Test',
      };
    });

    it('should succeed with direct thread message', async () => {
      const expectedResult = { messageIds: ['msg123'] };
      mockWebhookManager.sendDirectThreadMessage.mockResolvedValue(expectedResult);

      const result = await threadHandler.sendThreadMessage(
        mockWebhookManager,
        mockChannel,
        'Hello',
        mockPersonality,
        {},
        {}
      );

      expect(result).toBe(expectedResult);
      expect(mockWebhookManager.sendDirectThreadMessage).toHaveBeenCalled();
    });

    it('should fallback to webhook message on thread failure', async () => {
      const expectedResult = { messageIds: ['msg456'] };
      mockWebhookManager.sendDirectThreadMessage.mockRejectedValue(new Error('Thread failed'));
      mockWebhookManager.sendWebhookMessage.mockResolvedValue(expectedResult);

      const result = await threadHandler.sendThreadMessage(
        mockWebhookManager,
        mockChannel,
        'Hello',
        mockPersonality,
        {},
        {}
      );

      expect(result).toBe(expectedResult);
      expect(mockWebhookManager.sendWebhookMessage).toHaveBeenCalled();
    });

    it('should fallback to direct send on all webhook failures', async () => {
      const directMessage = { id: 'direct789' };
      mockWebhookManager.sendDirectThreadMessage.mockRejectedValue(new Error('Thread failed'));
      mockWebhookManager.sendWebhookMessage.mockRejectedValue(new Error('Webhook failed'));
      mockChannel.send.mockResolvedValue(directMessage);

      const result = await threadHandler.sendThreadMessage(
        mockWebhookManager,
        mockChannel,
        'Hello',
        mockPersonality,
        {},
        {}
      );

      expect(result.messageIds).toEqual(['direct789']);
      expect(result.isEmergencyFallback).toBe(true);
      expect(mockChannel.send).toHaveBeenCalledWith('**Test:** Hello');
    });

    it('should throw if all methods fail', async () => {
      mockWebhookManager.sendDirectThreadMessage.mockRejectedValue(new Error('Thread failed'));
      mockWebhookManager.sendWebhookMessage.mockRejectedValue(new Error('Webhook failed'));
      mockChannel.send.mockRejectedValue(new Error('Send failed'));

      await expect(
        threadHandler.sendThreadMessage(
          mockWebhookManager,
          mockChannel,
          'Hello',
          mockPersonality,
          {},
          {}
        )
      ).rejects.toThrow('Send failed');
    });
  });

  describe('getThreadInfo', () => {
    it('should gather all thread information', () => {
      const channel = {
        id: 'thread123',
        name: 'Discussion Thread',
        type: 'GUILD_PUBLIC_THREAD',
        isThread: jest.fn().mockReturnValue(true),
        parentId: 'parent123',
        parent: {
          id: 'parent123',
          name: 'general',
          type: 'GUILD_TEXT',
        },
        isTextBased: jest.fn().mockReturnValue(true),
        isVoiceBased: jest.fn().mockReturnValue(false),
        isDMBased: jest.fn().mockReturnValue(false),
      };

      const info = threadHandler.getThreadInfo(channel);

      expect(info).toEqual({
        id: 'thread123',
        name: 'Discussion Thread',
        type: 'GUILD_PUBLIC_THREAD',
        isThread: true,
        parentId: 'parent123',
        parentName: 'general',
        parentType: 'GUILD_TEXT',
        isTextBased: true,
        isVoiceBased: false,
        isDMBased: false,
      });
    });

    it('should handle missing parent', () => {
      const channel = {
        id: 'thread123',
        name: 'Thread',
        type: 'GUILD_PUBLIC_THREAD',
      };

      const info = threadHandler.getThreadInfo(channel);

      expect(info.parentId).toBeUndefined();
      expect(info.parentName).toBeUndefined();
      expect(info.parentType).toBeUndefined();
    });
  });
});
