// Mock dependencies before requiring the module
jest.mock('discord.js');
jest.mock('../../../src/logger');
jest.mock('../../../config');
jest.mock('../../../src/personalityManager');
jest.mock('../../../src/conversationManager');
jest.mock('../../../src/utils/channelUtils');
jest.mock('../../../src/commands/utils/commandValidator');

// Import test helpers
const helpers = require('../../utils/commandTestHelpers');

// Import mocked modules
const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const logger = require('../../../src/logger');
const config = require('../../../config');
const personalityManager = require('../../../src/personalityManager');
const conversationManager = require('../../../src/conversationManager');
const channelUtils = require('../../../src/utils/channelUtils');
const validator = require('../../../src/commands/utils/commandValidator');

describe('Activate Command', () => {
  let activateCommand;
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
      toJSON: jest.fn().mockReturnValue({ title: 'Personality Activated' }),
    }));
    
    // Create mock message
    mockMessage = helpers.createMockMessage({
      isDM: false,
      canManageMessages: true,
      isNSFW: true
    });
    
    // Mock direct send function
    mockDirectSend = jest.fn().mockResolvedValue({
      id: 'direct-sent-123'
    });
    
    // Mock validator
    validator.createDirectSend.mockReturnValue(mockDirectSend);
    validator.canManageMessages.mockReturnValue(true);
    
    // Mock channelUtils
    channelUtils.isChannelNSFW.mockReturnValue(true);
    
    // Mock personality manager
    const mockPersonality = {
      fullName: 'test-personality',
      displayName: 'Test Personality',
      avatarUrl: 'https://example.com/avatar.png'
    };
    
    personalityManager.getPersonality = jest.fn().mockReturnValue(mockPersonality);
    personalityManager.getPersonalityByAlias = jest.fn().mockReturnValue(null);
    
    // Mock conversation manager
    conversationManager.activatePersonality = jest.fn().mockReturnValue({
      success: true
    });
    
    // Import the activate command after setting up mocks
    activateCommand = require('../../../src/commands/handlers/activate');
  });
  
  it('should have the correct metadata', () => {
    expect(activateCommand.meta).toEqual({
      name: 'activate',
      description: expect.any(String),
      usage: expect.any(String),
      aliases: expect.any(Array),
      permissions: expect.arrayContaining(['MANAGE_MESSAGES', 'NSFW_CHANNEL'])
    });
  });
  
  it('should not allow activation in DMs', async () => {
    // Mock DM channel
    mockMessage.channel.isDMBased.mockReturnValue(true);
    
    await activateCommand.execute(mockMessage, ['test-personality']);
    
    expect(validator.createDirectSend).toHaveBeenCalledWith(mockMessage);
    helpers.verifyErrorResponse(mockDirectSend, { contains: 'not needed in DMs' });
    expect(conversationManager.activatePersonality).not.toHaveBeenCalled();
  });
  
  it('should require Manage Messages permission', async () => {
    // Mock no Manage Messages permission
    validator.canManageMessages.mockReturnValue(false);
    
    await activateCommand.execute(mockMessage, ['test-personality']);
    
    helpers.verifyErrorResponse(mockDirectSend, { contains: 'need the "Manage Messages" permission' });
    expect(conversationManager.activatePersonality).not.toHaveBeenCalled();
  });
  
  it('should require NSFW channel', async () => {
    // Mock non-NSFW channel
    channelUtils.isChannelNSFW.mockReturnValue(false);
    
    await activateCommand.execute(mockMessage, ['test-personality']);
    
    helpers.verifyErrorResponse(mockDirectSend, { contains: 'safety and compliance' });
    expect(conversationManager.activatePersonality).not.toHaveBeenCalled();
  });
  
  it('should require a personality name', async () => {
    await activateCommand.execute(mockMessage, []);
    
    helpers.verifyErrorResponse(mockDirectSend, { contains: 'need to provide a personality name' });
    expect(conversationManager.activatePersonality).not.toHaveBeenCalled();
  });
  
  it('should handle non-existent personality', async () => {
    // Mock personality not found
    personalityManager.getPersonality.mockReturnValueOnce(null);
    personalityManager.getPersonalityByAlias.mockReturnValueOnce(null);
    
    await activateCommand.execute(mockMessage, ['nonexistent-personality']);
    
    expect(personalityManager.getPersonalityByAlias).toHaveBeenCalledWith(
      mockMessage.author.id,
      'nonexistent-personality'
    );
    expect(personalityManager.getPersonality).toHaveBeenCalledWith('nonexistent-personality');
    helpers.verifyErrorResponse(mockDirectSend, { contains: 'not found' });
    expect(conversationManager.activatePersonality).not.toHaveBeenCalled();
  });
  
  it('should activate a personality by name', async () => {
    await activateCommand.execute(mockMessage, ['test-personality']);
    
    expect(personalityManager.getPersonalityByAlias).toHaveBeenCalledWith(
      mockMessage.author.id,
      'test-personality'
    );
    expect(personalityManager.getPersonality).toHaveBeenCalledWith('test-personality');
    expect(conversationManager.activatePersonality).toHaveBeenCalledWith(
      mockMessage.channel.id,
      'test-personality'
    );
    
    helpers.verifySuccessResponse(mockDirectSend, {
      isEmbed: true,
      title: 'Personality Activated'
    });
  });
  
  it('should activate a personality by alias', async () => {
    // Set up mock for alias lookup
    const mockPersonality = {
      fullName: 'full-personality-name',
      displayName: 'Display Name',
      avatarUrl: 'https://example.com/avatar.png'
    };
    personalityManager.getPersonalityByAlias.mockReturnValueOnce(mockPersonality);
    
    await activateCommand.execute(mockMessage, ['test-alias']);
    
    expect(personalityManager.getPersonalityByAlias).toHaveBeenCalledWith(
      mockMessage.author.id,
      'test-alias'
    );
    expect(personalityManager.getPersonality).not.toHaveBeenCalled();
    expect(conversationManager.activatePersonality).toHaveBeenCalledWith(
      mockMessage.channel.id,
      'full-personality-name'
    );
    
    helpers.verifySuccessResponse(mockDirectSend, {
      isEmbed: true,
      title: 'Personality Activated'
    });
  });
  
  it('should support multi-word personality names/aliases', async () => {
    await activateCommand.execute(mockMessage, ['test', 'personality', 'with', 'spaces']);
    
    expect(personalityManager.getPersonalityByAlias).toHaveBeenCalledWith(
      mockMessage.author.id,
      'test personality with spaces'
    );
    
    helpers.verifySuccessResponse(mockDirectSend, {
      isEmbed: true,
      title: 'Personality Activated'
    });
  });
  
  it('should handle errors from activatePersonality', async () => {
    // Mock error from activatePersonality
    conversationManager.activatePersonality.mockReturnValueOnce({
      error: 'Failed to activate personality'
    });
    
    await activateCommand.execute(mockMessage, ['test-personality']);
    
    expect(personalityManager.getPersonalityByAlias).toHaveBeenCalledWith(
      mockMessage.author.id,
      'test-personality'
    );
    expect(personalityManager.getPersonality).toHaveBeenCalledWith('test-personality');
    expect(conversationManager.activatePersonality).toHaveBeenCalledWith(
      mockMessage.channel.id,
      'test-personality'
    );
    
    helpers.verifyErrorResponse(mockDirectSend, { contains: 'Failed to activate personality' });
  });
  
  it('should handle unexpected errors gracefully', async () => {
    // Mock unexpected error
    personalityManager.getPersonalityByAlias.mockImplementationOnce(() => {
      throw new Error('Unexpected error');
    });
    
    await activateCommand.execute(mockMessage, ['test-personality']);
    
    expect(logger.error).toHaveBeenCalled();
    helpers.verifyErrorResponse(mockDirectSend, { contains: 'error occurred' });
  });
});