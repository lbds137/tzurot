/**
 * Tests for the commandLoader utility
 */

// Mock dependencies
jest.mock('fs');
jest.mock('path');
jest.mock('../../../../src/logger');
jest.mock('../../../../src/commands/utils/commandRegistry');

// Import mocked modules
const fs = require('fs');
const path = require('path');
const logger = require('../../../../src/logger');
const commandRegistry = require('../../../../src/commands/utils/commandRegistry');

describe('Command Loader', () => {
  let commandLoader;
  
  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Setup path.join mock
    path.join.mockImplementation((...paths) => paths.join('/'));
    
    // Reset require cache mock
    jest.mock('require-cache-mock', () => ({}), { virtual: true });
    require.cache = {};
    
    // Import module after mock setup
    commandLoader = require('../../../../src/commands/utils/commandLoader');
  });
  
  it('should load all valid command modules', () => {
    // Mock file system operations
    fs.readdirSync.mockReturnValue([
      'ping.js',
      'help.js',
      'status.js'
    ]);
    
    // Mock command modules
    const pingCommand = {
      meta: { name: 'ping' },
      execute: jest.fn()
    };
    
    const helpCommand = {
      meta: { name: 'help' },
      execute: jest.fn()
    };
    
    const statusCommand = {
      meta: { name: 'status' },
      execute: jest.fn()
    };
    
    // Mock require for each module
    jest.mock('/__dirname/../handlers/ping.js', () => pingCommand, { virtual: true });
    jest.mock('/__dirname/../handlers/help.js', () => helpCommand, { virtual: true });
    jest.mock('/__dirname/../handlers/status.js', () => statusCommand, { virtual: true });
    
    // Mock require function
    const originalRequire = require;
    global.require = jest.fn((module) => {
      if (module === '/__dirname/../handlers/ping.js') return pingCommand;
      if (module === '/__dirname/../handlers/help.js') return helpCommand;
      if (module === '/__dirname/../handlers/status.js') return statusCommand;
      return originalRequire(module);
    });
    
    // Load commands
    const results = commandLoader.loadCommands();
    
    // Restore require
    global.require = originalRequire;
    
    // Verify file system was accessed
    expect(fs.readdirSync).toHaveBeenCalledWith('/__dirname/../handlers');
    
    // Verify commands were registered
    expect(commandRegistry.register).toHaveBeenCalledTimes(3);
    expect(commandRegistry.register).toHaveBeenCalledWith(pingCommand);
    expect(commandRegistry.register).toHaveBeenCalledWith(helpCommand);
    expect(commandRegistry.register).toHaveBeenCalledWith(statusCommand);
    
    // Verify results
    expect(results.count).toBe(3);
    expect(results.loaded).toHaveLength(3);
    expect(results.loaded).toEqual([
      { name: 'ping', file: 'ping.js' },
      { name: 'help', file: 'help.js' },
      { name: 'status', file: 'status.js' }
    ]);
    expect(results.failed).toHaveLength(0);
    
    // Verify logging
    expect(logger.debug).toHaveBeenCalledTimes(3);
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Loaded 3 command modules successfully')
    );
  });
  
  it('should handle invalid command modules', () => {
    // Mock file system operations
    fs.readdirSync.mockReturnValue([
      'valid.js',
      'invalid-no-meta.js',
      'invalid-no-execute.js',
      'error.js'
    ]);
    
    // Mock command modules
    const validCommand = {
      meta: { name: 'valid' },
      execute: jest.fn()
    };
    
    const invalidNoMeta = {
      // Missing meta
      execute: jest.fn()
    };
    
    const invalidNoExecute = {
      meta: { name: 'invalid' }
      // Missing execute
    };
    
    // Mock require function to throw for error.js
    const loadError = new Error('Failed to load module');
    
    // Mock require for each module
    jest.mock('/__dirname/../handlers/valid.js', () => validCommand, { virtual: true });
    jest.mock('/__dirname/../handlers/invalid-no-meta.js', () => invalidNoMeta, { virtual: true });
    jest.mock('/__dirname/../handlers/invalid-no-execute.js', () => invalidNoExecute, { virtual: true });
    
    // Mock require function
    const originalRequire = require;
    global.require = jest.fn((module) => {
      if (module === '/__dirname/../handlers/valid.js') return validCommand;
      if (module === '/__dirname/../handlers/invalid-no-meta.js') return invalidNoMeta;
      if (module === '/__dirname/../handlers/invalid-no-execute.js') return invalidNoExecute;
      if (module === '/__dirname/../handlers/error.js') throw loadError;
      return originalRequire(module);
    });
    
    // Load commands
    const results = commandLoader.loadCommands();
    
    // Restore require
    global.require = originalRequire;
    
    // Verify command registry interactions
    expect(commandRegistry.register).toHaveBeenCalledTimes(1);
    expect(commandRegistry.register).toHaveBeenCalledWith(validCommand);
    
    // Verify results
    expect(results.count).toBe(1);
    expect(results.loaded).toHaveLength(1);
    expect(results.loaded).toEqual([
      { name: 'valid', file: 'valid.js' }
    ]);
    
    // Verify failed commands
    expect(results.failed).toHaveLength(3);
    expect(results.failed).toContainEqual({
      file: 'invalid-no-meta.js',
      reason: 'Not a valid command module (missing meta or execute)'
    });
    expect(results.failed).toContainEqual({
      file: 'invalid-no-execute.js',
      reason: 'Not a valid command module (missing meta or execute)'
    });
    expect(results.failed).toContainEqual({
      file: 'error.js',
      reason: 'Failed to load module'
    });
    
    // Verify logging
    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('is not a valid command module')
    );
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Error loading command module from file error.js:'),
      loadError
    );
  });
  
  it('should handle cache clearing', () => {
    // Mock file system operations
    fs.readdirSync.mockReturnValue(['ping.js']);
    
    // Mock command module
    const pingCommand = {
      meta: { name: 'ping' },
      execute: jest.fn()
    };
    
    // Setup require cache with an existing entry
    const filePath = '/__dirname/../handlers/ping.js';
    require.cache[filePath] = 'cached-module';
    
    // Mock require function
    const originalRequire = require;
    global.require = jest.fn((module) => {
      if (module === filePath) return pingCommand;
      return originalRequire(module);
    });
    
    // Load commands
    commandLoader.loadCommands();
    
    // Restore require
    global.require = originalRequire;
    
    // Verify cache was cleared
    expect(require.cache[filePath]).toBeUndefined();
  });
  
  it('should handle file system errors', () => {
    // Mock file system error
    const fsError = new Error('Failed to read directory');
    fs.readdirSync.mockImplementation(() => {
      throw fsError;
    });
    
    // Load commands
    const results = commandLoader.loadCommands();
    
    // Verify logging
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Error loading command modules:'),
      fsError
    );
    
    // Verify empty results
    expect(results.count).toBe(0);
    expect(results.loaded).toHaveLength(0);
    expect(results.failed).toHaveLength(0);
  });
});