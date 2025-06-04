// Mock dependencies
jest.mock('discord.js');
jest.mock('../../../../src/logger');
jest.mock('../../../../config', () => ({
  botPrefix: '!tz',
  botConfig: {
    isDevelopment: false,
    mentionChar: '@'
  }
}));

// Import the test helpers
const helpers = require('../../../utils/commandTestHelpers');

// Import and mock command dependencies
const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const logger = require('../../../../src/logger');

// Mock logger functions
logger.info = jest.fn();
logger.debug = jest.fn();
logger.error = jest.fn();

describe('Deactivate Command Handler', () => {
  // Setup module mocks before requiring the module
  let mockMessage;
  let mockDirectSend;
  let conversationManager;
  let validator;
  let deactivateCommand;
  
  beforeEach(() => {
    // Reset modules between tests
    jest.resetModules();
    jest.clearAllMocks();
    
    // Setup mocks
    jest.doMock('../../../../src/core/conversation', () => ({
      deactivatePersonality: jest.fn().mockReturnValue({ success: true })
    }));
    
    jest.doMock('../../../../src/commands/utils/commandValidator', () => {
      return {
        createDirectSend: jest.fn(),
        canManageMessages: jest.fn().mockReturnValue(true)
      };
    });

    jest.doMock('../../../../src/utils', () => ({
      createDirectSend: jest.fn().mockImplementation((message) => {
        return async (content) => {
          return message.channel.send(content);
        };
      })
    }));
    
    // Create mock message
    mockMessage = helpers.createMockMessage();
    mockMessage.channel.send = jest.fn().mockResolvedValue({
      id: 'sent-message-123',
      embeds: [{title: 'Channel Deactivated'}]
    });
    
    // Setup validator mock
    mockDirectSend = jest.fn().mockImplementation(content => {
      return mockMessage.channel.send(content);
    });
    
    // Mock EmbedBuilder
    EmbedBuilder.mockImplementation(() => ({
      setTitle: jest.fn().mockReturnThis(),
      setDescription: jest.fn().mockReturnThis(),
      setColor: jest.fn().mockReturnThis()
    }));
    
    // Import modules after mocking
    conversationManager = require('../../../../src/core/conversation');
    validator = require('../../../../src/commands/utils/commandValidator');
    
    // Setup validator's createDirectSend mock
    validator.createDirectSend.mockReturnValue(mockDirectSend);
    
    // Import the command module after mocks are set up
    deactivateCommand = require('../../../../src/commands/handlers/deactivate');
  });
  
  afterEach(() => {
    jest.resetModules();
  });
  
  test('should have the correct metadata', () => {
    expect(deactivateCommand.meta).toEqual({
      name: 'deactivate',
      description: expect.any(String),
      usage: expect.any(String),
      aliases: expect.any(Array),
      permissions: expect.any(Array)
    });
  });
  
  test('should not allow deactivation in DM channels', async () => {
    // Create DM mock message
    const dmMockMessage = helpers.createMockMessage({isDM: true});
    dmMockMessage.channel.send = jest.fn().mockResolvedValue({
      id: 'sent-message-123',
      content: 'Error message'
    });
    
    // Create a custom directSend for the DM channel
    const dmDirectSend = jest.fn().mockImplementation(content => {
      return dmMockMessage.channel.send(content);
    });
    
    // Override the validator mock for this test
    validator.createDirectSend.mockImplementation((message) => {
      if (message === dmMockMessage) {
        return dmDirectSend;
      }
      return mockDirectSend;
    });
    
    await deactivateCommand.execute(dmMockMessage, []);
    
    // Check that deactivatePersonality was not called
    expect(conversationManager.deactivatePersonality).not.toHaveBeenCalled();
    
    // Check that the appropriate message was sent
    expect(dmMockMessage.channel.send).toHaveBeenCalledWith(
      expect.stringContaining('Channel activation is not used in DMs')
    );
  });
  
  test('should check for permission to manage messages', async () => {
    // Mock lack of permission
    validator.canManageMessages.mockReturnValueOnce(false);
    
    await deactivateCommand.execute(mockMessage, []);
    
    // Check that deactivatePersonality was not called
    expect(conversationManager.deactivatePersonality).not.toHaveBeenCalled();
    
    // Check that the appropriate message was sent
    expect(mockMessage.channel.send).toHaveBeenCalledWith(
      expect.stringContaining('You need the "Manage Messages" permission')
    );
  });
  
  test('should successfully deactivate a personality', async () => {
    await deactivateCommand.execute(mockMessage, []);
    
    // Check that deactivatePersonality was called with the channel ID
    expect(conversationManager.deactivatePersonality).toHaveBeenCalledWith(mockMessage.channel.id);
    
    // Verify that channel.send was called
    expect(mockMessage.channel.send).toHaveBeenCalled();
  });
  
  test('should handle errors from deactivatePersonality', async () => {
    // Mock deactivatePersonality returning false (no personality was active)
    conversationManager.deactivatePersonality.mockReturnValueOnce(false);
    
    await deactivateCommand.execute(mockMessage, []);
    
    // Check that the error message was sent
    expect(mockMessage.channel.send).toHaveBeenCalledWith(
      'No active personality found in this channel.'
    );
    
    // Check that no embed was created (since we're returning early with an error)
    expect(EmbedBuilder).not.toHaveBeenCalled();
  });
  
  test('should handle unexpected errors', async () => {
    // Reset mocks to ensure clean state
    jest.clearAllMocks();
    
    // Force an error
    conversationManager.deactivatePersonality.mockImplementationOnce(() => {
      throw new Error('Test error');
    });
    
    await deactivateCommand.execute(mockMessage, []);
    
    // No need to check logger.error as we now set up the logger directly 
    // instead of via jest.mock()
    
    // Check that an error message was sent
    expect(mockMessage.channel.send).toHaveBeenCalledWith(
      expect.stringContaining('An error occurred while deactivating the personality')
    );
  });
});