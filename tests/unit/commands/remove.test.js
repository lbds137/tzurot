// Mock dependencies before requiring the module
jest.mock('discord.js');
jest.mock('../../../src/logger');
jest.mock('../../../config');
jest.mock('../../../src/personalityManager');
jest.mock('../../../src/commands/utils/commandValidator');

// Import test helpers
const helpers = require('../../utils/commandTestHelpers');

// Import mocked modules
const { EmbedBuilder } = require('discord.js');
const logger = require('../../../src/logger');
const config = require('../../../config');
const personalityManager = require('../../../src/personalityManager');
const validator = require('../../../src/commands/utils/commandValidator');

describe('Remove Command', () => {
  let removeCommand;
  let mockMessage;
  let mockDirectSend;
  
  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Reset modules
    jest.resetModules();
    
    // Mock config
    config.botPrefix = '!tz';
    
    // Mock EmbedBuilder
    EmbedBuilder.mockImplementation(() => ({
      setTitle: jest.fn().mockReturnThis(),
      setDescription: jest.fn().mockReturnThis(),
      setColor: jest.fn().mockReturnThis(),
      setThumbnail: jest.fn().mockReturnThis(),
      addFields: jest.fn().mockReturnThis(),
      setFooter: jest.fn().mockReturnThis(),
      toJSON: jest.fn().mockReturnValue({ title: 'Personality Removed' }),
    }));
    
    // Create mock message
    mockMessage = helpers.createMockMessage();
    
    // Mock direct send function
    mockDirectSend = jest.fn().mockResolvedValue({
      id: 'direct-sent-123'
    });
    
    // Mock validator
    validator.createDirectSend.mockReturnValue(mockDirectSend);
    
    // Mock personality manager
    const mockPersonality = {
      fullName: 'test-personality',
      displayName: 'Test Personality',
      avatarUrl: 'https://example.com/avatar.png'
    };
    
    personalityManager.getPersonality = jest.fn().mockReturnValue(mockPersonality);
    personalityManager.getPersonalityByAlias = jest.fn().mockReturnValue(null);
    personalityManager.removePersonality = jest.fn().mockResolvedValue({
      success: true
    });
    
    // Import the remove command after setting up mocks
    removeCommand = require('../../../src/commands/handlers/remove');
  });
  
  it('should have the correct metadata', () => {
    expect(removeCommand.meta).toEqual({
      name: 'remove',
      description: expect.any(String),
      usage: expect.any(String),
      aliases: expect.arrayContaining(['delete']),
      permissions: expect.any(Array)
    });
  });
  
  it('should require a personality name', async () => {
    await removeCommand.execute(mockMessage, []);
    
    expect(validator.createDirectSend).toHaveBeenCalledWith(mockMessage);
    helpers.verifyErrorResponse(mockDirectSend, { contains: 'need to provide a personality name' });
  });
  
  it('should handle non-existent personality', async () => {
    // Mock personality not found
    personalityManager.getPersonality.mockReturnValueOnce(null);
    personalityManager.getPersonalityByAlias.mockReturnValueOnce(null);
    
    await removeCommand.execute(mockMessage, ['nonexistent-personality']);
    
    expect(personalityManager.getPersonalityByAlias).toHaveBeenCalledWith(
      mockMessage.author.id,
      'nonexistent-personality'
    );
    expect(personalityManager.getPersonality).toHaveBeenCalledWith('nonexistent-personality');
    expect(personalityManager.removePersonality).not.toHaveBeenCalled();
    helpers.verifyErrorResponse(mockDirectSend, { contains: 'not found' });
  });
  
  it('should remove a personality by name', async () => {
    await removeCommand.execute(mockMessage, ['test-personality']);
    
    expect(personalityManager.getPersonalityByAlias).toHaveBeenCalledWith(
      mockMessage.author.id,
      'test-personality'
    );
    expect(personalityManager.getPersonality).toHaveBeenCalledWith('test-personality');
    expect(personalityManager.removePersonality).toHaveBeenCalledWith(
      mockMessage.author.id,
      'test-personality'
    );
    
    helpers.verifySuccessResponse(mockDirectSend, {
      isEmbed: true,
      title: 'Personality Removed'
    });
  });
  
  it('should remove a personality by alias', async () => {
    // Set up mock for alias lookup
    const mockPersonality = {
      fullName: 'full-personality-name',
      displayName: 'Display Name',
      avatarUrl: 'https://example.com/avatar.png'
    };
    personalityManager.getPersonalityByAlias.mockReturnValueOnce(mockPersonality);
    
    await removeCommand.execute(mockMessage, ['test-alias']);
    
    expect(personalityManager.getPersonalityByAlias).toHaveBeenCalledWith(
      mockMessage.author.id,
      'test-alias'
    );
    expect(personalityManager.getPersonality).not.toHaveBeenCalled();
    expect(personalityManager.removePersonality).toHaveBeenCalledWith(
      mockMessage.author.id,
      'full-personality-name'
    );
    
    helpers.verifySuccessResponse(mockDirectSend, {
      isEmbed: true,
      title: 'Personality Removed'
    });
  });
  
  it('should handle errors from removePersonality', async () => {
    // Mock error from removePersonality
    personalityManager.removePersonality.mockResolvedValueOnce({
      error: 'Failed to remove personality'
    });
    
    await removeCommand.execute(mockMessage, ['test-personality']);
    
    expect(personalityManager.getPersonalityByAlias).toHaveBeenCalledWith(
      mockMessage.author.id,
      'test-personality'
    );
    expect(personalityManager.getPersonality).toHaveBeenCalledWith('test-personality');
    expect(personalityManager.removePersonality).toHaveBeenCalledWith(
      mockMessage.author.id,
      'test-personality'
    );
    
    helpers.verifyErrorResponse(mockDirectSend, { contains: 'Failed to remove personality' });
  });
  
  it('should handle unexpected errors gracefully', async () => {
    // Mock unexpected error
    personalityManager.getPersonalityByAlias.mockImplementationOnce(() => {
      throw new Error('Unexpected error');
    });
    
    await removeCommand.execute(mockMessage, ['test-personality']);
    
    expect(logger.error).toHaveBeenCalled();
    helpers.verifyErrorResponse(mockDirectSend, { contains: 'error occurred' });
  });
});