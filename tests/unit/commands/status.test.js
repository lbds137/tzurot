/**
 * Tests for the status command handler
 */

// Mock dependencies before requiring the module
jest.mock('discord.js', () => ({
  EmbedBuilder: jest.fn().mockImplementation(() => ({
    setTitle: jest.fn().mockReturnThis(),
    setDescription: jest.fn().mockReturnThis(),
    setColor: jest.fn().mockReturnThis(),
    addFields: jest.fn().mockReturnThis(),
    setThumbnail: jest.fn().mockReturnThis(),
    setFooter: jest.fn().mockReturnThis()
  }))
}));

jest.mock('../../../src/logger');
jest.mock('../../../config', () => ({
  botPrefix: '!tz'
}));

jest.mock('../../../src/auth', () => ({
  hasValidToken: jest.fn(),
  isNsfwVerified: jest.fn()
}));

jest.mock('../../../src/personalityManager', () => ({
  listPersonalitiesForUser: jest.fn()
}));

jest.mock('../../../src/commands/handlers/autorespond', () => ({
  isAutoResponseEnabled: jest.fn()
}));

// Mock utils and commandValidator
jest.mock('../../../src/utils', () => ({
  createDirectSend: jest.fn().mockImplementation((message) => {
    return async (content) => {
      return message.channel.send(content);
    };
  })
}));

jest.mock('../../../src/commands/utils/commandValidator', () => {
  return {
    createDirectSend: jest.fn().mockImplementation((message) => {
      const directSend = async (content) => {
        return message.channel.send(content);
      };
      return directSend;
    }),
    isAdmin: jest.fn().mockReturnValue(false),
    canManageMessages: jest.fn().mockReturnValue(false),
    isNsfwChannel: jest.fn().mockReturnValue(false)
  };
});

// Set up global tzurotClient mock
global.tzurotClient = {
  user: {
    username: 'TzurotBot',
    avatarURL: jest.fn().mockReturnValue('https://example.com/avatar.png')
  },
  ws: {
    ping: 42
  },
  guilds: {
    cache: {
      size: 10
    }
  }
};

// Import test helpers
const helpers = require('../../utils/commandTestHelpers');

// Import mocked modules
const logger = require('../../../src/logger');
const validator = require('../../../src/commands/utils/commandValidator');
const auth = require('../../../src/auth');
const personalityManager = require('../../../src/personalityManager');
const autorespond = require('../../../src/commands/handlers/autorespond');
const { EmbedBuilder } = require('discord.js');

describe('Status Command', () => {
  let statusCommand;
  let mockMessage;
  let mockEmbed;
  
  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Create mock message with standard channel.send mock
    mockMessage = helpers.createMockMessage();
    mockMessage.channel.send = jest.fn().mockResolvedValue({
      id: 'sent-message-123',
      embeds: [{ title: 'Bot Status' }]
    });
    
    // Mock process.uptime
    process.uptime = jest.fn().mockReturnValue(3665); // 1 hour, 1 minute, 5 seconds
    
    // Set up auth mocks
    auth.hasValidToken.mockReturnValue(true);
    auth.isNsfwVerified.mockReturnValue(false);
    
    // Set up personalityManager mock
    personalityManager.listPersonalitiesForUser.mockReturnValue(['personality1', 'personality2']);
    
    // Set up autorespond mock
    autorespond.isAutoResponseEnabled.mockReturnValue(true);
    
    // Set up embed mock
    mockEmbed = {
      setTitle: jest.fn().mockReturnThis(),
      setDescription: jest.fn().mockReturnThis(),
      setColor: jest.fn().mockReturnThis(),
      addFields: jest.fn().mockReturnThis(),
      setThumbnail: jest.fn().mockReturnThis(),
      setFooter: jest.fn().mockReturnThis()
    };
    EmbedBuilder.mockReturnValue(mockEmbed);
    
    // Import command module after mock setup
    statusCommand = require('../../../src/commands/handlers/status');
  });
  
  afterEach(() => {
    // Clear any globals we set
    delete global.tzurotClient;
  });
  
  it('should display bot status for authenticated user', async () => {
    const result = await statusCommand.execute(mockMessage, []);
    
    // Verify that createDirectSend was called with the message
    expect(validator.createDirectSend).toHaveBeenCalledWith(mockMessage);
    
    // Verify embed was created with correct title
    expect(EmbedBuilder).toHaveBeenCalled();
    expect(mockEmbed.setTitle).toHaveBeenCalledWith('Bot Status');
    
    // Verify embed fields were added
    expect(mockEmbed.addFields).toHaveBeenCalledTimes(5);
    
    // Verify uptime was formatted correctly
    expect(mockEmbed.addFields.mock.calls[0][0]).toEqual(
      expect.objectContaining({ name: 'Uptime', value: expect.stringContaining('hour') })
    );
    
    // Verify bot avatar was set
    expect(mockEmbed.setThumbnail).toHaveBeenCalledWith('https://example.com/avatar.png');
    
    // Verify the message was sent with the embed
    expect(mockMessage.channel.send).toHaveBeenCalledWith({ embeds: [mockEmbed] });
  });
  
  it('should show different fields for non-authenticated user', async () => {
    // Mock user as not authenticated
    auth.hasValidToken.mockReturnValue(false);
    
    const result = await statusCommand.execute(mockMessage, []);
    
    // Verify that personalityManager.listPersonalitiesForUser was not called
    expect(personalityManager.listPersonalitiesForUser).not.toHaveBeenCalled();
    
    // Verify embed fields were added (should be 4 instead of 5)
    expect(mockEmbed.addFields).toHaveBeenCalledTimes(4);
    
    // Verify authenticated status is shown as No
    expect(mockEmbed.addFields.mock.calls[2][0]).toEqual(
      expect.objectContaining({ 
        name: 'Authenticated', 
        value: expect.stringContaining('No') 
      })
    );
  });
  
  it('should handle errors properly', async () => {
    // Mock logger.error
    logger.error = jest.fn();
    
    // Force an error in EmbedBuilder
    EmbedBuilder.mockImplementationOnce(() => {
      throw new Error('Test error in status command');
    });
    
    await statusCommand.execute(mockMessage, []);
    
    // Verify that logger.error was called
    expect(logger.error).toHaveBeenCalled();
    expect(logger.error.mock.calls[0][0]).toContain('Error in status command:');
    
    // Verify error message was sent
    expect(mockMessage.channel.send).toHaveBeenCalledWith(
      expect.stringContaining('An error occurred while getting bot status:')
    );
  });
  
  it('should expose correct metadata', () => {
    expect(statusCommand.meta).toBeDefined();
    expect(statusCommand.meta.name).toBe('status');
    expect(statusCommand.meta.description).toBeTruthy();
  });
});