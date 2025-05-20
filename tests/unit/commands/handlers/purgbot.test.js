/**
 * Tests for the purgbot command handler
 * Standardized format for command handler tests
 */

// Mock dependencies before requiring the module
jest.mock('discord.js');
jest.mock('../../../../src/logger');
jest.mock('../../../../config', () => ({
  botPrefix: '!tz',
}));

// Import test helpers
const helpers = require('../../../utils/commandTestHelpers');

describe('PurgBot Command', () => {
  // Restore environment after all tests
  afterAll(() => {
    delete process.env.NODE_ENV;
  });
  let purgbotCommand;
  let mockMessage;
  let mockDMMessage;
  let mockStatusMessage;
  let mockEmbed;
  let mockValidator;
  let mockChannelMessages;
  let mockCollection;
  
  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    jest.resetModules();
    
    // Set test environment for self-destruct handling
    process.env.NODE_ENV = 'test';
    
    // Create mock instances with proper naming
    const factories = require('../../../utils/mockFactories');
    mockValidator = factories.createValidatorMock();
    
    // Mock specific dependencies that the command uses directly
    jest.mock('../../../../src/commands/utils/commandValidator', () => mockValidator);
    
    // Create the mock messages and embeds
    const { EmbedBuilder } = require('discord.js');
    
    // Set up EmbedBuilder mock
    mockEmbed = {
      setTitle: jest.fn().mockReturnThis(),
      setDescription: jest.fn().mockReturnThis(),
      setColor: jest.fn().mockReturnThis(),
      addFields: jest.fn().mockReturnThis(),
      setFooter: jest.fn().mockReturnThis(),
      toJSON: jest.fn().mockReturnValue({ title: 'Bot Message Cleanup' }),
    };
    EmbedBuilder.mockImplementation(() => mockEmbed);
    
    // Create mock regular channel message (not DM)
    mockMessage = helpers.createMockMessage();
    mockMessage.channel.isDMBased = jest.fn().mockReturnValue(false);
    
    // Create mock DM channel message
    mockDMMessage = helpers.createMockMessage({ isDM: true });
    mockDMMessage.channel.isDMBased = jest.fn().mockReturnValue(true);
    
    // Create client with user property
    const mockClient = {
      user: {
        id: 'bot-user-123',
        username: 'TestBot'
      }
    };
    
    // Add client to both message objects
    mockMessage.client = mockClient;
    mockDMMessage.client = mockClient;
    
    // Create mock status message that will be returned when sending a message
    mockStatusMessage = {
      id: 'status-message-123',
      edit: jest.fn().mockReturnThis(),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    
    // Setup channel.send mock
    mockMessage.channel.send = jest.fn().mockResolvedValue({ id: 'sent-message-123' });
    mockDMMessage.channel.send = jest.fn().mockResolvedValue(mockStatusMessage);
    
    // Setup channel.sendTyping mock
    mockMessage.channel.sendTyping = jest.fn().mockResolvedValue(undefined);
    mockDMMessage.channel.sendTyping = jest.fn().mockResolvedValue(undefined);
    
    // Define the current time for message timestamps
    const now = Date.now();
    const oneHourAgo = now - (60 * 60 * 1000);
    
    // Create mock messages collection to be returned by fetch
    // We need to extend Map to provide a filter method for Discord.js Collection
    class MockCollection extends Map {
      filter(predicate) {
        const results = new MockCollection();
        for (const [key, value] of this.entries()) {
          if (predicate(value, key, this)) {
            results.set(key, value);
          }
        }
        return results;
      }
    }
    
    mockCollection = new MockCollection();
    
    // Define the bot user ID once
    const botUserId = 'bot-user-123';
    
    // Add bot messages
    // Auth messages
    mockCollection.set('auth-msg-1', {
      id: 'auth-msg-1',
      author: { id: botUserId },
      content: 'Authentication Required',
      embeds: [],
      delete: jest.fn().mockResolvedValue(undefined),
      createdTimestamp: oneHourAgo - (30 * 60 * 1000),
    });
    mockCollection.set('auth-msg-2', {
      id: 'auth-msg-2',
      author: { id: botUserId },
      content: 'Please click the link below to authenticate',
      embeds: [],
      delete: jest.fn().mockResolvedValue(undefined),
      createdTimestamp: oneHourAgo - (40 * 60 * 1000),
    });
    
    // Chat messages
    mockCollection.set('chat-msg-1', {
      id: 'chat-msg-1',
      author: { id: botUserId },
      content: 'Person is typing...',
      embeds: [],
      delete: jest.fn().mockResolvedValue(undefined),
      createdTimestamp: oneHourAgo - (10 * 60 * 1000),
    });
    mockCollection.set('chat-msg-2', {
      id: 'chat-msg-2',
      author: { id: botUserId },
      content: 'PersonName continued their message',
      embeds: [],
      delete: jest.fn().mockResolvedValue(undefined),
      createdTimestamp: oneHourAgo - (15 * 60 * 1000),
    });
    
    // System messages
    mockCollection.set('system-msg-1', {
      id: 'system-msg-1',
      author: { id: botUserId },
      content: 'Bot is starting...',
      embeds: [],
      delete: jest.fn().mockResolvedValue(undefined),
      createdTimestamp: oneHourAgo - (2 * 60 * 60 * 1000),
    });
    mockCollection.set('system-msg-2', {
      id: 'system-msg-2',
      author: { id: botUserId },
      content: 'Status: Online',
      embeds: [],
      delete: jest.fn().mockResolvedValue(undefined),
      createdTimestamp: oneHourAgo - (2.5 * 60 * 60 * 1000),
    });
    
    // Important messages (should never be deleted)
    mockCollection.set('important-msg-1', {
      id: 'important-msg-1',
      author: { id: botUserId },
      content: 'API key has been set',
      embeds: [],
      delete: jest.fn().mockResolvedValue(undefined),
      createdTimestamp: oneHourAgo - (5 * 60 * 60 * 1000),
    });
    mockCollection.set('important-msg-2', {
      id: 'important-msg-2',
      author: { id: botUserId },
      content: 'Your data has been exported',
      embeds: [],
      delete: jest.fn().mockResolvedValue(undefined),
      createdTimestamp: oneHourAgo - (3 * 60 * 60 * 1000),
    });
    
    // Very recent message (should not be deleted)
    mockCollection.set('recent-msg-1', {
      id: 'recent-msg-1',
      author: { id: botUserId },
      content: 'This is a very recent message',
      embeds: [],
      delete: jest.fn().mockResolvedValue(undefined),
      createdTimestamp: now - (30 * 1000), // 30 seconds ago
    });
    
    // User messages
    mockCollection.set('user-auth-msg', {
      id: 'user-auth-msg',
      author: { id: mockDMMessage.author.id },
      content: '!tz auth start',
      embeds: [],
      delete: jest.fn().mockResolvedValue(undefined),
      createdTimestamp: oneHourAgo - (45 * 60 * 1000),
    });
    mockCollection.set('user-chat-msg', {
      id: 'user-chat-msg',
      author: { id: mockDMMessage.author.id },
      content: '!tz chat with me',
      embeds: [],
      delete: jest.fn().mockResolvedValue(undefined),
      createdTimestamp: oneHourAgo - (20 * 60 * 1000),
    });
    mockCollection.set('user-system-msg', {
      id: 'user-system-msg',
      author: { id: mockDMMessage.author.id },
      content: '!tz status',
      embeds: [],
      delete: jest.fn().mockResolvedValue(undefined),
      createdTimestamp: oneHourAgo - (2.2 * 60 * 60 * 1000),
    });
    mockCollection.set('user-normal-msg', {
      id: 'user-normal-msg',
      author: { id: mockDMMessage.author.id },
      content: 'Just a normal message',
      embeds: [],
      delete: jest.fn().mockResolvedValue(undefined),
      createdTimestamp: oneHourAgo - (30 * 60 * 1000),
    });
    
    // Add the status message to collection
    mockCollection.set(mockStatusMessage.id, {
      id: mockStatusMessage.id,
      author: { id: botUserId },
      content: '🧹 Purging bot messages...',
      embeds: [],
      delete: jest.fn().mockResolvedValue(undefined),
      createdTimestamp: now,
    });
    
    // Setup the fetch method to return our collection
    mockChannelMessages = {
      fetch: jest.fn().mockResolvedValue(mockCollection),
    };
    mockDMMessage.channel.messages = mockChannelMessages;
    
    // Create our spy for directSend
    mockDirectSendFunction = jest.fn().mockImplementation(content => {
      return Promise.resolve(mockStatusMessage);
    });
    
    mockValidator.createDirectSend.mockReturnValue(mockDirectSendFunction);
    
    // Import the logger
    const logger = require('../../../../src/logger');
    logger.error = jest.fn();
    logger.info = jest.fn();
    logger.warn = jest.fn();
    
    // Import the command module after setting up all mocks
    purgbotCommand = require('../../../../src/commands/handlers/purgbot');
  });
  
  it('should have the correct metadata', () => {
    expect(purgbotCommand.meta).toEqual({
      name: 'purgbot',
      description: expect.any(String),
      usage: expect.stringContaining('purgbot [all|auth|chat|system]'),
      aliases: expect.arrayContaining(['purgebot', 'clearbot', 'cleandm']),
      permissions: expect.any(Array)
    });
  });
  
  it('should reject use outside of DM channels', async () => {
    await purgbotCommand.execute(mockMessage, []);
    
    // Verify the direct send function was created
    expect(mockValidator.createDirectSend).toHaveBeenCalledWith(mockMessage);
    
    // Verify warning message was sent
    expect(mockDirectSendFunction).toHaveBeenCalled();
    expect(mockDirectSendFunction.mock.calls[0][0]).toContain('only be used in DM channels');
    
    // Verify no messages were fetched or deleted
    expect(mockMessage.channel.messages?.fetch).not.toHaveBeenCalled();
  });
  
  it('should reject invalid category', async () => {
    await purgbotCommand.execute(mockDMMessage, ['invalid']);
    
    // Verify error message was sent
    expect(mockDirectSendFunction).toHaveBeenCalled();
    expect(mockDirectSendFunction.mock.calls[0][0]).toContain('Invalid category');
    expect(mockDirectSendFunction.mock.calls[0][0]).toContain('Available categories');
    
    // Verify no messages were fetched or deleted
    expect(mockDMMessage.channel.messages.fetch).not.toHaveBeenCalled();
  });
  
  it('should purge all bot messages with "all" category (default)', async () => {
    await purgbotCommand.execute(mockDMMessage, []);
    
    // Verify messages were fetched
    expect(mockChannelMessages.fetch).toHaveBeenCalledWith({ limit: 100 });
    
    // Verify initial status message was sent
    expect(mockDirectSendFunction).toHaveBeenCalledWith('🧹 Purging bot messages...');
    
    // Normal bot messages should be deleted, but not important or very recent messages
    expect(mockCollection.get('auth-msg-1').delete).toHaveBeenCalled();
    expect(mockCollection.get('auth-msg-2').delete).toHaveBeenCalled();
    expect(mockCollection.get('chat-msg-1').delete).toHaveBeenCalled();
    expect(mockCollection.get('chat-msg-2').delete).toHaveBeenCalled();
    expect(mockCollection.get('system-msg-1').delete).toHaveBeenCalled();
    expect(mockCollection.get('system-msg-2').delete).toHaveBeenCalled();
    
    // User command messages should be deleted
    expect(mockCollection.get('user-auth-msg').delete).toHaveBeenCalled();
    expect(mockCollection.get('user-chat-msg').delete).toHaveBeenCalled();
    expect(mockCollection.get('user-system-msg').delete).toHaveBeenCalled();
    
    // Important, very recent, and normal user messages should NOT be deleted
    expect(mockCollection.get('important-msg-1').delete).not.toHaveBeenCalled();
    expect(mockCollection.get('important-msg-2').delete).not.toHaveBeenCalled();
    expect(mockCollection.get('recent-msg-1').delete).not.toHaveBeenCalled();
    expect(mockCollection.get('user-normal-msg').delete).not.toHaveBeenCalled();
    
    // Verify the status message was updated
    expect(mockStatusMessage.edit).toHaveBeenCalledWith({
      content: '',
      embeds: [mockEmbed]
    });
    
    // Verify the embed was set up correctly
    expect(mockEmbed.setTitle).toHaveBeenCalledWith('Bot Message Cleanup');
    expect(mockEmbed.setDescription).toHaveBeenCalledWith(expect.stringContaining('Completed purging bot messages'));
    expect(mockEmbed.setFooter).toHaveBeenCalledWith({ text: expect.stringContaining('self-destruct') });
    
    // Test the self-destruct functionality (should be attached to the message)
    expect(mockStatusMessage).toHaveProperty('selfDestruct');
    
    // Manually trigger self-destruct function for testing
    if (mockStatusMessage.selfDestruct) {
      await mockStatusMessage.selfDestruct();
    }
    
    // Verify message was deleted
    expect(mockStatusMessage.delete).toHaveBeenCalled();
  });
  
  it('should purge only auth messages with "auth" category', async () => {
    await purgbotCommand.execute(mockDMMessage, ['auth']);
    
    // Verify messages were fetched
    expect(mockChannelMessages.fetch).toHaveBeenCalledWith({ limit: 100 });
    
    // Verify initial status message was sent
    expect(mockDirectSendFunction).toHaveBeenCalledWith('🧹 Purging authentication messages...');
    
    // Auth messages should be deleted
    expect(mockCollection.get('auth-msg-1').delete).toHaveBeenCalled();
    expect(mockCollection.get('auth-msg-2').delete).toHaveBeenCalled();
    expect(mockCollection.get('user-auth-msg').delete).toHaveBeenCalled();
    
    // Other messages should NOT be deleted
    expect(mockCollection.get('chat-msg-1').delete).not.toHaveBeenCalled();
    expect(mockCollection.get('chat-msg-2').delete).not.toHaveBeenCalled();
    expect(mockCollection.get('system-msg-1').delete).not.toHaveBeenCalled();
    expect(mockCollection.get('system-msg-2').delete).not.toHaveBeenCalled();
    expect(mockCollection.get('user-chat-msg').delete).not.toHaveBeenCalled();
    expect(mockCollection.get('user-system-msg').delete).not.toHaveBeenCalled();
  });
  
  it('should purge only chat messages with "chat" category', async () => {
    await purgbotCommand.execute(mockDMMessage, ['chat']);
    
    // Verify messages were fetched
    expect(mockChannelMessages.fetch).toHaveBeenCalledWith({ limit: 100 });
    
    // Verify initial status message was sent
    expect(mockDirectSendFunction).toHaveBeenCalledWith('🧹 Purging chat and conversation messages...');
    
    // Chat messages should be deleted
    expect(mockCollection.get('chat-msg-1').delete).toHaveBeenCalled();
    expect(mockCollection.get('chat-msg-2').delete).toHaveBeenCalled();
    expect(mockCollection.get('user-chat-msg').delete).toHaveBeenCalled();
    
    // Other messages should NOT be deleted
    expect(mockCollection.get('auth-msg-1').delete).not.toHaveBeenCalled();
    expect(mockCollection.get('auth-msg-2').delete).not.toHaveBeenCalled();
    expect(mockCollection.get('system-msg-1').delete).not.toHaveBeenCalled();
    expect(mockCollection.get('system-msg-2').delete).not.toHaveBeenCalled();
    expect(mockCollection.get('user-auth-msg').delete).not.toHaveBeenCalled();
    expect(mockCollection.get('user-system-msg').delete).not.toHaveBeenCalled();
  });
  
  it('should purge only system messages with "system" category', async () => {
    await purgbotCommand.execute(mockDMMessage, ['system']);
    
    // Verify messages were fetched
    expect(mockChannelMessages.fetch).toHaveBeenCalledWith({ limit: 100 });
    
    // Verify initial status message was sent
    expect(mockDirectSendFunction).toHaveBeenCalledWith('🧹 Purging system and status messages...');
    
    // System messages should be deleted
    expect(mockCollection.get('system-msg-1').delete).toHaveBeenCalled();
    expect(mockCollection.get('system-msg-2').delete).toHaveBeenCalled();
    expect(mockCollection.get('user-system-msg').delete).toHaveBeenCalled();
    
    // Other messages should NOT be deleted
    expect(mockCollection.get('auth-msg-1').delete).not.toHaveBeenCalled();
    expect(mockCollection.get('auth-msg-2').delete).not.toHaveBeenCalled();
    expect(mockCollection.get('chat-msg-1').delete).not.toHaveBeenCalled();
    expect(mockCollection.get('chat-msg-2').delete).not.toHaveBeenCalled();
    expect(mockCollection.get('user-auth-msg').delete).not.toHaveBeenCalled();
    expect(mockCollection.get('user-chat-msg').delete).not.toHaveBeenCalled();
  });
  
  it('should handle the case when no messages are found to delete', async () => {
    // Create a new empty collection
    class MockCollection extends Map {
      filter(predicate) {
        const results = new MockCollection();
        for (const [key, value] of this.entries()) {
          if (predicate(value, key, this)) {
            results.set(key, value);
          }
        }
        return results;
      }
    }
    
    const emptyCollection = new MockCollection();
    
    // Define the bot user ID once
    const botUserId = 'bot-user-123';
    const now = Date.now();
    
    // Add only important messages
    emptyCollection.set('important-msg-1', {
      id: 'important-msg-1',
      author: { id: botUserId },
      content: 'API key has been set',
      embeds: [],
      delete: jest.fn().mockResolvedValue(undefined),
      createdTimestamp: now - (5 * 60 * 60 * 1000),
    });
    emptyCollection.set('recent-msg-1', {
      id: 'recent-msg-1',
      author: { id: botUserId },
      content: 'This is a very recent message',
      embeds: [],
      delete: jest.fn().mockResolvedValue(undefined),
      createdTimestamp: now - (30 * 1000), // 30 seconds ago
    });
    
    // Update the fetch method
    mockChannelMessages.fetch.mockResolvedValueOnce(emptyCollection);
    
    await purgbotCommand.execute(mockDMMessage, []);
    
    // Verify messages were fetched
    expect(mockChannelMessages.fetch).toHaveBeenCalledWith({ limit: 100 });
    
    // Verify appropriate message was sent
    expect(mockDirectSendFunction).toHaveBeenCalledWith('No bot messages found to purge.');
    
    // Verify no delete calls were made
    expect(emptyCollection.get('important-msg-1').delete).not.toHaveBeenCalled();
    expect(emptyCollection.get('recent-msg-1').delete).not.toHaveBeenCalled();
  });
  
  it('should handle message deletion failures', async () => {
    // Make one of the deletes fail
    mockCollection.get('auth-msg-1').delete.mockRejectedValueOnce(new Error('Could not delete message'));
    
    await purgbotCommand.execute(mockDMMessage, []);
    
    // Verify messages were attempted to be deleted
    expect(mockCollection.get('auth-msg-1').delete).toHaveBeenCalled();
    
    // Verify the error was logged
    const logger = require('../../../../src/logger');
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringMatching(/Failed to delete message.+Could not delete message/)
    );
  });
  
  it('should handle fetch errors gracefully', async () => {
    // Make the fetch fail
    mockChannelMessages.fetch.mockRejectedValueOnce(new Error('Failed to fetch messages'));
    
    await purgbotCommand.execute(mockDMMessage, []);
    
    // Verify error was logged
    const logger = require('../../../../src/logger');
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringMatching(/Error purging messages.+Failed to fetch messages/)
    );
    
    // Verify error message was sent to user
    expect(mockDirectSendFunction).toHaveBeenCalledWith(
      expect.stringContaining('An error occurred while purging messages')
    );
  });
});