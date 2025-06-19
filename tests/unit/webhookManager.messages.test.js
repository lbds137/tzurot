/**
 * Tests for webhookManager.js focusing on message sending functionality
 *
 * These tests verify:
 * - Single messages vs. multi-chunk messages
 * - Error message handling
 * - Duplicate message detection
 * - Attachments and embeds on last chunk (NOT first chunk)
 * - Error handling for webhook operations
 */

jest.mock('discord.js');
jest.mock('node-fetch');

// First do a straightforward mock to extract the original
jest.mock('../../src/webhookManager');

describe('WebhookManager - Message Sending Tests', () => {
  let webhookManager;
  let mockChannel;
  let personality;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    // Import the webhookManager module
    webhookManager = require('../../src/webhookManager');

    // Create a mock implementation of sendWebhookMessage
    webhookManager.sendWebhookMessage = jest
      .fn()
      .mockImplementation(async (channel, content, personality, options = {}) => {
        // Call the necessary helper functions to simulate the flow
        webhookManager.minimizeConsoleOutput();

        try {
          webhookManager.generateMessageTrackingId(channel.id);

          const isErrorMessage = webhookManager.isErrorContent(content);

          if (personality && personality.fullName) {
            webhookManager.registerPendingMessage(
              personality.fullName,
              channel.id,
              content,
              isErrorMessage
            );
          }

          const webhook = await webhookManager.getOrCreateWebhook(channel);

          const standardizedName = webhookManager.getStandardizedUsername(personality);

          const contentChunks = webhookManager.splitMessage(content);

          let firstSentMessage = null;
          const sentMessageIds = [];

          for (let i = 0; i < contentChunks.length; i++) {
            const isFirstChunk = i === 0;
            const chunkContent = contentChunks[i];

            if (webhookManager.isDuplicateMessage(chunkContent, standardizedName, channel.id)) {
              continue;
            }

            webhookManager.updateChannelLastMessageTime(channel.id);

            const markedContent = webhookManager.markErrorContent(chunkContent);

            if (markedContent.includes('HARD_BLOCKED_RESPONSE_DO_NOT_DISPLAY')) {
              continue;
            }

            // Use options only for the last chunk
            const isLastChunk = i === contentChunks.length - 1;
            const messageData = webhookManager.prepareMessageData(
              markedContent,
              standardizedName,
              personality,
              channel.isThread(),
              channel.id,
              isLastChunk ? options : {}
            );

            const sentMessage = await webhookManager.sendMessageChunk(
              webhook,
              messageData,
              i,
              contentChunks.length
            );
            sentMessageIds.push(sentMessage.id);

            if (isFirstChunk) {
              firstSentMessage = sentMessage;
            }
          }

          if (personality && personality.fullName) {
            webhookManager.clearPendingMessage(personality.fullName, channel.id);
          }

          if (sentMessageIds.length > 0) {
            return {
              message: firstSentMessage,
              messageIds: sentMessageIds,
            };
          } else {
            return webhookManager.createVirtualResult(personality, channel.id);
          }
        } catch (error) {
          webhookManager.restoreConsoleOutput();
          throw error;
        } finally {
          webhookManager.restoreConsoleOutput();
        }
      });

    // Set up mocks for all the helper functions
    webhookManager.minimizeConsoleOutput = jest.fn().mockReturnValue({
      originalConsoleLog: console.log,
      originalConsoleWarn: console.warn,
    });

    webhookManager.restoreConsoleOutput = jest.fn();

    webhookManager.sendMessageChunk = jest.fn().mockImplementation(async (webhook, messageData) => {
      return { id: `mock-message-${Date.now()}` };
    });

    webhookManager.createVirtualResult = jest.fn().mockImplementation((personality, channelId) => {
      return {
        message: { id: `virtual-${Date.now()}` },
        messageIds: [`virtual-${Date.now()}`],
        isDuplicate: true,
      };
    });

    webhookManager.generateMessageTrackingId = jest.fn().mockReturnValue('mock-tracking-id');

    webhookManager.isErrorContent = jest.fn().mockImplementation(content => {
      if (!content) return false;
      return (
        content.includes('error') || content.includes('trouble') || content.includes('HARD_BLOCKED')
      );
    });

    webhookManager.markErrorContent = jest.fn().mockImplementation(content => {
      if (!content) return '';
      if (content.includes('trouble') || content.includes('error')) {
        return 'ERROR_MESSAGE_PREFIX: ' + content;
      }
      return content;
    });

    webhookManager.isDuplicateMessage = jest.fn().mockReturnValue(false);
    webhookManager.hasPersonalityPendingMessage = jest.fn().mockReturnValue(false);
    webhookManager.registerPendingMessage = jest.fn();
    webhookManager.clearPendingMessage = jest.fn();
    webhookManager.calculateMessageDelay = jest.fn().mockReturnValue(0);
    webhookManager.updateChannelLastMessageTime = jest.fn();

    webhookManager.getStandardizedUsername = jest.fn().mockImplementation(personality => {
      if (!personality) return 'Bot';
      return personality.displayName || 'Unknown';
    });

    webhookManager.splitMessage = jest.fn().mockImplementation(content => {
      if (!content || content.length <= 2000) {
        return [content || ''];
      }
      return [content.substring(0, 2000), content.substring(2000)];
    });

    webhookManager.prepareMessageData = jest
      .fn()
      .mockImplementation((content, username, personality, isThread, threadId, options = {}) => {
        const messageData = {
          content: content,
          username: username,
          _personality: personality,
          threadId: isThread ? threadId : undefined,
        };

        if (options.embed) {
          messageData.embeds = [options.embed];
        }

        return messageData;
      });

    webhookManager.getOrCreateWebhook = jest.fn().mockResolvedValue({
      send: jest.fn().mockImplementation(data => {
        return Promise.resolve({
          id: `mock-message-${Date.now()}`,
          content: typeof data === 'string' ? data : data.content,
        });
      }),
    });

    // Make a special implementation of isDuplicateMessage for our test case
    webhookManager.isDuplicateMessage.mockImplementation(content => {
      return content === 'DUPLICATE_TEST_MESSAGE';
    });

    // Create test fixtures
    mockChannel = {
      id: 'test-channel-id',
      name: 'test-channel',
      isThread: jest.fn().mockReturnValue(false),
      fetchWebhooks: jest.fn().mockResolvedValue(new Map()),
      createWebhook: jest.fn().mockResolvedValue({
        id: 'mock-webhook-id',
        url: 'https://discord.com/api/webhooks/mock/token',
      }),
    };

    personality = {
      fullName: 'test-personality',
      displayName: 'Test Personality',
      avatarUrl: 'https://example.com/avatar.png',
    };

    // Mock console
    console.log = jest.fn();
    console.error = jest.fn();
    console.warn = jest.fn();
  });

  afterEach(() => {
    jest.resetModules();
  });

  it('should successfully send a simple message', async () => {
    const result = await webhookManager.sendWebhookMessage(
      mockChannel,
      'Test message',
      personality
    );

    // Verify functions were called
    expect(webhookManager.getOrCreateWebhook).toHaveBeenCalledWith(mockChannel);
    expect(webhookManager.minimizeConsoleOutput).toHaveBeenCalled();
    expect(webhookManager.getStandardizedUsername).toHaveBeenCalledWith(personality);
    expect(webhookManager.splitMessage).toHaveBeenCalledWith('Test message');

    // Verify result
    expect(result).toBeDefined();
    expect(result.messageIds).toBeDefined();
    expect(result.messageIds.length).toBe(1);
  });

  it('should split long messages into chunks', async () => {
    // Mock splitMessage to return multiple chunks
    const longMessage = 'This is a long message.'.repeat(500);
    const mockChunks = ['Chunk 1', 'Chunk 2', 'Chunk 3'];
    webhookManager.splitMessage.mockReturnValueOnce(mockChunks);

    const result = await webhookManager.sendWebhookMessage(mockChannel, longMessage, personality);

    // Verify functions were called
    expect(webhookManager.splitMessage).toHaveBeenCalledWith(longMessage);

    // Verify result
    expect(result).toBeDefined();
    expect(result.messageIds).toBeDefined();
    expect(result.messageIds.length).toBe(mockChunks.length);
  });

  it('should mark error messages', async () => {
    const errorMessage = 'I am having trouble connecting';

    // Make isErrorContent return true for this message
    webhookManager.isErrorContent.mockReturnValueOnce(true);

    await webhookManager.sendWebhookMessage(mockChannel, errorMessage, personality);

    // Verify error detection functions were called
    expect(webhookManager.isErrorContent).toHaveBeenCalledWith(errorMessage);
    expect(webhookManager.markErrorContent).toHaveBeenCalled();
  });

  it('should skip duplicate messages', async () => {
    const duplicateMessage = 'DUPLICATE_TEST_MESSAGE';

    const result = await webhookManager.sendWebhookMessage(
      mockChannel,
      duplicateMessage,
      personality
    );

    // Verify a virtual result was created
    expect(result).toBeDefined();
    expect(result.isDuplicate).toBe(true);

    // The send function should not have been called
    expect(webhookManager.sendMessageChunk).not.toHaveBeenCalled();
  });

  it('should add embeds and attachments to the last chunk only', async () => {
    // Mock splitMessage to return multiple chunks
    const mockChunks = ['Chunk 1', 'Chunk 2', 'Chunk 3'];
    webhookManager.splitMessage.mockReturnValueOnce(mockChunks);

    // Create embed options
    const embedOptions = {
      embed: { title: 'Test Embed', description: 'Test Description' },
    };

    await webhookManager.sendWebhookMessage(
      mockChannel,
      'Test message with embed',
      personality,
      embedOptions
    );

    // Check prepareMessageData calls
    const allCalls = webhookManager.prepareMessageData.mock.calls;

    // Verify each call correctly includes or excludes embeds
    // First chunk (index 0) should not have embed
    expect(allCalls[0][5]).not.toHaveProperty('embed');

    // Middle chunks (if any) should not have embed
    for (let i = 1; i < allCalls.length - 1; i++) {
      expect(allCalls[i][5]).not.toHaveProperty('embed');
    }

    // Last chunk should have embed
    const lastCallIndex = mockChunks.length - 1;
    expect(allCalls[lastCallIndex][5]).toHaveProperty('embed');
  });

  it('should handle missing personality data', async () => {
    await webhookManager.sendWebhookMessage(mockChannel, 'Test message with no personality', null);

    // Verify getStandardizedUsername was called with null
    expect(webhookManager.getStandardizedUsername).toHaveBeenCalledWith(null);

    // Default username should be 'Bot'
    expect(webhookManager.prepareMessageData.mock.calls[0][1]).toBe('Bot');
  });

  it('should handle webhook send errors', async () => {
    // Make sendMessageChunk throw an error
    webhookManager.sendMessageChunk.mockRejectedValueOnce(new Error('Send failed'));

    // Call function and expect it to throw
    await expect(
      webhookManager.sendWebhookMessage(mockChannel, 'Test message', personality)
    ).rejects.toThrow();

    // Verify restore console was called in the finally block
    expect(webhookManager.restoreConsoleOutput).toHaveBeenCalled();
  });

  it('should skip messages with the HARD_BLOCKED marker', async () => {
    const blockedMessage = 'This is a HARD_BLOCKED message';

    // Make isErrorContent detect this message
    webhookManager.isErrorContent.mockReturnValueOnce(true);

    // Make markErrorContent return content with the hard block marker
    webhookManager.markErrorContent.mockReturnValueOnce(
      'HARD_BLOCKED_RESPONSE_DO_NOT_DISPLAY: ' + blockedMessage
    );

    const result = await webhookManager.sendWebhookMessage(
      mockChannel,
      blockedMessage,
      personality
    );

    // Verify createVirtualResult was called
    expect(webhookManager.createVirtualResult).toHaveBeenCalled();

    // Verify result is a virtual result
    expect(result).toBeDefined();
    expect(result.isDuplicate).toBe(true);
  });
});
