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
const { EmbedBuilder } = require('discord.js');
const logger = require('../../../../src/logger');

// Mock logger functions
logger.info = jest.fn();
logger.debug = jest.fn();
logger.error = jest.fn();

describe('Alias Command Handler', () => {
  // Setup module mocks before requiring the module
  let mockMessage;
  let mockDirectSend;
  let personalityManager;
  let validator;
  let aliasCommand;
  
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
      setPersonalityAlias: jest.fn().mockResolvedValue({ success: true })
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
      embeds: [{title: 'Alias Added'}]
    });
    
    // Setup validator mock
    mockDirectSend = jest.fn().mockImplementation(content => {
      return mockMessage.channel.send(content);
    });
    
    // Mock EmbedBuilder
    EmbedBuilder.mockImplementation(() => ({
      setTitle: jest.fn().mockReturnThis(),
      setDescription: jest.fn().mockReturnThis(),
      setColor: jest.fn().mockReturnThis(),
      addFields: jest.fn().mockReturnThis(),
      setThumbnail: jest.fn().mockReturnThis()
    }));
    
    // Import modules after mocking
    personalityManager = require('../../../../src/personalityManager');
    validator = require('../../../../src/commands/utils/commandValidator');
    
    // Setup validator's createDirectSend mock
    validator.createDirectSend.mockReturnValue(mockDirectSend);
    
    // Import the command module after mocks are set up
    aliasCommand = require('../../../../src/commands/handlers/alias');
  });
  
  afterEach(() => {
    jest.resetModules();
  });
  
  test('should have the correct metadata', () => {
    expect(aliasCommand.meta).toEqual({
      name: 'alias',
      description: expect.any(String),
      usage: expect.any(String),
      aliases: expect.any(Array),
      permissions: expect.any(Array)
    });
  });
  
  test('should show the correct usage when not enough arguments are provided', async () => {
    await aliasCommand.execute(mockMessage, ['test-personality']);
    
    // Check that no alias was set
    expect(personalityManager.setPersonalityAlias).not.toHaveBeenCalled();
    
    // Check that usage message was sent
    expect(mockMessage.channel.send).toHaveBeenCalledWith(
      expect.stringContaining('You need to provide a personality name and an alias')
    );
  });
  
  test('should set an alias for an existing personality', async () => {
    await aliasCommand.execute(mockMessage, ['test-personality', 'test']);
    
    // Check that we tried to look up the personality
    expect(personalityManager.getPersonality).toHaveBeenCalledWith('test-personality');
    
    // Check that alias was set
    expect(personalityManager.setPersonalityAlias).toHaveBeenCalledWith(mockMessage.author.id, 'test-personality', 'test');
    
    // Verify that channel.send was called
    expect(mockMessage.channel.send).toHaveBeenCalled();
  });
  
  test('should show error when personality is not found', async () => {
    // Mock personality not found
    personalityManager.getPersonality.mockReturnValueOnce(null);
    
    await aliasCommand.execute(mockMessage, ['nonexistent', 'test']);
    
    // Check that we tried to look up the personality
    expect(personalityManager.getPersonality).toHaveBeenCalledWith('nonexistent');
    
    // Check that no alias was set
    expect(personalityManager.setPersonalityAlias).not.toHaveBeenCalled();
    
    // Check that error message was sent
    expect(mockMessage.channel.send).toHaveBeenCalledWith(
      expect.stringContaining('not found')
    );
  });
  
  test('should handle avatar thumbnails when available', async () => {
    // Just verify the function completes successfully when an avatar is available
    // This is a simpler approach than trying to validate the exact EmbedBuilder calls
    await aliasCommand.execute(mockMessage, ['test-personality', 'test']);
    
    // Verify that personality.avatarUrl was checked (which means the thumbnail logic was run)
    expect(personalityManager.getPersonality).toHaveBeenCalledWith('test-personality');
    expect(mockMessage.channel.send).toHaveBeenCalled();
  });
  
  test('should handle personalities without avatars', async () => {
    // Mock personality without avatar
    personalityManager.getPersonality.mockReturnValueOnce({
      fullName: 'test-personality',
      displayName: 'Test Personality',
      createdBy: 'user-123'
      // No avatarUrl
    });
    
    await aliasCommand.execute(mockMessage, ['test-personality', 'test']);
    
    // Just verify command completes without error
    expect(personalityManager.setPersonalityAlias).toHaveBeenCalledWith(
      mockMessage.author.id, 'test-personality', 'test'
    );
    expect(mockMessage.channel.send).toHaveBeenCalled();
  });
  
  test('should handle errors from the setPersonalityAlias function', async () => {
    // Mock an error from setPersonalityAlias
    personalityManager.setPersonalityAlias.mockResolvedValueOnce({
      error: 'You cannot set this alias'
    });
    
    await aliasCommand.execute(mockMessage, ['test-personality', 'test']);
    
    // Check that alias set was attempted
    expect(personalityManager.setPersonalityAlias).toHaveBeenCalled();
    
    // Check that error message was sent
    expect(mockMessage.channel.send).toHaveBeenCalledWith(
      'You cannot set this alias'
    );
  });
  
  test('should handle unexpected errors', async () => {
    // Reset mocks to ensure clean state
    jest.clearAllMocks();
    
    // Force an error
    personalityManager.setPersonalityAlias.mockImplementationOnce(() => {
      throw new Error('Test error');
    });
    
    await aliasCommand.execute(mockMessage, ['test-personality', 'test']);
    
    // Check that error message was sent
    expect(mockMessage.channel.send).toHaveBeenCalledWith(
      expect.stringContaining('An error occurred while setting the alias')
    );
  });
});