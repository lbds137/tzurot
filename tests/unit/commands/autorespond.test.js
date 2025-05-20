/**
 * Tests for the autorespond command handler
 */

// Mock dependencies before requiring the module
jest.mock('discord.js');
jest.mock('../../../src/logger');
jest.mock('../../../config', () => ({
  botPrefix: '!tz'
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
const logger = require('../../../src/logger');
const validator = require('../../../src/commands/utils/commandValidator');

describe('Autorespond Command', () => {
  let autorespondCommand;
  let mockMessage;
  
  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Reset modules to get a fresh instance of the Map
    jest.resetModules();
    
    // Create mock message with standard channel.send mock
    mockMessage = helpers.createMockMessage();
    mockMessage.channel.send = jest.fn().mockResolvedValue({
      id: 'sent-message-123',
      content: 'Response message'
    });
    
    // Mock message.reply
    mockMessage.reply = jest.fn().mockResolvedValue({
      id: 'reply-message-123',
      content: 'Reply message'
    });
    
    // Import command module after mock setup
    autorespondCommand = require('../../../src/commands/handlers/autorespond');
  });
  
  it('should show current status when no subcommand is provided', async () => {
    const result = await autorespondCommand.execute(mockMessage, []);
    
    // Verify that createDirectSend was called with the message
    expect(validator.createDirectSend).toHaveBeenCalledWith(mockMessage);
    
    // Verify response contains status information
    expect(mockMessage.channel.send).toHaveBeenCalledWith(
      expect.stringContaining('Your auto-response setting is currently')
    );
    
    // By default, it should be OFF
    expect(mockMessage.channel.send).toHaveBeenCalledWith(
      expect.stringContaining('OFF')
    );
  });
  
  it('should enable auto-response with "on" subcommand', async () => {
    const result = await autorespondCommand.execute(mockMessage, ['on']);
    
    // Verify that the reply method was used
    expect(mockMessage.reply).toHaveBeenCalledWith(
      expect.stringContaining('Auto-response enabled')
    );
    
    // Verify that auto-response was enabled
    expect(autorespondCommand.isAutoResponseEnabled(mockMessage.author.id)).toBe(true);
  });
  
  it('should disable auto-response with "off" subcommand', async () => {
    // First enable it
    autorespondCommand.enableAutoResponse(mockMessage.author.id);
    
    // Then execute the off command
    const result = await autorespondCommand.execute(mockMessage, ['off']);
    
    // Verify that the reply method was used
    expect(mockMessage.reply).toHaveBeenCalledWith(
      expect.stringContaining('Auto-response disabled')
    );
    
    // Verify that auto-response was disabled
    expect(autorespondCommand.isAutoResponseEnabled(mockMessage.author.id)).toBe(false);
  });
  
  it('should show status with "status" subcommand', async () => {
    // Set a known status
    autorespondCommand.enableAutoResponse(mockMessage.author.id);
    
    const result = await autorespondCommand.execute(mockMessage, ['status']);
    
    // Verify response contains status information
    expect(mockMessage.channel.send).toHaveBeenCalledWith(
      expect.stringContaining('Your auto-response setting is currently')
    );
    
    // Should be ON as we enabled it
    expect(mockMessage.channel.send).toHaveBeenCalledWith(
      expect.stringContaining('ON')
    );
  });
  
  it('should show error for invalid subcommand', async () => {
    const result = await autorespondCommand.execute(mockMessage, ['invalid']);
    
    // Verify error message was sent
    expect(mockMessage.channel.send).toHaveBeenCalledWith(
      expect.stringContaining('Unknown subcommand: `invalid`')
    );
  });
  
  it('should expose helper functions', () => {
    // Test helper functions
    const userId = 'test-user-id';
    
    // Default state should be falsy
    expect(autorespondCommand.isAutoResponseEnabled(userId)).toBeFalsy();
    
    // Enable and check
    autorespondCommand.enableAutoResponse(userId);
    expect(autorespondCommand.isAutoResponseEnabled(userId)).toBe(true);
    
    // Disable and check
    autorespondCommand.disableAutoResponse(userId);
    expect(autorespondCommand.isAutoResponseEnabled(userId)).toBe(false);
  });
  
  it('should expose correct metadata', () => {
    expect(autorespondCommand.meta).toBeDefined();
    expect(autorespondCommand.meta.name).toBe('autorespond');
    expect(autorespondCommand.meta.aliases).toContain('auto');
    expect(autorespondCommand.meta.description).toBeTruthy();
  });
});