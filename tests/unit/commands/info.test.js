// Mock dependencies before requiring the module
jest.mock('discord.js');
jest.mock('../../../src/logger');
jest.mock('../../../config');
jest.mock('../../../src/personalityManager');
jest.mock('../../../src/aiService');
jest.mock('../../../src/commands/utils/commandValidator');

// Import test helpers
const helpers = require('../../utils/commandTestHelpers');

// Import mocked modules
const { EmbedBuilder } = require('discord.js');
const logger = require('../../../src/logger');
const config = require('../../../config');
const personalityManager = require('../../../src/personalityManager');
const aiService = require('../../../src/aiService');
const validator = require('../../../src/commands/utils/commandValidator');

describe('Info Command', () => {
  let infoCommand;
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
      toJSON: jest.fn().mockReturnValue({ title: 'Personality Info' }),
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
      avatarUrl: 'https://example.com/avatar.png',
      aliases: {
        'user-123': ['alias1', 'alias2']
      }
    };
    
    personalityManager.getPersonality = jest.fn().mockReturnValue(mockPersonality);
    personalityManager.getPersonalityByAlias = jest.fn().mockReturnValue(null);
    
    // Mock aiService
    aiService.knownProblematicPersonalities = [];
    aiService.runtimeProblematicPersonalities = new Map();
    
    // Import the info command after setting up mocks
    infoCommand = require('../../../src/commands/handlers/info');
  });
  
  it('should have the correct metadata', () => {
    expect(infoCommand.meta).toEqual({
      name: 'info',
      description: expect.any(String),
      usage: expect.any(String),
      aliases: expect.any(Array),
      permissions: expect.any(Array)
    });
  });
  
  it('should require a personality name or alias', async () => {
    await infoCommand.execute(mockMessage, []);
    
    expect(validator.createDirectSend).toHaveBeenCalledWith(mockMessage);
    helpers.verifyErrorResponse(mockDirectSend, { contains: 'need to provide a personality name or alias' });
  });
  
  it('should handle non-existent personality', async () => {
    // Mock personality not found
    personalityManager.getPersonality.mockReturnValueOnce(null);
    personalityManager.getPersonalityByAlias.mockReturnValueOnce(null);
    
    await infoCommand.execute(mockMessage, ['nonexistent-personality']);
    
    expect(personalityManager.getPersonalityByAlias).toHaveBeenCalledWith(
      mockMessage.author.id,
      'nonexistent-personality'
    );
    expect(personalityManager.getPersonality).toHaveBeenCalledWith('nonexistent-personality');
    helpers.verifyErrorResponse(mockDirectSend, { contains: 'not found' });
  });
  
  it('should show info for a personality by name', async () => {
    await infoCommand.execute(mockMessage, ['test-personality']);
    
    expect(personalityManager.getPersonalityByAlias).toHaveBeenCalledWith(
      mockMessage.author.id,
      'test-personality'
    );
    expect(personalityManager.getPersonality).toHaveBeenCalledWith('test-personality');
    
    helpers.verifySuccessResponse(mockDirectSend, {
      isEmbed: true,
      title: 'Personality Info'
    });
  });
  
  it('should show info for a personality by alias', async () => {
    // Set up mock for alias lookup
    const mockPersonality = {
      fullName: 'full-personality-name',
      displayName: 'Display Name',
      avatarUrl: 'https://example.com/avatar.png',
      aliases: {
        'user-123': ['test-alias', 'another-alias']
      }
    };
    personalityManager.getPersonalityByAlias.mockReturnValueOnce(mockPersonality);
    
    await infoCommand.execute(mockMessage, ['test-alias']);
    
    expect(personalityManager.getPersonalityByAlias).toHaveBeenCalledWith(
      mockMessage.author.id,
      'test-alias'
    );
    expect(personalityManager.getPersonality).not.toHaveBeenCalled();
    
    helpers.verifySuccessResponse(mockDirectSend, {
      isEmbed: true,
      title: 'Personality Info'
    });
  });
  
  it('should show problematic status for known problematic personalities', async () => {
    // Mock a problematic personality
    aiService.knownProblematicPersonalities = ['test-personality'];
    
    await infoCommand.execute(mockMessage, ['test-personality']);
    
    helpers.verifySuccessResponse(mockDirectSend, {
      isEmbed: true,
      title: 'Personality Info'
    });
    
    // Check that addFields was called with problematic status
    const embedInstance = EmbedBuilder.mock.results[0].value;
    expect(embedInstance.addFields).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Status',
      value: expect.stringContaining('experienced issues')
    }));
  });
  
  it('should show problematic status for runtime problematic personalities', async () => {
    // Mock a runtime problematic personality
    aiService.runtimeProblematicPersonalities = new Map([
      ['test-personality', Date.now()]
    ]);
    
    await infoCommand.execute(mockMessage, ['test-personality']);
    
    helpers.verifySuccessResponse(mockDirectSend, {
      isEmbed: true,
      title: 'Personality Info'
    });
    
    // Check that addFields was called with problematic status
    const embedInstance = EmbedBuilder.mock.results[0].value;
    expect(embedInstance.addFields).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Status',
      value: expect.stringContaining('experienced issues')
    }));
  });
  
  it('should handle unexpected errors gracefully', async () => {
    // Mock unexpected error
    personalityManager.getPersonalityByAlias.mockImplementationOnce(() => {
      throw new Error('Unexpected error');
    });
    
    await infoCommand.execute(mockMessage, ['test-personality']);
    
    expect(logger.error).toHaveBeenCalled();
    helpers.verifyErrorResponse(mockDirectSend, { contains: 'error occurred' });
  });
});