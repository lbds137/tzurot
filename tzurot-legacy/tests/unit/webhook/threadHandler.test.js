// Mock all dependencies before imports
jest.mock('../../../src/logger');
jest.mock('../../../src/utils/media/mediaHandler');
jest.mock('../../../src/utils/messageDeduplication');
jest.mock('../../../src/utils/messageSplitting');
jest.mock('../../../src/utils/avatarStorage');
jest.mock('../../../src/utils/webhookCache');
jest.mock('../../../config', () => ({
  botConfig: {
    name: 'TestWebhook',
  },
}));
jest.mock('discord.js');

const { WebhookClient } = require('discord.js');
const logger = require('../../../src/logger');
const { processMediaForWebhook } = require('../../../src/utils/media/mediaHandler');
const { isDuplicateMessage } = require('../../../src/utils/messageDeduplication');
const { prepareAndSplitMessage, chunkHelpers } = require('../../../src/utils/messageSplitting');
const avatarStorage = require('../../../src/utils/avatarStorage');
const webhookCache = require('../../../src/utils/webhookCache');
const { sendDirectThreadMessage } = require('../../../src/webhook/threadHandler');

describe('threadHandler', () => {
  let mockChannel;
  let mockParentChannel;
  let mockWebhook;
  let mockWebhookClient;
  let mockGetStandardizedUsername;
  let mockCreateVirtualResult;
  let mockDelayFn;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Mock console methods
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();

    // Create mock parent channel
    mockParentChannel = {
      id: 'parent-channel-123',
      fetchWebhooks: jest.fn(),
      createWebhook: jest.fn().mockResolvedValue({
        name: 'TestWebhook',
        url: 'https://discord.com/webhook/123',
      }),
    };

    // Create mock channel
    mockChannel = {
      id: 'thread-123',
      isThread: jest.fn().mockReturnValue(true),
      parent: mockParentChannel,
      send: jest.fn().mockResolvedValue({ id: 'direct-message-123' }),
    };

    // Create mock webhook
    mockWebhook = {
      name: 'TestWebhook',
      url: 'https://discord.com/webhook/123',
    };

    // Create mock webhook client
    mockWebhookClient = {
      send: jest.fn().mockResolvedValue({ id: 'message-123' }),
      thread: jest.fn(),
    };

    // Mock WebhookClient constructor
    WebhookClient.mockImplementation(() => mockWebhookClient);

    // Mock helper functions
    mockGetStandardizedUsername = jest.fn().mockReturnValue('TestPersonality');
    mockCreateVirtualResult = jest.fn().mockReturnValue({
      message: { id: 'virtual-123' },
      messageIds: ['virtual-123'],
      isVirtual: true,
    });
    mockDelayFn = jest.fn().mockResolvedValue(undefined);

    // Mock processMediaForWebhook to return the input content
    processMediaForWebhook.mockImplementation(async content => ({
      content: content,
      attachments: [],
    }));

    // Mock prepareAndSplitMessage
    prepareAndSplitMessage.mockImplementation((content, options, logPrefix) => {
      if (!content || content.length <= 2000) {
        return [content];
      }
      // Simple split for testing
      const chunks = [];
      for (let i = 0; i < content.length; i += 2000) {
        chunks.push(content.slice(i, i + 2000));
      }
      return chunks;
    });
    
    // Mock chunkHelpers
    chunkHelpers.isFirstChunk = jest.fn(i => i === 0);
    chunkHelpers.isLastChunk = jest.fn((i, len) => i === len - 1);
    chunkHelpers.getChunkDelay = jest.fn(() => 750);

    // Mock isDuplicateMessage - default to false
    isDuplicateMessage.mockReturnValue(false);

    // Mock avatarStorage
    avatarStorage.getLocalAvatarUrl.mockImplementation(async (personalityName, avatarUrl) => {
      // Return the same URL for simplicity in tests
      return avatarUrl;
    });

    // Mock webhookCache
    webhookCache.getOrCreateWebhook.mockResolvedValue(mockWebhookClient);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('sendDirectThreadMessage', () => {
    it('should validate channel is a thread', async () => {
      const nonThreadChannel = { id: 'not-thread', isThread: jest.fn().mockReturnValue(false) };

      await expect(
        sendDirectThreadMessage(
          nonThreadChannel,
          'content',
          { displayName: 'Test' },
          {},
          mockGetStandardizedUsername,
          mockCreateVirtualResult,
          mockDelayFn
        )
      ).rejects.toThrow('Cannot send direct thread message to non-thread channel');
    });

    it('should handle null channel', async () => {
      await expect(
        sendDirectThreadMessage(
          null,
          'content',
          { displayName: 'Test' },
          {},
          mockGetStandardizedUsername,
          mockCreateVirtualResult,
          mockDelayFn
        )
      ).rejects.toThrow('Cannot send direct thread message to non-thread channel');
    });

    it('should use webhookCache to get webhook client', async () => {
      await sendDirectThreadMessage(
        mockChannel,
        'Test content',
        { 
          displayName: 'TestPersonality', 
          fullName: 'test-personality',
          profile: { 
            avatarUrl: 'https://example.com/avatar.png' 
          }
        },
        {},
        mockGetStandardizedUsername,
        mockCreateVirtualResult,
        mockDelayFn
      );

      expect(webhookCache.getOrCreateWebhook).toHaveBeenCalledWith(mockChannel);
    });

    it('should send message using webhook client from cache', async () => {
      mockWebhookClient.send.mockResolvedValue({ id: 'message-123' });

      const result = await sendDirectThreadMessage(
        mockChannel,
        'Test content',
        { displayName: 'TestPersonality' },
        {},
        mockGetStandardizedUsername,
        mockCreateVirtualResult,
        mockDelayFn
      );

      expect(mockWebhookClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'Test content',
          username: 'TestPersonality',
          thread_id: 'thread-123'
        })
      );
      expect(result.messageIds).toEqual(['message-123']);
    });

    it('should not call parent channel methods directly (uses webhookCache)', async () => {
      mockWebhookClient.send.mockResolvedValue({ id: 'message-123' });

      await sendDirectThreadMessage(
        mockChannel,
        'Test content',
        { displayName: 'TestPersonality' },
        {},
        mockGetStandardizedUsername,
        mockCreateVirtualResult,
        mockDelayFn
      );

      // Should not call parent channel methods directly - webhookCache handles this
      expect(mockParentChannel.fetchWebhooks).not.toHaveBeenCalled();
      expect(mockParentChannel.createWebhook).not.toHaveBeenCalled();
      // Should use webhookCache instead
      expect(webhookCache.getOrCreateWebhook).toHaveBeenCalledWith(mockChannel);
    });

    it('should process media in content', async () => {
      mockWebhookClient.send.mockResolvedValue({ id: 'message-123' });

      processMediaForWebhook.mockResolvedValue({
        content: 'Processed content',
        attachments: [{ name: 'image.png', attachment: Buffer.from('data') }],
      });

      await sendDirectThreadMessage(
        mockChannel,
        'Content with https://example.com/image.png',
        { displayName: 'TestPersonality' },
        {},
        mockGetStandardizedUsername,
        mockCreateVirtualResult,
        mockDelayFn
      );

      expect(processMediaForWebhook).toHaveBeenCalledWith(
        'Content with https://example.com/image.png'
      );
    });

    it('should handle media processing errors gracefully', async () => {
      mockWebhookClient.send.mockResolvedValue({ id: 'message-123' });

      processMediaForWebhook.mockRejectedValue(new Error('Media error'));

      const result = await sendDirectThreadMessage(
        mockChannel,
        'Content with media',
        { displayName: 'TestPersonality' },
        {},
        mockGetStandardizedUsername,
        mockCreateVirtualResult,
        mockDelayFn
      );

      expect(result).toBeDefined();
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Error processing media'));
    });

    it('should split long messages into chunks', async () => {
      mockWebhookClient.send.mockResolvedValue({ id: 'message-123' });

      // Create a very long message that will be split
      const longContent = 'A'.repeat(2100); // Over Discord's 2000 char limit

      await sendDirectThreadMessage(
        mockChannel,
        longContent,
        { displayName: 'TestPersonality' },
        {},
        mockGetStandardizedUsername,
        mockCreateVirtualResult,
        mockDelayFn
      );

      // Should be called at least twice for the chunks
      expect(mockWebhookClient.send).toHaveBeenCalledTimes(2);
    });

    it('should add delay between chunks', async () => {
      mockWebhookClient.send.mockResolvedValue({ id: 'message-123' });

      const longContent = 'A'.repeat(2100);

      await sendDirectThreadMessage(
        mockChannel,
        longContent,
        { displayName: 'TestPersonality' },
        {},
        mockGetStandardizedUsername,
        mockCreateVirtualResult,
        mockDelayFn
      );

      // Should delay between chunks
      expect(mockDelayFn).toHaveBeenCalledWith(750);
    });

    it('should try thread_id parameter first', async () => {
      mockWebhookClient.send.mockResolvedValue({ id: 'message-123' });

      await sendDirectThreadMessage(
        mockChannel,
        'Test content',
        { 
          displayName: 'TestPersonality', 
          fullName: 'test-personality',
          profile: { 
            avatarUrl: 'https://example.com/avatar.png' 
          }
        },
        {},
        mockGetStandardizedUsername,
        mockCreateVirtualResult,
        mockDelayFn
      );

      expect(mockWebhookClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'Test content',
          username: 'TestPersonality',
          avatarURL: 'https://example.com/avatar.png',
          thread_id: 'thread-123',
        })
      );
    });

    it('should fallback to webhook.thread() method if thread_id fails', async () => {

      // First attempt with thread_id fails
      mockWebhookClient.send.mockRejectedValueOnce(new Error('Invalid thread_id'));

      // Create thread-specific webhook
      const threadWebhook = { send: jest.fn().mockResolvedValue({ id: 'message-123' }) };
      mockWebhookClient.thread.mockReturnValue(threadWebhook);

      await sendDirectThreadMessage(
        mockChannel,
        'Test content',
        { displayName: 'TestPersonality' },
        {},
        mockGetStandardizedUsername,
        mockCreateVirtualResult,
        mockDelayFn
      );

      expect(mockWebhookClient.thread).toHaveBeenCalledWith('thread-123');
      expect(threadWebhook.send).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'Test content',
          username: 'TestPersonality',
        })
      );
    });

    it('should fallback to channel.send() if all webhook methods fail', async () => {

      // Both webhook attempts fail
      mockWebhookClient.send.mockRejectedValue(new Error('Webhook failed'));
      mockWebhookClient.thread.mockImplementation(() => {
        throw new Error('Thread method not available');
      });

      mockChannel.send.mockResolvedValue({ id: 'direct-message-123' });

      const result = await sendDirectThreadMessage(
        mockChannel,
        'Test content',
        { displayName: 'TestPersonality' },
        {},
        mockGetStandardizedUsername,
        mockCreateVirtualResult,
        mockDelayFn
      );

      expect(mockChannel.send).toHaveBeenCalledWith({
        content: '**TestPersonality:** Test content',
      });
      expect(result.messageIds).toContain('direct-message-123');
    });

    it('should include files and embeds in last chunk only', async () => {
      mockWebhookClient.send.mockResolvedValue({ id: 'message-123' });

      const embeds = [{ title: 'Test Embed' }];
      const files = [{ name: 'test.txt', attachment: Buffer.from('test') }];

      await sendDirectThreadMessage(
        mockChannel,
        'Short content',
        { displayName: 'TestPersonality' },
        { embeds, files },
        mockGetStandardizedUsername,
        mockCreateVirtualResult,
        mockDelayFn
      );

      expect(mockWebhookClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds,
          files,
        })
      );
    });

    it('should skip duplicate messages', async () => {

      // Mock isDuplicateMessage to return true
      isDuplicateMessage.mockReturnValue(true);

      const result = await sendDirectThreadMessage(
        mockChannel,
        'Duplicate content',
        { displayName: 'TestPersonality' },
        {},
        mockGetStandardizedUsername,
        mockCreateVirtualResult,
        mockDelayFn
      );

      expect(mockWebhookClient.send).not.toHaveBeenCalled();
      expect(mockCreateVirtualResult).toHaveBeenCalled();
    });

    it('should handle missing parent channel', async () => {
      const orphanThread = {
        id: 'orphan-thread',
        isThread: jest.fn().mockReturnValue(true),
        parent: null,
      };

      // Mock webhookCache to fail for orphan thread
      webhookCache.getOrCreateWebhook.mockRejectedValue(new Error('Cannot find parent channel for thread orphan-thread'));

      await expect(
        sendDirectThreadMessage(
          orphanThread,
          'content',
          { displayName: 'Test' },
          {},
          mockGetStandardizedUsername,
          mockCreateVirtualResult,
          mockDelayFn
        )
      ).rejects.toThrow('Cannot find parent channel for thread');
    });

    it('should handle webhook creation failure', async () => {
      // Mock webhookCache to fail with permission error
      webhookCache.getOrCreateWebhook.mockRejectedValue(new Error('Permission denied'));

      await expect(
        sendDirectThreadMessage(
          mockChannel,
          'content',
          { displayName: 'Test' },
          {},
          mockGetStandardizedUsername,
          mockCreateVirtualResult,
          mockDelayFn
        )
      ).rejects.toThrow('Permission denied');
    });

    it('should propagate error if first chunk fails after all fallbacks', async () => {

      // All methods fail
      mockWebhookClient.send.mockRejectedValue(new Error('Webhook failed'));
      mockWebhookClient.thread = undefined; // No thread method
      mockChannel.send.mockRejectedValue(new Error('Channel send failed'));

      await expect(
        sendDirectThreadMessage(
          mockChannel,
          'Test content',
          { displayName: 'TestPersonality' },
          {},
          mockGetStandardizedUsername,
          mockCreateVirtualResult,
          mockDelayFn
        )
      ).rejects.toThrow('Channel send failed');
    });

    it('should continue with remaining chunks if non-first chunk fails', async () => {

      // First chunk succeeds, second fails, third succeeds
      mockWebhookClient.send
        .mockResolvedValueOnce({ id: 'message-1' })
        .mockRejectedValueOnce(new Error('Chunk 2 failed'))
        .mockResolvedValueOnce({ id: 'message-3' });

      const longContent = 'A'.repeat(3500); // Will create 3 chunks

      const result = await sendDirectThreadMessage(
        mockChannel,
        longContent,
        { displayName: 'TestPersonality' },
        {},
        mockGetStandardizedUsername,
        mockCreateVirtualResult,
        mockDelayFn
      );

      expect(result.messageIds).toHaveLength(2); // Only successful chunks
      expect(result.messageIds).toContain('message-1');
      expect(result.messageIds).toContain('direct-message-123'); // Third chunk falls back after second fails
    });
  });
});
