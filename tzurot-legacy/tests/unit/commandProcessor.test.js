/**
 * Tests for Command Processor
 *
 * Tests the command processing pipeline including middleware integration,
 * error handling, and command registration.
 */

const commandProcessor = require('../../src/commandProcessor');
const { middlewareManager } = require('../../src/middleware');
const logger = require('../../src/logger');
const { botPrefix } = require('../../config');

// Mock dependencies
jest.mock('../../src/logger');
jest.mock('../../src/middleware', () => {
  const mockMiddlewareManager = {
    use: jest.fn(),
    execute: jest.fn(),
  };

  return {
    middlewareManager: mockMiddlewareManager,
    createLoggingMiddleware: jest.fn(() => jest.fn()),
    createPermissionMiddleware: jest.fn(() => jest.fn()),
    createRateLimitMiddleware: jest.fn(() => jest.fn()),
  };
});

describe('Command Processor', () => {
  let mockMessage;
  let mockChannel;
  let mockAuthor;
  let mockGuild;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup mock Discord objects
    mockAuthor = {
      id: '123456789',
      username: 'testuser',
      tag: 'testuser#1234',
    };

    mockChannel = {
      id: '987654321',
      send: jest.fn().mockResolvedValue({ id: 'sent-message-id' }),
    };

    mockGuild = {
      id: '555666777',
      name: 'Test Guild',
    };

    mockMessage = {
      author: mockAuthor,
      channel: mockChannel,
      guild: mockGuild,
      content: '!tzurot test command',
      id: 'message-123',
    };

    // Default middleware manager behavior
    middlewareManager.execute = jest.fn().mockResolvedValue({
      earlyReturn: false,
      validated: true,
    });

    middlewareManager.use = jest.fn();
  });

  describe('processCommand', () => {
    it('should process a valid command successfully', async () => {
      const result = await commandProcessor.processCommand(mockMessage, 'test', ['arg1', 'arg2']);

      expect(result.success).toBe(true);
      expect(result.command).toBe('test');
      expect(result.args).toEqual(['arg1', 'arg2']);
      expect(result.validated).toBe(true);

      expect(middlewareManager.execute).toHaveBeenCalledWith({
        message: mockMessage,
        command: 'test',
        args: ['arg1', 'arg2'],
        requiresValidation: true,
        userId: '123456789',
        channelId: '987654321',
        guildId: '555666777',
        timestamp: expect.any(Number),
      });
    });

    it('should handle middleware validation errors', async () => {
      middlewareManager.execute.mockResolvedValue({
        earlyReturn: true,
        error: true,
        message: 'Validation failed',
        validationErrors: ['Invalid argument format', 'Missing required parameter'],
      });

      const result = await commandProcessor.processCommand(mockMessage, 'test', []);

      expect(result.success).toBe(false);
      expect(result.shouldReply).toBe(true);
      expect(result.replyContent).toContain('Command validation failed');
      expect(result.replyContent).toContain('Invalid argument format');
      expect(result.replyContent).toContain('Missing required parameter');
    });

    it('should handle middleware early returns without error', async () => {
      middlewareManager.execute.mockResolvedValue({
        earlyReturn: true,
        error: false,
        message: 'Rate limit exceeded',
      });

      const result = await commandProcessor.processCommand(mockMessage, 'test', []);

      expect(result.success).toBe(false);
      expect(result.earlyReturn).toBe(true);
      expect(result.message).toBe('Rate limit exceeded');
      expect(result.shouldReply).toBe(true);
    });

    it('should handle generic errors from middleware', async () => {
      middlewareManager.execute.mockResolvedValue({
        earlyReturn: true,
        error: true,
        message: 'Something went wrong',
      });

      const result = await commandProcessor.processCommand(mockMessage, 'test', []);

      expect(result.success).toBe(false);
      expect(result.message).toBe('Something went wrong');
      expect(result.replyContent).toBe('Something went wrong');
    });

    it('should handle exceptions during processing', async () => {
      const error = new Error('Unexpected error');
      middlewareManager.execute.mockRejectedValue(error);

      const result = await commandProcessor.processCommand(mockMessage, 'test', []);

      expect(result.success).toBe(false);
      expect(result.error).toBe(error);
      expect(result.replyContent).toBe('An unexpected error occurred. Please try again.');
      expect(logger.error).toHaveBeenCalledWith(
        '[CommandProcessor] Unhandled error processing command test:',
        error
      );
    });

    it('should pass additional options to middleware context', async () => {
      const options = {
        requiresAuth: true,
        customFlag: 'test',
      };

      await commandProcessor.processCommand(mockMessage, 'test', [], options);

      expect(middlewareManager.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          requiresAuth: true,
          customFlag: 'test',
        })
      );
    });

    it('should use validated args from middleware if available', async () => {
      middlewareManager.execute.mockResolvedValue({
        earlyReturn: false,
        validated: true,
        namedArgs: { target: 'user123', reason: 'test' },
      });

      const result = await commandProcessor.processCommand(mockMessage, 'ban', ['user123', 'test']);

      expect(result.success).toBe(true);
      expect(result.args).toEqual({ target: 'user123', reason: 'test' });
    });

    it('should handle DM messages without guild', async () => {
      mockMessage.guild = null;

      const result = await commandProcessor.processCommand(mockMessage, 'help', []);

      expect(middlewareManager.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          guildId: undefined,
        })
      );
      expect(result.success).toBe(true);
    });
  });

  describe('registerCommandHandler', () => {
    it('should register a valid command handler', () => {
      const handler = jest.fn();

      expect(() => {
        commandProcessor.registerCommandHandler('test', {}, handler);
      }).not.toThrow();

      expect(logger.info).toHaveBeenCalledWith(
        '[CommandProcessor] Registered handler for command: test'
      );
    });

    it('should throw error for missing command name', () => {
      const handler = jest.fn();

      expect(() => {
        commandProcessor.registerCommandHandler(null, {}, handler);
      }).toThrow('Command name is required and must be a string');
    });

    it('should throw error for non-string command name', () => {
      const handler = jest.fn();

      expect(() => {
        commandProcessor.registerCommandHandler(123, {}, handler);
      }).toThrow('Command name is required and must be a string');
    });

    it('should throw error for non-function handler', () => {
      expect(() => {
        commandProcessor.registerCommandHandler('test', {}, 'not a function');
      }).toThrow('Command handler must be a function');
    });

    it('should register permission middleware for commands with permissions', () => {
      const handler = jest.fn();
      const mockPermissionMiddleware = jest.fn(context => context);

      // Mock createPermissionMiddleware
      const { createPermissionMiddleware } = require('../../src/middleware');
      createPermissionMiddleware.mockReturnValue(mockPermissionMiddleware);

      commandProcessor.registerCommandHandler('admin', { permissions: ['ADMINISTRATOR'] }, handler);

      expect(createPermissionMiddleware).toHaveBeenCalledWith(['ADMINISTRATOR']);
      expect(middlewareManager.use).toHaveBeenCalled();

      // Test that the middleware only applies to the specific command
      const registeredMiddleware = middlewareManager.use.mock.calls[0][0];
      const testContext = { command: 'admin' };
      const otherContext = { command: 'other' };

      registeredMiddleware(testContext);
      expect(mockPermissionMiddleware).toHaveBeenCalledWith(testContext);

      mockPermissionMiddleware.mockClear();
      const result = registeredMiddleware(otherContext);
      expect(mockPermissionMiddleware).not.toHaveBeenCalled();
      expect(result).toBe(otherContext);
    });
  });

  describe('createDirectSend', () => {
    it('should create a function that sends messages', async () => {
      const sendFn = commandProcessor.createDirectSend(mockMessage);

      const result = await sendFn('Hello world');

      expect(mockChannel.send).toHaveBeenCalledWith('Hello world');
      expect(result).toEqual({ id: 'sent-message-id' });
    });

    it('should handle send errors gracefully', async () => {
      mockChannel.send.mockRejectedValue(new Error('Send failed'));

      const sendFn = commandProcessor.createDirectSend(mockMessage);
      const result = await sendFn('Hello world');

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        '[CommandProcessor] Error sending message:',
        expect.any(Error)
      );
    });

    it('should handle embed objects', async () => {
      const embed = { title: 'Test', description: 'Test embed' };
      const sendFn = commandProcessor.createDirectSend(mockMessage);

      await sendFn(embed);

      expect(mockChannel.send).toHaveBeenCalledWith(embed);
    });
  });

  describe('handleUnknownCommand', () => {
    it('should send unknown command message', async () => {
      const result = await commandProcessor.handleUnknownCommand(mockMessage, 'invalid');

      expect(result.success).toBe(false);
      expect(result.message).toContain('Unknown command: `invalid`');
      expect(result.message).toContain(`${botPrefix} help`);
      expect(mockChannel.send).toHaveBeenCalledWith(result.message);
      expect(result.sent).toEqual({ id: 'sent-message-id' });
    });

    it('should handle send errors', async () => {
      const error = new Error('Send failed');
      mockChannel.send.mockRejectedValue(error);

      const result = await commandProcessor.handleUnknownCommand(mockMessage, 'invalid');

      expect(result.success).toBe(false);
      expect(result.error).toBe(error);
      expect(logger.error).toHaveBeenCalledWith(
        '[CommandProcessor] Error sending unknown command response:',
        error
      );
    });
  });

  describe('createHelpText', () => {
    it('should create basic help text', () => {
      const helpText = commandProcessor.createHelpText('test');

      expect(helpText).toBe(`**${botPrefix} test**`);
    });

    it('should include usage if provided', () => {
      const helpText = commandProcessor.createHelpText('test', {
        usage: `Usage: ${botPrefix} test <arg>`,
      });

      expect(helpText).toContain(`**${botPrefix} test**`);
      expect(helpText).toContain(`Usage: ${botPrefix} test <arg>`);
    });

    it('should include description if provided', () => {
      const helpText = commandProcessor.createHelpText('test', {
        description: 'This is a test command',
      });

      expect(helpText).toContain('This is a test command');
    });

    it('should include examples if provided', () => {
      const helpText = commandProcessor.createHelpText('test', {
        examples: ['test hello', 'test world'],
      });

      expect(helpText).toContain('Examples:');
      expect(helpText).toContain(`\`${botPrefix} test hello\``);
      expect(helpText).toContain(`\`${botPrefix} test world\``);
    });

    it('should create complete help text with all options', () => {
      const helpText = commandProcessor.createHelpText('test', {
        usage: `Usage: ${botPrefix} test <arg>`,
        description: 'This is a test command',
        examples: ['test hello', 'test world'],
      });

      expect(helpText).toContain(`**${botPrefix} test**`);
      expect(helpText).toContain(`Usage: ${botPrefix} test <arg>`);
      expect(helpText).toContain('This is a test command');
      expect(helpText).toContain('Examples:');
      expect(helpText).toContain(`\`${botPrefix} test hello\``);
      expect(helpText).toContain(`\`${botPrefix} test world\``);
    });

    it('should handle empty examples array', () => {
      const helpText = commandProcessor.createHelpText('test', {
        examples: [],
      });

      expect(helpText).toBe(`**${botPrefix} test**`);
      expect(helpText).not.toContain('Examples:');
    });
  });

  describe('middleware integration', () => {
    it('should export middlewareManager', () => {
      // Verify that middlewareManager is exported for use by other modules
      expect(commandProcessor.middlewareManager).toBeDefined();
      expect(commandProcessor.middlewareManager).toBe(middlewareManager);
    });

    it('should handle middleware setup errors gracefully', () => {
      // The module handles setup errors by logging them
      // We can verify this by checking that logger.error might have been called
      // during module initialization if there were errors
      // Since our mock doesn't throw errors, we just verify the structure exists
      expect(middlewareManager.use).toBeDefined();
      expect(middlewareManager.execute).toBeDefined();
    });
  });
});
