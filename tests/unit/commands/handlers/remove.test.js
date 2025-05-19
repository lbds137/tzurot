// Mock dependencies
jest.mock('discord.js');
jest.mock('../../../../src/logger');
jest.mock('../../../../config', () => ({
  botPrefix: '!tz'
}));

// Import the test helpers
const helpers = require('../../../utils/commandTestHelpers');

// Import and mock command dependencies
const { EmbedBuilder } = require('discord.js');
const logger = require('../../../../src/logger');

// Mock logger functions
logger.info = jest.fn();
logger.debug = jest.fn();
logger.error = jest.fn();

describe('Remove Command Handler', () => {
  // Setup module mocks before requiring the module
  let mockMessage;
  let mockDirectSend;
  let personalityManager;
  let validator;
  let removeCommand;
  
  beforeEach(() => {
    // Reset modules between tests
    jest.resetModules();
    jest.clearAllMocks();
    
    // Setup mocks
    jest.doMock('../../../../src/personalityManager', () => ({
      getPersonality: jest.fn().mockReturnValue({
        fullName: 'test-personality',
        displayName: 'Test Personality',
        avatarUrl: 'https://example.com/avatar.png',
        createdBy: 'user-123'
      }),
      getPersonalityByAlias: jest.fn().mockReturnValue(null),
      removePersonality: jest.fn().mockResolvedValue({ success: true })
    }));
    
    jest.doMock('../../../../src/commands/utils/commandValidator', () => {
      return {
        createDirectSend: jest.fn()
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
      embeds: [{title: 'Personality Removed'}]
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
    personalityManager = require('../../../../src/personalityManager');
    validator = require('../../../../src/commands/utils/commandValidator');
    
    // Setup validator's createDirectSend mock
    validator.createDirectSend.mockReturnValue(mockDirectSend);
    
    // Import the command module after mocks are set up
    removeCommand = require('../../../../src/commands/handlers/remove');
  });
  
  afterEach(() => {
    jest.resetModules();
  });
  
  test('should have the correct metadata', () => {
    expect(removeCommand.meta).toEqual({
      name: 'remove',
      description: expect.any(String),
      usage: expect.any(String),
      aliases: expect.any(Array),
      permissions: expect.any(Array)
    });
  });
  
  test('should show the correct usage when no personality name is provided', async () => {
    await removeCommand.execute(mockMessage, []);
    
    // Check that no personality removal was attempted
    expect(personalityManager.removePersonality).not.toHaveBeenCalled();
    
    // Check that usage message was sent
    expect(mockMessage.channel.send).toHaveBeenCalledWith(
      expect.stringContaining('You need to provide a personality name')
    );
  });
  
  test('should remove a personality by name', async () => {
    await removeCommand.execute(mockMessage, ['test-personality']);
    
    // Check that we tried to look up the personality
    expect(personalityManager.getPersonalityByAlias).toHaveBeenCalledWith(mockMessage.author.id, 'test-personality');
    expect(personalityManager.getPersonality).toHaveBeenCalledWith('test-personality');
    
    // Check that removal was attempted
    expect(personalityManager.removePersonality).toHaveBeenCalledWith(mockMessage.author.id, 'test-personality');
    
    // Verify that channel.send was called
    expect(mockMessage.channel.send).toHaveBeenCalled();
  });
  
  test('should remove a personality by alias', async () => {
    // Mock finding personality by alias
    personalityManager.getPersonalityByAlias.mockReturnValueOnce({
      fullName: 'test-personality',
      displayName: 'Test Personality',
      avatarUrl: 'https://example.com/avatar.png',
      createdBy: 'user-123'
    });
    
    await removeCommand.execute(mockMessage, ['test']);
    
    // Check that we tried to look up the personality by alias
    expect(personalityManager.getPersonalityByAlias).toHaveBeenCalledWith(mockMessage.author.id, 'test');
    
    // Direct name lookup should not have been called
    expect(personalityManager.getPersonality).not.toHaveBeenCalled();
    
    // Check that removal was attempted with the full name
    expect(personalityManager.removePersonality).toHaveBeenCalledWith(mockMessage.author.id, 'test-personality');
    
    // Verify that channel.send was called
    expect(mockMessage.channel.send).toHaveBeenCalled();
  });
  
  test('should show error when personality is not found', async () => {
    // Mock personality not found by either alias or name
    personalityManager.getPersonalityByAlias.mockReturnValueOnce(null);
    personalityManager.getPersonality.mockReturnValueOnce(null);
    
    await removeCommand.execute(mockMessage, ['nonexistent']);
    
    // Check that we tried both lookups
    expect(personalityManager.getPersonalityByAlias).toHaveBeenCalledWith(mockMessage.author.id, 'nonexistent');
    expect(personalityManager.getPersonality).toHaveBeenCalledWith('nonexistent');
    
    // Check that no removal was attempted
    expect(personalityManager.removePersonality).not.toHaveBeenCalled();
    
    // Check that error message was sent
    expect(mockMessage.channel.send).toHaveBeenCalledWith(
      expect.stringContaining('not found')
    );
  });
  
  test('should handle errors from the removePersonality function', async () => {
    // Mock an error from removePersonality
    personalityManager.removePersonality.mockResolvedValueOnce({
      error: 'You cannot remove this personality'
    });
    
    await removeCommand.execute(mockMessage, ['test-personality']);
    
    // Check that removal was attempted
    expect(personalityManager.removePersonality).toHaveBeenCalled();
    
    // Check that error message was sent
    expect(mockMessage.channel.send).toHaveBeenCalledWith(
      'You cannot remove this personality'
    );
  });
  
  test('should handle unexpected errors', async () => {
    // Reset mocks to ensure clean state
    jest.clearAllMocks();
    
    // Force an error
    personalityManager.removePersonality.mockImplementationOnce(() => {
      throw new Error('Test error');
    });
    
    await removeCommand.execute(mockMessage, ['test-personality']);
    
    // Check that error message was sent
    expect(mockMessage.channel.send).toHaveBeenCalledWith(
      expect.stringContaining('An error occurred while removing the personality')
    );
  });
});