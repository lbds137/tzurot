/**
 * Tests for the add command handler
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

jest.mock('../../../src/commands/utils/messageTracker', () => ({
  isAddCommandProcessed: jest.fn(),
  markAddCommandAsProcessed: jest.fn(),
  isAddCommandCompleted: jest.fn(),
  hasFirstEmbed: jest.fn(),
  markGeneratedFirstEmbed: jest.fn(),
  markSendingEmbed: jest.fn(),
  clearSendingEmbed: jest.fn(),
  markAddCommandCompleted: jest.fn()
}));

jest.mock('../../../src/personalityManager', () => ({
  registerPersonality: jest.fn()
}));

jest.mock('../../../src/webhookManager', () => ({
  preloadPersonalityAvatar: jest.fn().mockResolvedValue(true)
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

// Import test helpers
const helpers = require('../../utils/commandTestHelpers');

// Import mocked modules
const { EmbedBuilder } = require('discord.js');
const logger = require('../../../src/logger');
const validator = require('../../../src/commands/utils/commandValidator');
const messageTracker = require('../../../src/commands/utils/messageTracker');
const personalityManager = require('../../../src/personalityManager');
const webhookManager = require('../../../src/webhookManager');

describe('Add Command', () => {
  let addCommand;
  let mockMessage;
  let mockEmbed;
  
  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Reset modules to ensure a clean test environment
    jest.resetModules();
    
    // Create mock message with standard channel.send mock
    mockMessage = helpers.createMockMessage();
    mockMessage.channel.send = jest.fn().mockResolvedValue({
      id: 'sent-message-123',
      embeds: [{ title: 'Personality Added' }]
    });
    
    // Mock sendTyping
    mockMessage.channel.sendTyping = jest.fn().mockResolvedValue(undefined);
    
    // Set up messageTracker mocks with default values
    messageTracker.isAddCommandProcessed.mockReturnValue(false);
    messageTracker.isAddCommandCompleted.mockReturnValue(false);
    messageTracker.hasFirstEmbed.mockReturnValue(false);
    
    // Set up personalityManager mock
    personalityManager.registerPersonality.mockResolvedValue({
      personality: {
        fullName: 'test-personality',
        displayName: 'Test Personality',
        avatarUrl: 'https://example.com/avatar.png',
        createdBy: 'user-123',
        createdAt: Date.now()
      }
    });
    
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
    addCommand = require('../../../src/commands/handlers/add');
  });
  
  it('should show usage information when no arguments are provided', async () => {
    const result = await addCommand.execute(mockMessage, []);
    
    // Verify messageTracker was called
    expect(messageTracker.markAddCommandAsProcessed).toHaveBeenCalledWith(mockMessage.id);
    
    // Verify usage information was sent
    expect(mockMessage.channel.send).toHaveBeenCalledWith(
      expect.stringContaining('You need to provide a personality name')
    );
  });
  
  it('should add a personality successfully', async () => {
    const result = await addCommand.execute(mockMessage, ['test-personality']);
    
    // Verify that validator.createDirectSend was called with the message
    expect(validator.createDirectSend).toHaveBeenCalledWith(mockMessage);
    
    // Verify personality registration was called
    expect(personalityManager.registerPersonality).toHaveBeenCalledWith(
      mockMessage.author.id,
      'test-personality',
      null
    );
    
    // Verify avatar preload was called
    expect(webhookManager.preloadPersonalityAvatar).toHaveBeenCalled();
    
    // Verify embed was created with correct title
    expect(EmbedBuilder).toHaveBeenCalled();
    expect(mockEmbed.setTitle).toHaveBeenCalledWith('Personality Added');
    expect(mockEmbed.setDescription).toHaveBeenCalledWith(
      expect.stringContaining('test-personality')
    );
    
    // Verify the message was sent with the embed
    expect(mockMessage.channel.send).toHaveBeenCalledWith({ embeds: [mockEmbed] });
    
    // Verify tracking was updated
    expect(messageTracker.markGeneratedFirstEmbed).toHaveBeenCalled();
    expect(messageTracker.markSendingEmbed).toHaveBeenCalled();
    expect(messageTracker.clearSendingEmbed).toHaveBeenCalled();
    expect(messageTracker.markAddCommandCompleted).toHaveBeenCalled();
  });
  
  it('should add a personality with an alias', async () => {
    const result = await addCommand.execute(mockMessage, ['test-personality', 'test-alias']);
    
    // Verify personality registration was called with alias
    expect(personalityManager.registerPersonality).toHaveBeenCalledWith(
      mockMessage.author.id,
      'test-personality',
      'test-alias'
    );
    
    // Verify embed includes alias information
    expect(mockEmbed.addFields).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Alias',
        value: 'test-alias'
      }),
      expect.anything(),
      expect.anything()
    );
  });
  
  it('should handle registration errors', async () => {
    // Mock an error from registerPersonality
    personalityManager.registerPersonality.mockResolvedValueOnce({
      error: 'That personality already exists'
    });
    
    const result = await addCommand.execute(mockMessage, ['test-personality']);
    
    // Verify error message was sent
    expect(mockMessage.channel.send).toHaveBeenCalledWith('That personality already exists');
    
    // Verify tracking was updated even in error case
    expect(messageTracker.markAddCommandCompleted).toHaveBeenCalled();
  });
  
  it('should handle exception errors', async () => {
    // Force an exception in the registerPersonality function
    personalityManager.registerPersonality.mockImplementationOnce(() => {
      throw new Error('Test error in personality registration');
    });
    
    const result = await addCommand.execute(mockMessage, ['test-personality']);
    
    // Verify logger.error was called
    expect(logger.error).toHaveBeenCalled();
    
    // Verify error message was sent
    expect(mockMessage.channel.send).toHaveBeenCalledWith(
      expect.stringContaining('An error occurred while adding the personality:')
    );
  });
  
  it('should block duplicate add commands', async () => {
    // Mock that the message has already been processed
    messageTracker.isAddCommandProcessed.mockReturnValueOnce(true);
    
    const result = await addCommand.execute(mockMessage, ['test-personality']);
    
    // Verify that no further processing happened
    expect(personalityManager.registerPersonality).not.toHaveBeenCalled();
    expect(mockMessage.channel.send).not.toHaveBeenCalled();
    
    // Verify logger warning was issued
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('already been processed by add command handler')
    );
  });
  
  it('should block commands that already completed', async () => {
    // Mock that the command has already been completed
    messageTracker.isAddCommandCompleted.mockReturnValueOnce(true);
    
    const result = await addCommand.execute(mockMessage, ['test-personality']);
    
    // Verify that no embed was sent
    expect(mockMessage.channel.send).not.toHaveBeenCalled();
    expect(EmbedBuilder).not.toHaveBeenCalled();
    
    // Verify logger warning was issued
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Command has already been processed')
    );
  });
  
  it('should block commands that already generated an embed', async () => {
    // Mock that the first embed has already been generated
    messageTracker.hasFirstEmbed.mockReturnValueOnce(true);
    
    const result = await addCommand.execute(mockMessage, ['test-personality']);
    
    // Verify that no embed was sent
    expect(mockMessage.channel.send).not.toHaveBeenCalled();
    expect(EmbedBuilder).not.toHaveBeenCalled();
    
    // Verify logger warning was issued
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Already generated first embed for')
    );
    
    // Verify the command was still marked as completed
    expect(messageTracker.markAddCommandCompleted).toHaveBeenCalled();
  });
  
  it('should add DM-specific footer in DM channels', async () => {
    // Create a DM-based mock message
    const dmMockMessage = helpers.createMockMessage({ isDM: true });
    dmMockMessage.channel.send = jest.fn().mockResolvedValue({
      id: 'dm-message-123',
      embeds: [{ title: 'Personality Added' }]
    });
    dmMockMessage.channel.sendTyping = jest.fn().mockResolvedValue(undefined);
    
    await addCommand.execute(dmMockMessage, ['test-personality']);
    
    // Verify DM-specific footer was added
    expect(mockEmbed.setFooter).toHaveBeenCalledWith({
      text: expect.stringContaining('available in your DMs and all servers')
    });
  });
  
  it('should handle sendTyping errors gracefully', async () => {
    // Force an error in sendTyping
    mockMessage.channel.sendTyping = jest.fn().mockRejectedValue(
      new Error('Cannot send typing in this channel')
    );
    
    await addCommand.execute(mockMessage, ['test-personality']);
    
    // Verify that despite the typing error, the command still completed successfully
    expect(personalityManager.registerPersonality).toHaveBeenCalled();
    expect(mockMessage.channel.send).toHaveBeenCalledWith({ embeds: [mockEmbed] });
    
    // Verify the error was logged but not fatal
    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringContaining('Error sending typing indicator:')
    );
  });
  
  it('should expose correct metadata', () => {
    expect(addCommand.meta).toBeDefined();
    expect(addCommand.meta.name).toBe('add');
    expect(addCommand.meta.aliases).toContain('create');
    expect(addCommand.meta.description).toBeTruthy();
  });
});