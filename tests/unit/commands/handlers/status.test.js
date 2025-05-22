/**
 * Tests for the status command handler
 * Standardized format for command testing
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

jest.mock('../../../../src/logger');
jest.mock('../../../../config', () => ({
  botPrefix: '!tz'
}));

jest.mock('../../../../src/auth', () => ({
  hasValidToken: jest.fn(),
  isNsfwVerified: jest.fn()
}));

jest.mock('../../../../src/personalityManager', () => ({
  listPersonalitiesForUser: jest.fn()
}));

jest.mock('../../../../src/commands/handlers/autorespond', () => ({
  isAutoResponseEnabled: jest.fn()
}));

jest.mock('../../../../src/commands/utils/commandValidator', () => ({
  createDirectSend: jest.fn(),
  isAdmin: jest.fn().mockReturnValue(false),
  canManageMessages: jest.fn().mockReturnValue(false),
  isNsfwChannel: jest.fn().mockReturnValue(false)
}));

// Use enhanced test utilities
const { createMigrationHelper } = require('../../../utils/testEnhancements');

// Import mocked modules
const logger = require('../../../../src/logger');
const validator = require('../../../../src/commands/utils/commandValidator');
const auth = require('../../../../src/auth');

// Get migration helper for enhanced patterns
const migrationHelper = createMigrationHelper('command');
const personalityManager = require('../../../../src/personalityManager');
const autorespond = require('../../../../src/commands/handlers/autorespond');
const { EmbedBuilder } = require('discord.js');

describe('Status Command', () => {
  let statusCommand;
  let mockMessage;
  let mockEmbed;
  let mockDirectSend;
  
  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Create enhanced mock message with less boilerplate
    mockMessage = migrationHelper.enhanced.createMessage({
      content: '!tz status',
      author: { id: 'user-123', username: 'testuser' }
    });
    
    // Override default response for this test
    mockMessage.channel.send = jest.fn().mockResolvedValue({
      id: 'sent-message-123',
      embeds: [{ title: 'Bot Status' }]
    });
    
    // Set up mock direct send function
    mockDirectSend = jest.fn().mockImplementation(content => {
      return mockMessage.channel.send(content);
    });
    
    // Set up validator mock
    validator.createDirectSend.mockReturnValue(mockDirectSend);
    
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
    
    // Import command module after mock setup
    statusCommand = require('../../../../src/commands/handlers/status');
  });
  
  afterEach(() => {
    // Clear any globals we set
    delete global.tzurotClient;
  });
  
  it('should have the correct metadata', () => {
    // Use enhanced assertion helper
    migrationHelper.enhanced.assert.assertCommandMetadata(statusCommand, 'status');
  });
  
  it('should display bot status for authenticated user', async () => {
    await statusCommand.execute(mockMessage, []);
    
    // Verify that createDirectSend was called with the message
    expect(validator.createDirectSend).toHaveBeenCalledWith(mockMessage);
    
    // Verify embed was created with correct title
    expect(EmbedBuilder).toHaveBeenCalled();
    expect(mockEmbed.setTitle).toHaveBeenCalledWith('Bot Status');
    
    // Verify basic fields were added
    expect(mockEmbed.addFields).toHaveBeenCalledWith(
      { name: 'Uptime', value: expect.stringContaining('hour'), inline: true },
      { name: 'Ping', value: '42ms', inline: true },
      { name: 'Authenticated', value: '✅ Yes', inline: true },
      { name: 'Age Verified', value: '❌ No', inline: true },
      { name: 'Guild Count', value: '10 servers', inline: true }
    );
    
    // Verify personalities field was added (since user is authenticated)
    expect(mockEmbed.addFields).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Your Personalities',
        value: '2 personalities',
        inline: true
      })
    );
    
    // Verify bot avatar was set
    expect(mockEmbed.setThumbnail).toHaveBeenCalledWith('https://example.com/avatar.png');
    
    // Verify the message was sent with the embed
    expect(mockDirectSend).toHaveBeenCalledWith({ embeds: [mockEmbed] });
  });
  
  it('should show different fields for non-authenticated user', async () => {
    // Mock user as not authenticated
    auth.hasValidToken.mockReturnValue(false);
    
    await statusCommand.execute(mockMessage, []);
    
    // Verify that personalityManager.listPersonalitiesForUser was not called
    expect(personalityManager.listPersonalitiesForUser).not.toHaveBeenCalled();
    
    // Verify the Authentication status field was added with value No
    // First call to addFields includes the base fields 
    expect(mockEmbed.addFields.mock.calls[0]).toContainEqual(
      expect.objectContaining({
        name: 'Authenticated',
        value: '❌ No',
        inline: true
      })
    );
    
    // Verify personalities field was NOT added
    expect(mockEmbed.addFields).not.toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Your Personalities',
        value: expect.any(String),
        inline: true
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
    expect(mockDirectSend).toHaveBeenCalledWith(
      expect.stringContaining('An error occurred while getting bot status:')
    );
  });
});