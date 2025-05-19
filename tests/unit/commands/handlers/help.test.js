// Mock dependencies before requiring the module
jest.mock('discord.js');
jest.mock('../../../../src/logger');
jest.mock('../../../../config', () => ({
  botPrefix: '!tz'
}));
jest.mock('../../../../src/embedHelpers');

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

// Mock the command registry
jest.mock('../../../../src/commands/utils/commandRegistry', () => {
  const mockRegistry = new Map();
  mockRegistry.set('ping', {
    meta: {
      name: 'ping',
      description: 'Check if the bot is online',
      usage: 'ping',
      aliases: [],
      permissions: []
    }
  });
  return {
    get: jest.fn().mockImplementation(name => mockRegistry.get(name)),
    getAll: jest.fn().mockReturnValue(mockRegistry)
  };
});

// Import test helpers
const helpers = require('../../../utils/commandTestHelpers');

// Import mocked modules
const { EmbedBuilder } = require('discord.js');
const logger = require('../../../../src/logger');
const validator = require('../../../../src/commands/utils/commandValidator');
const commandRegistry = require('../../../../src/commands/utils/commandRegistry');

describe('Help Command', () => {
  let helpCommand;
  let mockMessage;
  
  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Mock EmbedBuilder
    EmbedBuilder.mockImplementation(() => ({
      setTitle: jest.fn().mockReturnThis(),
      setDescription: jest.fn().mockReturnThis(),
      setColor: jest.fn().mockReturnThis(),
      addFields: jest.fn().mockReturnThis(),
      setFooter: jest.fn().mockReturnThis(),
      toJSON: jest.fn().mockReturnValue({ title: 'Help' }),
    }));
    
    // Create mock message with standard channel.send mock
    mockMessage = helpers.createMockMessage();
    mockMessage.channel.send = jest.fn().mockResolvedValue({
      id: 'sent-message-123',
      embeds: [{title: 'Help'}]
    });
    
    // Import command module after mock setup
    helpCommand = require('../../../../src/commands/handlers/help');
  });
  
  it('should have the correct metadata', () => {
    expect(helpCommand.meta).toEqual({
      name: 'help',
      description: expect.any(String),
      usage: expect.any(String),
      aliases: expect.any(Array),
      permissions: expect.any(Array)
    });
  });
  
  it('should provide help for a specific command when provided', async () => {
    // Setup the commandRegistry mock to return our test command
    commandRegistry.get.mockReturnValueOnce({
      meta: {
        name: 'ping',
        description: 'Check if the bot is online',
        usage: 'ping',
        aliases: [],
        permissions: []
      }
    });
    
    await helpCommand.execute(mockMessage, ['ping']);
    
    // Verify that registry was queried for the right command
    expect(commandRegistry.get).toHaveBeenCalledWith('ping');
    
    // Verify that channel.send was called
    expect(mockMessage.channel.send).toHaveBeenCalled();
    expect(validator.createDirectSend).toHaveBeenCalledWith(mockMessage);
  });
  
  it('should handle unknown commands', async () => {
    // Setup the commandRegistry mock to return undefined for unknown command
    commandRegistry.get.mockReturnValueOnce(undefined);
    
    await helpCommand.execute(mockMessage, ['unknown-command']);
    
    // Verify error message was sent
    expect(mockMessage.channel.send).toHaveBeenCalledWith(
      expect.stringContaining('Unknown command')
    );
  });
});