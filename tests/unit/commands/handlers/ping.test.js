// Mock dependencies before requiring the module
jest.mock('discord.js');
jest.mock('../../../../src/logger');

// Mock config before importing it
jest.mock('../../../../config', () => ({
  botPrefix: '!tz',
  botConfig: {
    name: 'Tzurot',
    prefix: '!tz',
    mentionChar: '@',
    isDevelopment: false
  }
}));

// Import config to get the actual bot prefix
const { botPrefix } = require('../../../../config');

jest.mock('../../../../src/commands/utils/commandValidator', () => {
  return {
    createDirectSend: jest.fn().mockImplementation((message) => {
      return async (content) => {
        return message.channel.send(content);
      };
    })
  };
});

// Use enhanced test utilities
const { createMigrationHelper } = require('../../../utils/testEnhancements');

// Import mocked modules
const logger = require('../../../../src/logger');
const validator = require('../../../../src/commands/utils/commandValidator');

// Get migration helper for enhanced patterns
const migrationHelper = createMigrationHelper('command');

describe('Ping Command', () => {
  let pingCommand;
  let mockMessage;
  
  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Create enhanced mock message with less boilerplate
    mockMessage = migrationHelper.enhanced.createMessage({
      content: `${botPrefix} ping`,
      author: { id: 'user-123', username: 'testuser' }
    });
    
    // Override default response for this test
    mockMessage.channel.send = jest.fn().mockResolvedValue({
      id: 'sent-message-123',
      content: 'Pong! Tzurot is operational.'
    });
    
    // Import command module after mock setup
    pingCommand = require('../../../../src/commands/handlers/ping');
  });
  
  it('should have the correct metadata', () => {
    // Use enhanced assertion helper
    migrationHelper.enhanced.assert.assertCommandMetadata(pingCommand, 'ping');
  });
  
  it('should reply with a pong message', async () => {
    const result = await pingCommand.execute(mockMessage, []);
    
    // Verify that createDirectSend was called with the message
    expect(validator.createDirectSend).toHaveBeenCalledWith(mockMessage);
    
    // Use enhanced assertion helper
    migrationHelper.enhanced.assert.assertMessageSent(mockMessage, 'Pong! Tzurot is operational.');
    
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