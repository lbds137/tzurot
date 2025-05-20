/**
 * Tests for the ping command handler
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

describe('Ping Command', () => {
  let pingCommand;
  let mockMessage;
  
  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Create mock message with standard channel.send mock
    mockMessage = helpers.createMockMessage();
    mockMessage.channel.send = jest.fn().mockResolvedValue({
      id: 'sent-message-123',
      content: 'Pong! Tzurot is operational.'
    });
    
    // Import command module after mock setup
    pingCommand = require('../../../src/commands/handlers/ping');
  });
  
  it('should reply with a pong message', async () => {
    const result = await pingCommand.execute(mockMessage, []);
    
    // Verify that createDirectSend was called with the message
    expect(validator.createDirectSend).toHaveBeenCalledWith(mockMessage);
    
    // Verify that channel.send was called with the correct message
    expect(mockMessage.channel.send).toHaveBeenCalledWith('Pong! Tzurot is operational.');
    
    // Verify the response matches our mock
    expect(result).toEqual({
      id: 'sent-message-123',
      content: 'Pong! Tzurot is operational.'
    });
  });
  
  it('should handle errors properly', async () => {
    // Mock logger.error
    logger.error = jest.fn();
    
    // Force an error in channel.send
    const errorMessage = 'Test error in ping command';
    mockMessage.channel.send = jest.fn().mockRejectedValue(new Error(errorMessage));
    
    // Execute command and expect it to throw
    await expect(pingCommand.execute(mockMessage, [])).rejects.toThrow(errorMessage);
    
    // Verify that logger.error was called
    expect(logger.error).toHaveBeenCalled();
    expect(logger.error.mock.calls[0][0]).toContain('Error executing ping command:');
  });
  
  it('should expose correct metadata', () => {
    expect(pingCommand.meta).toBeDefined();
    expect(pingCommand.meta.name).toBe('ping');
    expect(pingCommand.meta.description).toBeTruthy();
  });
});