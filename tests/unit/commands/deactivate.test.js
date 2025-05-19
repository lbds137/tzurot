// Mock dependencies before requiring the module
jest.mock('discord.js');
jest.mock('../../../src/logger');
jest.mock('../../../config');
jest.mock('../../../src/conversationManager');
jest.mock('../../../src/commands/utils/commandValidator');
jest.mock('../../../src/utils', () => ({
  createDirectSend: jest.fn().mockImplementation(message => {
    return async content => {
      return await message.channel.send(content);
    };
  }),
  validateAlias: jest.fn(),
  cleanupTimeout: jest.fn(),
  safeToLowerCase: jest.fn(),
  getAllAliasesForPersonality: jest.fn()
}));

// Import test helpers
const helpers = require('../../utils/commandTestHelpers');

// Import mocked modules
const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const logger = require('../../../src/logger');
const config = require('../../../config');
const conversationManager = require('../../../src/conversationManager');
const validator = require('../../../src/commands/utils/commandValidator');

describe('Deactivate Command', () => {
  let deactivateCommand;
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
      toJSON: jest.fn().mockReturnValue({ title: 'Channel Deactivated' }),
    }));
    
    // Create mock message
    mockMessage = helpers.createMockMessage({
      isDM: false,
      canManageMessages: true
    });
    
    // Mock direct send function
    mockDirectSend = jest.fn().mockResolvedValue({
      id: 'direct-sent-123'
    });
    
    // Mock validator
    validator.createDirectSend.mockReturnValue(mockDirectSend);
    validator.canManageMessages.mockReturnValue(true);
    
    // Mock conversation manager
    conversationManager.deactivatePersonality = jest.fn().mockReturnValue({
      success: true
    });
    
    // Import the deactivate command after setting up mocks
    deactivateCommand = require('../../../src/commands/handlers/deactivate');
  });
  
  it('should have the correct metadata', () => {
    expect(deactivateCommand.meta).toEqual({
      name: 'deactivate',
      description: expect.any(String),
      usage: expect.any(String),
      aliases: expect.any(Array),
      permissions: expect.arrayContaining(['MANAGE_MESSAGES'])
    });
  });
  
  it('should not allow deactivation in DMs', async () => {
    // Mock DM channel
    mockMessage.channel.isDMBased.mockReturnValue(true);
    
    await deactivateCommand.execute(mockMessage, []);
    
    expect(validator.createDirectSend).toHaveBeenCalledWith(mockMessage);
    helpers.verifyErrorResponse(mockDirectSend, { contains: 'not used in DMs' });
    expect(conversationManager.deactivatePersonality).not.toHaveBeenCalled();
  });
  
  it('should require Manage Messages permission', async () => {
    // Mock no Manage Messages permission
    validator.canManageMessages.mockReturnValue(false);
    
    await deactivateCommand.execute(mockMessage, []);
    
    helpers.verifyErrorResponse(mockDirectSend, { contains: 'need the "Manage Messages" permission' });
    expect(conversationManager.deactivatePersonality).not.toHaveBeenCalled();
  });
  
  it('should deactivate the personality in the channel', async () => {
    await deactivateCommand.execute(mockMessage, []);
    
    expect(conversationManager.deactivatePersonality).toHaveBeenCalledWith(
      mockMessage.channel.id
    );
    
    helpers.verifySuccessResponse(mockDirectSend, {
      isEmbed: true,
      title: 'Channel Deactivated'
    });
  });
  
  it('should handle errors from deactivatePersonality', async () => {
    // Mock error from deactivatePersonality
    conversationManager.deactivatePersonality.mockReturnValueOnce({
      error: 'No personality was active in this channel'
    });
    
    await deactivateCommand.execute(mockMessage, []);
    
    expect(conversationManager.deactivatePersonality).toHaveBeenCalledWith(
      mockMessage.channel.id
    );
    
    helpers.verifyErrorResponse(mockDirectSend, { contains: 'No personality was active' });
  });
  
  it('should handle unexpected errors gracefully', async () => {
    // Mock unexpected error
    conversationManager.deactivatePersonality.mockImplementationOnce(() => {
      throw new Error('Unexpected error');
    });
    
    await deactivateCommand.execute(mockMessage, []);
    
    expect(logger.error).toHaveBeenCalled();
    helpers.verifyErrorResponse(mockDirectSend, { contains: 'error occurred' });
  });
});