/**
 * Tests for nested message reference handling (reply to a reply)
 */

// Mock dependencies
jest.mock('../../src/logger');
jest.mock('../../src/core/conversation');
jest.mock('../../src/handlers/messageTrackerHandler');
jest.mock('../../src/application/services/FeatureFlags');
jest.mock('../../src/application/bootstrap/ApplicationBootstrap');

const logger = require('../../src/logger');
const { handleMessageReference } = require('../../src/handlers/referenceHandler');
const { getPersonalityFromMessage } = require('../../src/core/conversation');
const messageTrackerHandler = require('../../src/handlers/messageTrackerHandler');
const { createFeatureFlags } = require('../../src/application/services/FeatureFlags');
const { getApplicationBootstrap } = require('../../src/application/bootstrap/ApplicationBootstrap');

describe('Nested Reference Handling', () => {
  let mockMessage;
  let mockReferencedMessage;
  let mockNestedReferencedMessage;
  let mockChannel;
  let mockGuild;
  let mockHandlePersonalityInteraction;
  let mockClient;

  beforeEach(() => {
    jest.clearAllMocks();

    // Set up mock guild
    mockGuild = {
      id: 'guild-123',
    };

    // Set up mock channel
    mockChannel = {
      id: 'channel-123',
      messages: {
        fetch: jest.fn(),
      },
      isDMBased: jest.fn().mockReturnValue(false), // Not a DM channel
    };

    // Set up the nested referenced message (the original message being referenced)
    mockNestedReferencedMessage = {
      id: 'nested-msg-123',
      content: 'This is the original message',
      author: {
        id: 'user-789',
        username: 'OriginalUser',
        bot: false,
      },
      webhookId: null,
      reference: null, // This is the deepest message, no further references
      channel: mockChannel,
    };

    // Set up the referenced message (reply to the original)
    mockReferencedMessage = {
      id: 'ref-msg-123',
      content: 'This is a reply to the original',
      author: {
        id: 'user-456',
        username: 'ReplyUser',
        bot: false,
      },
      webhookId: null,
      reference: {
        messageId: 'nested-msg-123', // References the nested message
      },
      channel: mockChannel,
    };

    // Set up the main message (reply to the reply)
    mockMessage = {
      id: 'msg-123',
      content: 'This is a reply to the reply',
      author: {
        id: 'user-123',
        username: 'TestUser',
        tag: 'TestUser#1234',
        bot: false,
      },
      guild: mockGuild,
      channel: mockChannel,
      reference: {
        messageId: 'ref-msg-123', // References the referenced message
      },
    };

    // Set up fetch to return the appropriate messages
    mockChannel.messages.fetch.mockImplementation(async id => {
      if (id === 'ref-msg-123') return mockReferencedMessage;
      if (id === 'nested-msg-123') return mockNestedReferencedMessage;
      throw new Error('Unknown Message');
    });

    // Set up DDD mocks
    const mockFeatureFlags = {
      isEnabled: jest.fn().mockReturnValue(false), // Use legacy by default
    };
    createFeatureFlags.mockReturnValue(mockFeatureFlags);

    const mockPersonalityApplicationService = {
      getPersonality: jest.fn().mockResolvedValue({
        fullName: 'test-personality',
        displayName: 'Test',
      }),
    };
    const mockBootstrap = {
      initialized: true,
      getPersonalityApplicationService: jest.fn().mockReturnValue(mockPersonalityApplicationService),
    };
    getApplicationBootstrap.mockReturnValue(mockBootstrap);

    // Legacy personality manager removed - using DDD system now

    // Set up conversation manager mocks (async)
    getPersonalityFromMessage.mockResolvedValue('test-personality');

    // Mock the personality interaction handler
    mockHandlePersonalityInteraction = jest.fn().mockResolvedValue(true);

    // Mock console methods
    global.console.log = jest.fn();
    global.console.error = jest.fn();
    global.console.warn = jest.fn();

    // Mock client
    mockClient = {
      user: { id: 'bot-user-id' },
    };

    // Mock messageTrackerHandler.delayedProcessing to immediately call the handler
    messageTrackerHandler.delayedProcessing = jest
      .fn()
      .mockImplementation(async (message, personality, mention, client, handlerFunction) => {
        // Immediately call the handler function with the provided arguments
        await handlerFunction(message, personality, mention, client);
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('should handle nested references without modifying message content', async () => {
    // Make the referenced message from a webhook (personality)
    mockReferencedMessage.webhookId = 'webhook-123';
    mockReferencedMessage.author.bot = true;
    mockReferencedMessage.author.username = 'Test Personality';

    // Process the message
    const result = await handleMessageReference(
      mockMessage,
      mockHandlePersonalityInteraction,
      mockClient
    );

    // Verify that the message content was NOT modified (no synthetic link added)
    expect(mockMessage.content).toBe('This is a reply to the reply');

    // Verify that only the direct reference was fetched (nested reference is not fetched separately)
    expect(mockChannel.messages.fetch).toHaveBeenCalledWith('ref-msg-123');
    expect(mockChannel.messages.fetch).toHaveBeenCalledTimes(1);

    // Verify the handler was called
    expect(mockHandlePersonalityInteraction).toHaveBeenCalled();
    expect(result).toEqual({ processed: true, wasReplyToNonPersonality: false });
  });

  test('should handle nested references when original message is empty', async () => {
    // Set empty content for the main message
    mockMessage.content = '';

    // Make the referenced message from a webhook (personality)
    mockReferencedMessage.webhookId = 'webhook-123';
    mockReferencedMessage.author.bot = true;

    // Process the message
    const result = await handleMessageReference(
      mockMessage,
      mockHandlePersonalityInteraction,
      mockClient
    );

    // Verify that the message content remains empty (no synthetic link added)
    expect(mockMessage.content).toBe('');

    // Verify the result
    expect(result).toEqual({ processed: true, wasReplyToNonPersonality: false });
  });

  test('should handle missing nested referenced message gracefully', async () => {
    // Make fetch throw for the nested message
    mockChannel.messages.fetch.mockImplementation(async id => {
      if (id === 'ref-msg-123') return mockReferencedMessage;
      if (id === 'nested-msg-123') throw new Error('Unknown Message');
      throw new Error('Unknown Message');
    });

    // Make the referenced message from a webhook (personality)
    mockReferencedMessage.webhookId = 'webhook-123';
    mockReferencedMessage.author.bot = true;

    // Process the message - should not throw
    const result = await handleMessageReference(
      mockMessage,
      mockHandlePersonalityInteraction,
      mockClient
    );

    // Should still process the message even if nested reference is missing
    expect(result).toEqual({ processed: true, wasReplyToNonPersonality: false });

    // Original content should remain unchanged
    expect(mockMessage.content).toBe('This is a reply to the reply');
  });

  test('should handle nested reference fetch errors gracefully', async () => {
    // Make fetch throw a different error for the nested message
    mockChannel.messages.fetch.mockImplementation(async id => {
      if (id === 'ref-msg-123') return mockReferencedMessage;
      if (id === 'nested-msg-123') throw new Error('Some other error');
      throw new Error('Unknown Message');
    });

    // Make the referenced message from a webhook (personality)
    mockReferencedMessage.webhookId = 'webhook-123';
    mockReferencedMessage.author.bot = true;

    // Process the message - should not throw
    const result = await handleMessageReference(
      mockMessage,
      mockHandlePersonalityInteraction,
      mockClient
    );

    // Should still process successfully
    expect(result).toEqual({ processed: true, wasReplyToNonPersonality: false });

    // Original content should remain unchanged
    expect(mockMessage.content).toBe('This is a reply to the reply');
  });

  test('should not add synthetic link if referenced message has no reference', async () => {
    // Remove the reference from the referenced message
    mockReferencedMessage.reference = null;

    // Make the referenced message from a webhook (personality)
    mockReferencedMessage.webhookId = 'webhook-123';
    mockReferencedMessage.author.bot = true;

    // Process the message
    await handleMessageReference(mockMessage, mockHandlePersonalityInteraction, mockClient);

    // Verify that content remains unchanged
    expect(mockMessage.content).toBe('This is a reply to the reply');

    // Verify that only the direct reference was fetched
    expect(mockChannel.messages.fetch).toHaveBeenCalledWith('ref-msg-123');
    expect(mockChannel.messages.fetch).toHaveBeenCalledTimes(1);
  });

  test('should work with DM channels using @me in the link', async () => {
    // Set up DM channel
    mockMessage.guild = null;

    // Make the referenced message from a webhook (personality)
    mockReferencedMessage.webhookId = 'webhook-123';
    mockReferencedMessage.author.bot = true;

    // Process the message
    const result = await handleMessageReference(
      mockMessage,
      mockHandlePersonalityInteraction,
      mockClient
    );

    // Verify successful processing without content modification
    expect(result).toEqual({ processed: true, wasReplyToNonPersonality: false });
    expect(mockMessage.content).toBe('This is a reply to the reply');
  });
});
