// Mock dependencies before requiring the module
jest.mock('discord.js');
jest.mock('../../../../src/logger');
jest.mock('../../../../config', () => ({
  botPrefix: '!tz'
}));

// Mock utils and commandValidator
jest.mock('../../../../src/utils', () => ({
  createDirectSend: jest.fn().mockImplementation((message) => {
    return async (content) => {
      return message.channel.send(content);
    };
  })
}));

jest.mock('../../../../src/commands/utils/commandValidator', () => {
  return {
    createDirectSend: jest.fn().mockImplementation((message) => {
      return async (content) => {
        return message.channel.send(content);
      };
    })
  };
});

// Import test helpers
const helpers = require('../../../utils/commandTestHelpers');

// Import mocked modules
const logger = require('../../../../src/logger');
const validator = require('../../../../src/commands/utils/commandValidator');

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
    pingCommand = require('../../../../src/commands/handlers/ping');
  });
  
  it('should have the correct metadata', () => {
    expect(pingCommand.meta).toEqual({
      name: 'ping',
      description: expect.any(String),
      usage: expect.any(String),
      aliases: expect.any(Array),
      permissions: expect.any(Array)
    });
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
  
  it('should handle errors gracefully', async () => {
    // Mock an error being thrown
    const error = new Error('Test error');
    mockMessage.channel.send.mockRejectedValueOnce(error);
    
    // Test that the error is properly logged and rethrown
    await expect(pingCommand.execute(mockMessage, [])).rejects.toThrow('Test error');
    expect(logger.error).toHaveBeenCalled();
  });
});