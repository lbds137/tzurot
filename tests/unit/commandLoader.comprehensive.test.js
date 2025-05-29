/**
 * Comprehensive tests for commandLoader module
 */

// Mock dependencies
jest.mock('../../src/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../../src/commands/index', () => ({
  processCommand: jest.fn(),
}));

const { botPrefix } = require('../../config');

describe('CommandLoader Comprehensive Tests', () => {
  let commandLoader;
  let logger;
  let newCommandSystem;
  let mockMessage;
  
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    
    // Import fresh instances
    commandLoader = require('../../src/commandLoader');
    logger = require('../../src/logger');
    newCommandSystem = require('../../src/commands/index');
    
    // Setup mock message
    mockMessage = {
      author: {
        id: 'test-user-id',
        tag: 'TestUser#1234',
      },
      channel: {
        id: 'test-channel-id',
        send: jest.fn().mockResolvedValue({ id: 'error-message-id' }),
      },
      content: `${botPrefix} test command args`,
    };
  });
  
  describe('processCommand', () => {
    it('should process a valid command successfully', async () => {
      const mockResult = { 
        success: true, 
        message: 'Command executed successfully',
        id: 'result-id' 
      };
      newCommandSystem.processCommand.mockResolvedValueOnce(mockResult);
      
      const result = await commandLoader.processCommand(
        mockMessage,
        'test',
        ['arg1', 'arg2']
      );
      
      expect(logger.info).toHaveBeenCalledWith(
        '[CommandLoader] Processing command: test with args: arg1 arg2 from user: TestUser#1234'
      );
      expect(newCommandSystem.processCommand).toHaveBeenCalledWith(
        mockMessage,
        'test',
        ['arg1', 'arg2']
      );
      expect(result).toBe(mockResult);
    });
    
    it('should handle command with no arguments', async () => {
      const mockResult = { success: true };
      newCommandSystem.processCommand.mockResolvedValueOnce(mockResult);
      
      const result = await commandLoader.processCommand(
        mockMessage,
        'ping',
        []
      );
      
      expect(logger.info).toHaveBeenCalledWith(
        '[CommandLoader] Processing command: ping with args:  from user: TestUser#1234'
      );
      expect(newCommandSystem.processCommand).toHaveBeenCalledWith(
        mockMessage,
        'ping',
        []
      );
      expect(result).toBe(mockResult);
    });
    
    it('should log when command is not found', async () => {
      newCommandSystem.processCommand.mockResolvedValueOnce(null);
      
      const result = await commandLoader.processCommand(
        mockMessage,
        'nonexistent',
        []
      );
      
      expect(logger.info).toHaveBeenCalledWith(
        '[CommandLoader] Command not found or failed to execute: nonexistent'
      );
      expect(result).toBeNull();
    });
    
    it('should handle command system returning undefined', async () => {
      newCommandSystem.processCommand.mockResolvedValueOnce(undefined);
      
      const result = await commandLoader.processCommand(
        mockMessage,
        'undefined-command',
        []
      );
      
      expect(logger.info).toHaveBeenCalledWith(
        '[CommandLoader] Command not found or failed to execute: undefined-command'
      );
      expect(result).toBeUndefined();
    });
    
    it('should handle errors and send error message', async () => {
      const testError = new Error('Test command error');
      newCommandSystem.processCommand.mockRejectedValueOnce(testError);
      
      const result = await commandLoader.processCommand(
        mockMessage,
        'error-command',
        ['arg']
      );
      
      expect(logger.error).toHaveBeenCalledWith(
        '[CommandLoader] Error processing command error-command:',
        testError
      );
      expect(mockMessage.channel.send).toHaveBeenCalledWith(
        'An error occurred while processing the command. Please try again.'
      );
      expect(result).toEqual({ id: 'error-message-id' });
    });
    
    it('should handle errors when error message fails to send', async () => {
      const commandError = new Error('Command failed');
      const sendError = new Error('Send failed');
      
      newCommandSystem.processCommand.mockRejectedValueOnce(commandError);
      mockMessage.channel.send.mockRejectedValueOnce(sendError);
      
      await expect(commandLoader.processCommand(
        mockMessage,
        'double-error',
        []
      )).rejects.toThrow(sendError);
      
      expect(logger.error).toHaveBeenCalledWith(
        '[CommandLoader] Error processing command double-error:',
        commandError
      );
    });
    
    it('should handle commands with many arguments', async () => {
      const manyArgs = ['arg1', 'arg2', 'arg3', 'arg4', 'arg5'];
      const mockResult = { success: true };
      newCommandSystem.processCommand.mockResolvedValueOnce(mockResult);
      
      await commandLoader.processCommand(
        mockMessage,
        'multi-arg',
        manyArgs
      );
      
      expect(logger.info).toHaveBeenCalledWith(
        '[CommandLoader] Processing command: multi-arg with args: arg1 arg2 arg3 arg4 arg5 from user: TestUser#1234'
      );
      expect(newCommandSystem.processCommand).toHaveBeenCalledWith(
        mockMessage,
        'multi-arg',
        manyArgs
      );
    });
    
    it('should handle special characters in arguments', async () => {
      const specialArgs = ['test@email.com', 'hello world!', '$pecial'];
      const mockResult = { success: true };
      newCommandSystem.processCommand.mockResolvedValueOnce(mockResult);
      
      await commandLoader.processCommand(
        mockMessage,
        'special',
        specialArgs
      );
      
      expect(logger.info).toHaveBeenCalledWith(
        '[CommandLoader] Processing command: special with args: test@email.com hello world! $pecial from user: TestUser#1234'
      );
    });
    
    it('should handle empty command name', async () => {
      const mockResult = { success: true };
      newCommandSystem.processCommand.mockResolvedValueOnce(mockResult);
      
      await commandLoader.processCommand(
        mockMessage,
        '',
        ['arg']
      );
      
      expect(logger.info).toHaveBeenCalledWith(
        '[CommandLoader] Processing command:  with args: arg from user: TestUser#1234'
      );
      expect(newCommandSystem.processCommand).toHaveBeenCalledWith(
        mockMessage,
        '',
        ['arg']
      );
    });
    
    it('should handle null result from command system', async () => {
      newCommandSystem.processCommand.mockResolvedValueOnce(null);
      
      const result = await commandLoader.processCommand(
        mockMessage,
        'null-command',
        []
      );
      
      expect(logger.info).toHaveBeenCalledTimes(2);
      expect(logger.info).toHaveBeenNthCalledWith(2,
        '[CommandLoader] Command not found or failed to execute: null-command'
      );
      expect(result).toBeNull();
    });
    
    it('should handle command system throwing string error', async () => {
      newCommandSystem.processCommand.mockRejectedValueOnce('String error');
      
      const result = await commandLoader.processCommand(
        mockMessage,
        'string-error',
        []
      );
      
      expect(logger.error).toHaveBeenCalledWith(
        '[CommandLoader] Error processing command string-error:',
        'String error'
      );
      expect(mockMessage.channel.send).toHaveBeenCalled();
    });
    
    it('should preserve original message reference', async () => {
      const mockResult = { success: true };
      newCommandSystem.processCommand.mockResolvedValueOnce(mockResult);
      
      await commandLoader.processCommand(
        mockMessage,
        'test',
        []
      );
      
      // Verify the exact same message object was passed
      expect(newCommandSystem.processCommand.mock.calls[0][0]).toBe(mockMessage);
    });
  });
  
  describe('Module exports', () => {
    it('should only export processCommand function', () => {
      const exports = Object.keys(commandLoader);
      expect(exports).toEqual(['processCommand']);
    });
    
    it('should have processCommand as a function', () => {
      expect(typeof commandLoader.processCommand).toBe('function');
    });
    
    it('should be an async function', () => {
      const result = commandLoader.processCommand(mockMessage, 'test', []);
      expect(result).toBeInstanceOf(Promise);
    });
  });
});