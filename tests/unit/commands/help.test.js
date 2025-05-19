// Mock dependencies before requiring the module
jest.mock('discord.js');
jest.mock('../../../src/logger');
jest.mock('../../../config');
jest.mock('../../../src/commands/utils/commandRegistry', () => ({
  get: jest.fn(),
  getAllCommands: jest.fn(),
  has: jest.fn()
}), { virtual: true });
jest.mock('../../../src/commands/utils/commandValidator');

// Import test helpers
const helpers = require('../../utils/commandTestHelpers');

// Import mocked modules
const { EmbedBuilder } = require('discord.js');
const logger = require('../../../src/logger');
const config = require('../../../config');
const commandRegistry = require('../../../src/commands/utils/commandRegistry');
const validator = require('../../../src/commands/utils/commandValidator');

describe('Help Command', () => {
  let helpCommand;
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
      toJSON: jest.fn().mockReturnValue({ title: 'Tzurot Commands' }),
    }));
    
    // Create mock message
    mockMessage = helpers.createMockMessage();
    
    // Mock direct send function
    mockDirectSend = jest.fn().mockResolvedValue({
      id: 'direct-sent-123'
    });
    
    // Mock validator
    validator.createDirectSend.mockReturnValue(mockDirectSend);
    validator.isAdmin.mockReturnValue(false);
    
    // Mock available commands for general help
    const mockCommands = new Map([
      ['add', { 
        meta: { 
          name: 'add', 
          description: 'Add a new personality', 
          usage: 'add <personality> [alias]', 
          aliases: ['create'], 
          permissions: [] 
        },
        execute: jest.fn()
      }],
      ['list', { 
        meta: { 
          name: 'list', 
          description: 'List your personalities', 
          usage: 'list [page]', 
          aliases: [], 
          permissions: [] 
        },
        execute: jest.fn()
      }],
      ['ping', { 
        meta: { 
          name: 'ping', 
          description: 'Check bot latency', 
          usage: 'ping', 
          aliases: ['pong'], 
          permissions: [] 
        },
        execute: jest.fn()
      }],
      ['debug', { 
        meta: { 
          name: 'debug', 
          description: 'Debug commands', 
          usage: 'debug <subcommand>', 
          aliases: [], 
          permissions: ['ADMINISTRATOR'] 
        },
        execute: jest.fn()
      }]
    ]);
    
    commandRegistry.getAllCommands.mockReturnValue(mockCommands);
    
    // Import the help command after setting up mocks
    helpCommand = require('../../../src/commands/handlers/help');
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
  
  describe('General Help Command', () => {
    it('should display help for regular users', async () => {
      await helpCommand.execute(mockMessage, []);
      
      expect(commandRegistry.getAllCommands).toHaveBeenCalled();
      
      helpers.verifySuccessResponse(mockDirectSend, {
        isEmbed: true,
        title: 'Tzurot Commands'
      });
    });
    
    it('should include admin commands for admin users', async () => {
      // Make the user an admin
      validator.isAdmin.mockReturnValueOnce(true);
      
      await helpCommand.execute(mockMessage, []);
      
      // Check that admin status was checked
      expect(validator.isAdmin).toHaveBeenCalledWith(mockMessage);
      
      helpers.verifySuccessResponse(mockDirectSend, {
        isEmbed: true,
        title: 'Tzurot Commands'
      });
    });
    
    it('should handle errors gracefully', async () => {
      // Force an error by making getAllCommands throw
      commandRegistry.getAllCommands.mockImplementationOnce(() => {
        throw new Error('Test error');
      });
      
      await helpCommand.execute(mockMessage, []);
      
      // Verify error was logged
      expect(logger.error).toHaveBeenCalled();
      
      helpers.verifyErrorResponse(mockDirectSend, { 
        contains: 'error occurred'
      });
    });
  });
  
  describe('Command-Specific Help', () => {
    it('should display help for a specific command', async () => {
      // Mock a command to get help for
      commandRegistry.get.mockReturnValueOnce({
        meta: {
          name: 'ping',
          description: 'Check bot latency',
          usage: 'ping',
          aliases: ['pong'],
          permissions: []
        },
        execute: jest.fn()
      });
      
      await helpCommand.execute(mockMessage, ['ping']);
      
      // Check that we looked up the right command
      expect(commandRegistry.get).toHaveBeenCalledWith('ping');
      
      helpers.verifyErrorResponse(mockDirectSend, { 
        contains: 'Check bot latency' 
      });
    });
    
    it('should show error for non-existent command', async () => {
      // Mock a non-existent command
      commandRegistry.get.mockReturnValueOnce(null);
      
      await helpCommand.execute(mockMessage, ['nonexistent']);
      
      // Check that we looked up the command
      expect(commandRegistry.get).toHaveBeenCalledWith('nonexistent');
      
      helpers.verifyErrorResponse(mockDirectSend, { 
        contains: 'Unknown command' 
      });
    });
    
    it('should deny help for admin commands to regular users', async () => {
      // Mock an admin command
      commandRegistry.get.mockReturnValueOnce({
        meta: {
          name: 'debug',
          description: 'Debug commands',
          usage: 'debug <subcommand>',
          aliases: [],
          permissions: ['ADMINISTRATOR']
        },
        execute: jest.fn()
      });
      
      // Make sure user is not an admin
      validator.isAdmin.mockReturnValueOnce(false);
      
      await helpCommand.execute(mockMessage, ['debug']);
      
      // Verify that we checked admin status
      expect(validator.isAdmin).toHaveBeenCalled();
      
      helpers.verifyErrorResponse(mockDirectSend, { 
        contains: 'only available to administrators' 
      });
    });
    
    it('should allow help for admin commands to admin users', async () => {
      // Mock an admin command
      commandRegistry.get.mockReturnValueOnce({
        meta: {
          name: 'debug',
          description: 'Debug commands',
          usage: 'debug <subcommand>',
          aliases: [],
          permissions: ['ADMINISTRATOR']
        },
        execute: jest.fn()
      });
      
      // Make user an admin
      validator.isAdmin.mockReturnValueOnce(true);
      
      await helpCommand.execute(mockMessage, ['debug']);
      
      helpers.verifyErrorResponse(mockDirectSend, { 
        contains: 'Debug commands' 
      });
    });
  });
  
  describe('Special Command Help', () => {
    it('should display special help for the auth command', async () => {
      // Mock the auth command
      commandRegistry.get.mockReturnValueOnce({
        meta: {
          name: 'auth',
          description: 'Authenticate with the service',
          usage: 'auth <subcommand>',
          aliases: [],
          permissions: []
        },
        execute: jest.fn()
      });
      
      await helpCommand.execute(mockMessage, ['auth']);
      
      helpers.verifyErrorResponse(mockDirectSend, { 
        contains: 'authorization' 
      });
    });
    
    it('should display special help for the add command', async () => {
      // Mock the add command
      commandRegistry.get.mockReturnValueOnce({
        meta: {
          name: 'add',
          description: 'Add a personality',
          usage: 'add <profile_name> [alias]',
          aliases: ['create'],
          permissions: []
        },
        execute: jest.fn()
      });
      
      await helpCommand.execute(mockMessage, ['add']);
      
      helpers.verifyErrorResponse(mockDirectSend, { 
        contains: 'profile_name' 
      });
    });
    
    it('should display special help for the list command', async () => {
      // Mock the list command
      commandRegistry.get.mockReturnValueOnce({
        meta: {
          name: 'list',
          description: 'List your personalities',
          usage: 'list [page]',
          aliases: [],
          permissions: []
        },
        execute: jest.fn()
      });
      
      await helpCommand.execute(mockMessage, ['list']);
      
      helpers.verifyErrorResponse(mockDirectSend, { 
        contains: 'pagination' 
      });
    });
    
    it('should display special help for the debug command', async () => {
      // Mock the debug command and make user an admin
      commandRegistry.get.mockReturnValueOnce({
        meta: {
          name: 'debug',
          description: 'Debug commands',
          usage: 'debug <subcommand>',
          aliases: [],
          permissions: ['ADMINISTRATOR']
        },
        execute: jest.fn()
      });
      validator.isAdmin.mockReturnValueOnce(true);
      
      await helpCommand.execute(mockMessage, ['debug']);
      
      helpers.verifyErrorResponse(mockDirectSend, { 
        contains: 'subcommands' 
      });
    });
  });
});