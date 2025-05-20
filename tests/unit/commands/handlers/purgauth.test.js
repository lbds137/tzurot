/**
 * Tests for the purgauth command handler
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

describe('PurgAuth Command', () => {
  let purgauthCommand;
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
      toJSON: jest.fn().mockReturnValue({ title: 'Authentication Message Cleanup' }),
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
      edit: jest.fn().mockResolvedValue({ id: 'edited-status-123' }),
    };
    
    // Setup channel.send mock
    mockMessage.channel.send = jest.fn().mockResolvedValue({ id: 'sent-message-123' });
    mockDMMessage.channel.send = jest.fn().mockResolvedValue(mockStatusMessage);
    
    // Setup channel.sendTyping mock
    mockMessage.channel.sendTyping = jest.fn().mockResolvedValue(undefined);
    mockDMMessage.channel.sendTyping = jest.fn().mockResolvedValue(undefined);
    
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
    mockCollection.set('auth-msg-1', {
      id: 'auth-msg-1',
      author: { id: botUserId },
      content: 'Authentication Required',
      embeds: [],
      delete: jest.fn().mockResolvedValue(undefined),
    });
    mockCollection.set('auth-msg-2', {
      id: 'auth-msg-2',
      author: { id: botUserId },
      content: 'Please click the link below to authenticate',
      embeds: [],
      delete: jest.fn().mockResolvedValue(undefined),
    });
    mockCollection.set('auth-msg-3', {
      id: 'auth-msg-3',
      author: { id: botUserId },
      content: 'Normal message, not auth-related',
      embeds: [],
      delete: jest.fn().mockResolvedValue(undefined),
    });
    // Add user messages
    mockCollection.set('user-auth-msg-1', {
      id: 'user-auth-msg-1',
      author: { id: mockDMMessage.author.id },
      content: '!tz auth start',
      embeds: [],
      delete: jest.fn().mockResolvedValue(undefined),
    });
    mockCollection.set('user-auth-msg-2', {
      id: 'user-auth-msg-2',
      author: { id: mockDMMessage.author.id },
      content: '!tz auth code MY_CODE',
      embeds: [],
      delete: jest.fn().mockResolvedValue(undefined),
    });
    mockCollection.set('user-msg-3', {
      id: 'user-msg-3',
      author: { id: mockDMMessage.author.id },
      content: 'Normal message, not auth-related',
      embeds: [],
      delete: jest.fn().mockResolvedValue(undefined),
    });
    // Add the status message to collection
    mockCollection.set(mockStatusMessage.id, {
      id: mockStatusMessage.id,
      author: { id: botUserId },
      content: '🧹 Purging authentication messages...',
      embeds: [],
      delete: jest.fn().mockResolvedValue(undefined),
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
    purgauthCommand = require('../../../../src/commands/handlers/purgauth');
  });
  
  it('should have the correct metadata', () => {
    expect(purgauthCommand.meta).toEqual({
      name: 'purgauth',
      description: expect.any(String),
      usage: expect.any(String),
      aliases: expect.arrayContaining(['purgeauth', 'clearauth']),
      permissions: expect.any(Array)
    });
  });
  
  it('should reject use outside of DM channels', async () => {
    await purgauthCommand.execute(mockMessage, []);
    
    // Verify the direct send function was created
    expect(mockValidator.createDirectSend).toHaveBeenCalledWith(mockMessage);
    
    // Verify warning message was sent
    expect(mockDirectSendFunction).toHaveBeenCalled();
    expect(mockDirectSendFunction.mock.calls[0][0]).toContain('only be used in DM channels');
    
    // Verify no messages were fetched or deleted
    expect(mockMessage.channel.messages?.fetch).not.toHaveBeenCalled();
  });
  
  it('should delete auth-related messages in DM channel', async () => {
    await purgauthCommand.execute(mockDMMessage, []);
    
    // Verify messages were fetched
    expect(mockChannelMessages.fetch).toHaveBeenCalledWith({ limit: 100 });
    
    // Verify initial status message was sent
    expect(mockDirectSendFunction).toHaveBeenCalledWith('🧹 Purging authentication messages...');
    
    // Four auth-related messages should be deleted (2 bot auth messages + 2 user auth commands)
    // The status message and non-auth messages should not be deleted
    const authMsg1 = mockCollection.get('auth-msg-1');
    const authMsg2 = mockCollection.get('auth-msg-2');
    const userAuthMsg1 = mockCollection.get('user-auth-msg-1');
    const userAuthMsg2 = mockCollection.get('user-auth-msg-2');
    
    expect(authMsg1.delete).toHaveBeenCalled();
    expect(authMsg2.delete).toHaveBeenCalled();
    expect(userAuthMsg1.delete).toHaveBeenCalled();
    expect(userAuthMsg2.delete).toHaveBeenCalled();
    
    // Verify non-auth messages were not deleted
    const nonAuthMsg = mockCollection.get('auth-msg-3');
    const nonAuthUserMsg = mockCollection.get('user-msg-3');
    const statusMsg = mockCollection.get(mockStatusMessage.id);
    
    expect(nonAuthMsg.delete).not.toHaveBeenCalled();
    expect(nonAuthUserMsg.delete).not.toHaveBeenCalled();
    expect(statusMsg.delete).not.toHaveBeenCalled();
    
    // Verify the status message was updated with an embed
    expect(mockStatusMessage.edit).toHaveBeenCalledWith({
      content: '',
      embeds: [mockEmbed]
    });
    
    // Verify the embed was set up correctly
    expect(mockEmbed.setTitle).toHaveBeenCalledWith('Authentication Message Cleanup');
    expect(mockEmbed.setDescription).toHaveBeenCalledWith(expect.stringContaining('Completed purging'));
    expect(mockEmbed.setColor).toHaveBeenCalledWith(0x4caf50);
    expect(mockEmbed.addFields).toHaveBeenCalledWith(
      { name: 'Messages Deleted', value: '4', inline: true },
      { name: 'Messages Failed', value: '0', inline: true }
    );
  });
  
  it('should handle the case when no auth messages are found', async () => {
    // Clear all auth-related messages from collection
    mockCollection.delete('auth-msg-1');
    mockCollection.delete('auth-msg-2');
    mockCollection.delete('user-auth-msg-1');
    mockCollection.delete('user-auth-msg-2');
    
    await purgauthCommand.execute(mockDMMessage, []);
    
    // Verify messages were fetched
    expect(mockChannelMessages.fetch).toHaveBeenCalledWith({ limit: 100 });
    
    // Verify appropriate message was sent
    expect(mockDirectSendFunction).toHaveBeenCalledWith('No authentication messages found to purge.');
    
    // Verify no delete calls were made
    const nonAuthMsg = mockCollection.get('auth-msg-3');
    const nonAuthUserMsg = mockCollection.get('user-msg-3');
    
    expect(nonAuthMsg?.delete).not.toHaveBeenCalled();
    expect(nonAuthUserMsg?.delete).not.toHaveBeenCalled();
  });
  
  it('should handle message deletion failures', async () => {
    // Make one of the deletes fail
    const authMsg1 = mockCollection.get('auth-msg-1');
    authMsg1.delete.mockRejectedValueOnce(new Error('Could not delete message'));
    
    await purgauthCommand.execute(mockDMMessage, []);
    
    // Verify messages were attempted to be deleted
    expect(authMsg1.delete).toHaveBeenCalled();
    
    // Verify the error was logged
    const logger = require('../../../../src/logger');
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringMatching(/Failed to delete message.+Could not delete message/)
    );
    
    // Verify the status was updated correctly (3 deleted, 1 failed)
    expect(mockEmbed.addFields).toHaveBeenCalledWith(
      { name: 'Messages Deleted', value: '3', inline: true },
      { name: 'Messages Failed', value: '1', inline: true }
    );
  });
  
  it('should handle fetch errors gracefully', async () => {
    // Make the fetch fail
    mockChannelMessages.fetch.mockRejectedValueOnce(new Error('Failed to fetch messages'));
    
    await purgauthCommand.execute(mockDMMessage, []);
    
    // Verify error was logged
    const logger = require('../../../../src/logger');
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringMatching(/Error purging auth messages.+Failed to fetch messages/)
    );
    
    // Verify error message was sent to user
    expect(mockDirectSendFunction).toHaveBeenCalledWith(
      expect.stringContaining('An error occurred while purging messages')
    );
  });
});