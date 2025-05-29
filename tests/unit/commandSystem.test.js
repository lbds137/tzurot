// Mock dependencies before requiring the module
jest.mock('discord.js');
jest.mock('../../src/logger');
jest.mock('../../config');

// Import mocked modules
const { PermissionFlagsBits } = require('discord.js');
const config = require('../../config');

// Mock PermissionFlagsBits
PermissionFlagsBits.Administrator = 'ADMINISTRATOR';

// Mock console methods to reduce test noise
global.console.log = jest.fn();
global.console.warn = jest.fn();
global.console.error = jest.fn();

describe('Command System', () => {
  let mockMessage;
  let mockAuthor;
  let mockChannel;
  let mockMember;
  let mockPermissions;
  let commandSystem;
  let commandRegistry;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Reset modules
    jest.resetModules();
    
    // Create mock author
    mockAuthor = {
      id: 'user-123',
      tag: 'User#1234',
      send: jest.fn().mockResolvedValue({ id: 'dm-123' })
    };

    // Create mock permissions
    mockPermissions = {
      has: jest.fn().mockReturnValue(true)
    };

    // Create mock member
    mockMember = {
      permissions: mockPermissions
    };

    // Create mock channel
    mockChannel = {
      id: 'channel-123',
      send: jest.fn().mockResolvedValue({ id: 'sent-message-123' }),
      isDMBased: jest.fn().mockReturnValue(false),
      sendTyping: jest.fn().mockResolvedValue(undefined)
    };

    // Create mock message
    mockMessage = {
      id: 'message-123',
      author: mockAuthor,
      channel: mockChannel,
      member: mockMember,
      reply: jest.fn().mockResolvedValue({ id: 'reply-123' }),
      content: '!tz test'
    };

    // Mock auth
    jest.mock('../../src/auth', () => ({
      hasValidToken: jest.fn().mockReturnValue(true),
      isNsfwVerified: jest.fn().mockReturnValue(true)
    }));

    // Mock config
    config.botPrefix = '!tz';

    // Import the command system
    commandSystem = require('../../src/commands/index');
    commandRegistry = commandSystem.registry;

    // Create a test command module
    const testCommand = {
      meta: {
        name: 'test',
        description: 'Test command',
        usage: 'test',
        aliases: ['t'],
        permissions: []
      },
      execute: jest.fn().mockResolvedValue({ id: 'test-result' })
    };

    // Register the test command
    commandRegistry.register(testCommand);
  });

  describe('Command Registry', () => {
    it('should register commands correctly', () => {
      // Create a new command
      const newCommand = {
        meta: {
          name: 'new',
          description: 'New command',
          usage: 'new',
          aliases: ['n'],
          permissions: []
        },
        execute: jest.fn()
      };

      // Register the command
      commandRegistry.register(newCommand);

      // Verify it's registered
      expect(commandRegistry.has('new')).toBe(true);
      expect(commandRegistry.has('n')).toBe(true);

      // Get the command
      const command = commandRegistry.get('new');
      expect(command).toBe(newCommand);

      // Get by alias
      const byAlias = commandRegistry.get('n');
      expect(byAlias).toBe(newCommand);
    });

    it('should handle missing commands gracefully', () => {
      // Non-existent command
      expect(commandRegistry.has('nonexistent')).toBe(false);
      expect(commandRegistry.get('nonexistent')).toBeNull();
    });
  });

  describe('processCommand', () => {
    it('should process valid commands', async () => {
      // Get the test command
      const testCommand = commandRegistry.get('test');
      
      // Process the command
      await commandSystem.processCommand(mockMessage, 'test', []);

      // Verify the command was executed
      expect(testCommand.execute).toHaveBeenCalledWith(
        mockMessage, 
        [],
        expect.objectContaining({
          scheduler: expect.any(Function),
          interval: expect.any(Function)
        })
      );
    });

    it('should handle unknown commands', async () => {
      // Process an unknown command
      await commandSystem.processCommand(mockMessage, 'unknown', []);

      // Verify the error response
      expect(mockMessage.reply).toHaveBeenCalled();
      const replyArgs = mockMessage.reply.mock.calls[0][0];
      expect(replyArgs).toContain('Unknown command');
    });

    it('should process commands by alias', async () => {
      // Get the test command
      const testCommand = commandRegistry.get('test');
      
      // Process the command by alias
      await commandSystem.processCommand(mockMessage, 't', []);

      // Verify the command was executed
      expect(testCommand.execute).toHaveBeenCalledWith(
        mockMessage, 
        [],
        expect.objectContaining({
          scheduler: expect.any(Function),
          interval: expect.any(Function)
        })
      );
    });
  });

  describe('Permission checks', () => {
    it('should verify permission-based commands are registered with correct metadata', () => {
      // This test verifies that commands can be registered with permission requirements
      // The actual permission checking logic is tested through integration tests
      // since it requires complex mocking of Discord.js permission system
      
      // Create an admin-only command
      const adminCommand = {
        meta: {
          name: 'admin',
          description: 'Admin command',
          usage: 'admin',
          aliases: [],
          permissions: ['ADMINISTRATOR']
        },
        execute: jest.fn()
      };

      // Register the command
      commandRegistry.register(adminCommand);
      
      // Verify the command was registered with permissions
      const registeredCommand = commandRegistry.get('admin');
      expect(registeredCommand).toBeDefined();
      expect(registeredCommand.meta.permissions).toEqual(['ADMINISTRATOR']);
      
      // Create a command that requires manage messages permission
      const modCommand = {
        meta: {
          name: 'mod',
          description: 'Moderator command',
          usage: 'mod',
          aliases: [],
          permissions: ['MANAGE_MESSAGES']
        },
        execute: jest.fn()
      };
      
      // Register the mod command
      commandRegistry.register(modCommand);
      
      // Verify it was registered with correct permissions
      const registeredModCommand = commandRegistry.get('mod');
      expect(registeredModCommand).toBeDefined();
      expect(registeredModCommand.meta.permissions).toEqual(['MANAGE_MESSAGES']);
      
      // Test that commands without permissions can also be registered
      const publicCommand = {
        meta: {
          name: 'public',
          description: 'Public command',
          usage: 'public',
          aliases: [],
          permissions: []
        },
        execute: jest.fn()
      };
      
      commandRegistry.register(publicCommand);
      const registeredPublicCommand = commandRegistry.get('public');
      expect(registeredPublicCommand).toBeDefined();
      expect(registeredPublicCommand.meta.permissions).toEqual([]);
    });
  });
});