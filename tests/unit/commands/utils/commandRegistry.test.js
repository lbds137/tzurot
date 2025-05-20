/**
 * Tests for the CommandRegistry utility
 */

// Mock dependencies
jest.mock('../../../../src/logger');

// Import mocked modules
const logger = require('../../../../src/logger');

describe('CommandRegistry', () => {
  let CommandRegistry;
  let registry;
  
  beforeEach(() => {
    // Reset modules to get a fresh registry instance
    jest.resetModules();
    jest.clearAllMocks();
    
    // Import registry after mocks are set up
    CommandRegistry = require('../../../../src/commands/utils/commandRegistry');
    registry = CommandRegistry;
  });
  
  it('should initialize with empty command and alias maps', () => {
    expect(registry.commands).toBeInstanceOf(Map);
    expect(registry.commands.size).toBe(0);
    expect(registry.aliases).toBeInstanceOf(Map);
    expect(registry.aliases.size).toBe(0);
  });
  
  it('should register a command with its metadata', () => {
    // Create a mock command module
    const mockCommand = {
      meta: {
        name: 'test',
        description: 'Test command',
        aliases: ['t', 'testing']
      },
      execute: jest.fn()
    };
    
    // Register the command
    registry.register(mockCommand);
    
    // Verify command was registered
    expect(registry.commands.has('test')).toBe(true);
    expect(registry.commands.get('test')).toBe(mockCommand);
    
    // Verify aliases were registered
    expect(registry.aliases.has('t')).toBe(true);
    expect(registry.aliases.get('t')).toBe('test');
    expect(registry.aliases.has('testing')).toBe(true);
    expect(registry.aliases.get('testing')).toBe('test');
    
    // Verify logging
    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringContaining('Registered command: test')
    );
    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringContaining('Registered alias: t -> test')
    );
    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringContaining('Registered alias: testing -> test')
    );
  });
  
  it('should handle commands without aliases', () => {
    // Create a command with no aliases
    const mockCommand = {
      meta: {
        name: 'noalias',
        description: 'Command with no aliases'
      },
      execute: jest.fn()
    };
    
    // Register the command
    registry.register(mockCommand);
    
    // Verify command was registered
    expect(registry.commands.has('noalias')).toBe(true);
    expect(registry.commands.get('noalias')).toBe(mockCommand);
    
    // Verify no aliases were registered
    expect(registry.aliases.size).toBe(0);
  });
  
  it('should throw an error for invalid command modules', () => {
    // Missing meta
    const missingMeta = {
      execute: jest.fn()
    };
    
    // Missing execute
    const missingExecute = {
      meta: {
        name: 'test'
      }
    };
    
    // Missing name
    const missingName = {
      meta: {},
      execute: jest.fn()
    };
    
    // Verify errors are thrown
    expect(() => registry.register(missingMeta)).toThrow('must have meta and execute');
    expect(() => registry.register(missingExecute)).toThrow('must have meta and execute');
    expect(() => registry.register(missingName)).toThrow('must have a name');
  });
  
  it('should get a command by name', () => {
    // Create and register a command
    const mockCommand = {
      meta: {
        name: 'test',
        description: 'Test command'
      },
      execute: jest.fn()
    };
    
    registry.register(mockCommand);
    
    // Get the command by name
    const retrieved = registry.get('test');
    
    // Verify the command was retrieved
    expect(retrieved).toBe(mockCommand);
  });
  
  it('should get a command by alias', () => {
    // Create and register a command with aliases
    const mockCommand = {
      meta: {
        name: 'test',
        description: 'Test command',
        aliases: ['t', 'testing']
      },
      execute: jest.fn()
    };
    
    registry.register(mockCommand);
    
    // Get the command by aliases
    const retrieved1 = registry.get('t');
    const retrieved2 = registry.get('testing');
    
    // Verify the command was retrieved
    expect(retrieved1).toBe(mockCommand);
    expect(retrieved2).toBe(mockCommand);
  });
  
  it('should return null for non-existent commands', () => {
    // Get a command that doesn't exist
    const retrieved = registry.get('nonexistent');
    
    // Verify null was returned
    expect(retrieved).toBeNull();
  });
  
  it('should check if a command exists by name', () => {
    // Create and register a command
    const mockCommand = {
      meta: {
        name: 'test',
        description: 'Test command'
      },
      execute: jest.fn()
    };
    
    registry.register(mockCommand);
    
    // Check if the command exists
    const exists = registry.has('test');
    const nonExists = registry.has('nonexistent');
    
    // Verify results
    expect(exists).toBe(true);
    expect(nonExists).toBe(false);
  });
  
  it('should check if a command exists by alias', () => {
    // Create and register a command with aliases
    const mockCommand = {
      meta: {
        name: 'test',
        description: 'Test command',
        aliases: ['t', 'testing']
      },
      execute: jest.fn()
    };
    
    registry.register(mockCommand);
    
    // Check if the command exists by aliases
    const exists1 = registry.has('t');
    const exists2 = registry.has('testing');
    
    // Verify results
    expect(exists1).toBe(true);
    expect(exists2).toBe(true);
  });
  
  it('should get all registered commands', () => {
    // Create and register multiple commands
    const command1 = {
      meta: {
        name: 'test1',
        description: 'Test command 1'
      },
      execute: jest.fn()
    };
    
    const command2 = {
      meta: {
        name: 'test2',
        description: 'Test command 2'
      },
      execute: jest.fn()
    };
    
    registry.register(command1);
    registry.register(command2);
    
    // Get all commands
    const allCommands = registry.getAllCommands();
    
    // Verify all commands were retrieved
    expect(allCommands).toBeInstanceOf(Map);
    expect(allCommands.size).toBe(2);
    expect(allCommands.get('test1')).toBe(command1);
    expect(allCommands.get('test2')).toBe(command2);
  });
  
  it('should get filtered commands', () => {
    // Create and register commands with different properties
    const adminCommand = {
      meta: {
        name: 'admin',
        description: 'Admin command',
        permissions: ['ADMINISTRATOR']
      },
      execute: jest.fn()
    };
    
    const userCommand = {
      meta: {
        name: 'user',
        description: 'User command',
        permissions: []
      },
      execute: jest.fn()
    };
    
    const modCommand = {
      meta: {
        name: 'mod',
        description: 'Mod command',
        permissions: ['MANAGE_MESSAGES']
      },
      execute: jest.fn()
    };
    
    registry.register(adminCommand);
    registry.register(userCommand);
    registry.register(modCommand);
    
    // Filter for admin commands
    const adminCommands = registry.getFilteredCommands(
      meta => meta.permissions && meta.permissions.includes('ADMINISTRATOR')
    );
    
    // Filter for user commands (no permissions)
    const userCommands = registry.getFilteredCommands(
      meta => !meta.permissions || meta.permissions.length === 0
    );
    
    // Verify filtered results
    expect(adminCommands).toHaveLength(1);
    expect(adminCommands[0]).toBe(adminCommand);
    
    expect(userCommands).toHaveLength(1);
    expect(userCommands[0]).toBe(userCommand);
  });
});