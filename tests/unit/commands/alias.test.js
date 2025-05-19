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

describe('Alias Command', () => {
  let aliasCommand;
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
      toJSON: jest.fn().mockReturnValue({ title: 'Alias Added' }),
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
    personalityManager.getPersonality = jest.fn().mockReturnValue({
      fullName: 'test-personality',
      displayName: 'Test Personality',
      avatarUrl: 'https://example.com/avatar.png'
    });
    
    personalityManager.setPersonalityAlias = jest.fn().mockResolvedValue({
      success: true
    });
    
    // Import the alias command after setting up mocks
    aliasCommand = require('../../../src/commands/handlers/alias');
  });
  
  it('should have the correct metadata', () => {
    expect(aliasCommand.meta).toEqual({
      name: 'alias',
      description: expect.any(String),
      usage: expect.any(String),
      aliases: expect.any(Array),
      permissions: expect.any(Array)
    });
  });
  
  it('should require a personality name and alias', async () => {
    await aliasCommand.execute(mockMessage, []);
    
    expect(validator.createDirectSend).toHaveBeenCalledWith(mockMessage);
    helpers.verifyErrorResponse(mockDirectSend, { contains: 'need to provide a personality name and an alias' });
  });
  
  it('should handle non-existent personality', async () => {
    // Mock personality not found
    personalityManager.getPersonality.mockReturnValueOnce(null);
    
    await aliasCommand.execute(mockMessage, ['nonexistent-personality', 'alias']);
    
    expect(personalityManager.getPersonality).toHaveBeenCalledWith('nonexistent-personality');
    expect(personalityManager.setPersonalityAlias).not.toHaveBeenCalled();
    helpers.verifyErrorResponse(mockDirectSend, { contains: 'not found' });
  });
  
  it('should set an alias for an existing personality', async () => {
    await aliasCommand.execute(mockMessage, ['test-personality', 'test-alias']);
    
    expect(personalityManager.getPersonality).toHaveBeenCalledWith('test-personality');
    expect(personalityManager.setPersonalityAlias).toHaveBeenCalledWith(
      mockMessage.author.id,
      'test-personality',
      'test-alias'
    );
    
    helpers.verifySuccessResponse(mockDirectSend, {
      isEmbed: true,
      title: 'Alias Added'
    });
  });
  
  it('should handle errors from setPersonalityAlias', async () => {
    // Mock error from setPersonalityAlias
    personalityManager.setPersonalityAlias.mockResolvedValueOnce({
      error: 'Failed to set alias'
    });
    
    await aliasCommand.execute(mockMessage, ['test-personality', 'test-alias']);
    
    expect(personalityManager.getPersonality).toHaveBeenCalledWith('test-personality');
    expect(personalityManager.setPersonalityAlias).toHaveBeenCalledWith(
      mockMessage.author.id,
      'test-personality',
      'test-alias'
    );
    
    helpers.verifyErrorResponse(mockDirectSend, { contains: 'Failed to set alias' });
  });
  
  it('should handle unexpected errors gracefully', async () => {
    // Mock unexpected error
    personalityManager.getPersonality.mockImplementationOnce(() => {
      throw new Error('Unexpected error');
    });
    
    await aliasCommand.execute(mockMessage, ['test-personality', 'test-alias']);
    
    expect(logger.error).toHaveBeenCalled();
    helpers.verifyErrorResponse(mockDirectSend, { contains: 'error occurred' });
  });
});