/**
 * Tests for Middleware System
 *
 * Tests the middleware pipeline, individual middleware functions,
 * and integration with command validation.
 */

const {
  middlewareManager,
  createLoggingMiddleware,
  createPermissionMiddleware,
  createRateLimitMiddleware,
} = require('../../src/middleware');
const logger = require('../../src/logger');
const { botPrefix } = require('../../config');

// Mock dependencies
jest.mock('../../src/logger');
jest.mock('../../src/commandValidation', () => ({
  validationRules: {
    testCommand: {
      required: ['param1'],
      optional: ['param2'],
      types: {
        param1: 'string',
        param2: 'number',
      },
    },
    complexCommand: {
      required: ['requiredParam1', 'requiredParam2'],
      optional: ['optionalParam'],
    },
  },
  validateCommandMiddleware: jest.fn((command, args) => {
    if (command === 'failValidation') {
      return {
        success: false,
        errors: ['Validation failed'],
        message: 'Validation failed: test error',
      };
    }
    return {
      success: true,
      message: 'Validation successful',
      validatedArgs: args,
    };
  }),
}));

describe('Middleware System', () => {
  let mockMessage;
  let mockAuthor;

  beforeEach(() => {
    jest.clearAllMocks();

    mockAuthor = {
      id: '123456789',
      tag: 'testuser#1234',
    };

    mockMessage = {
      author: mockAuthor,
      content: `${botPrefix} test command`,
    };
  });

  describe('MiddlewareManager', () => {
    describe('use', () => {
      it('should add middleware function to pipeline', () => {
        const testMiddleware = jest.fn();
        const result = middlewareManager.use(testMiddleware);

        expect(result).toBe(middlewareManager); // Should return this for chaining
        expect(middlewareManager.middlewares).toContain(testMiddleware);
      });

      it('should throw error for non-function middleware', () => {
        expect(() => {
          middlewareManager.use('not a function');
        }).toThrow('Middleware must be a function');

        expect(() => {
          middlewareManager.use(123);
        }).toThrow('Middleware must be a function');

        expect(() => {
          middlewareManager.use({});
        }).toThrow('Middleware must be a function');
      });
    });

    describe('execute', () => {
      it('should execute middleware in sequence', async () => {
        const middleware1 = jest.fn(context => ({ ...context, step1: true }));
        const middleware2 = jest.fn(context => ({ ...context, step2: true }));

        // Create a new instance for this test to avoid state pollution
        // We need to access the MiddlewareManager class directly
        const MiddlewareManager = middlewareManager.constructor;
        const manager = new MiddlewareManager();
        // Clear the default validation middleware
        manager.middlewares = [];

        manager.use(middleware1);
        manager.use(middleware2);

        const context = { command: 'test', args: [] };
        const result = await manager.execute(context);

        expect(middleware1).toHaveBeenCalledWith(expect.objectContaining({ command: 'test' }));
        expect(middleware2).toHaveBeenCalledWith(expect.objectContaining({ step1: true }));
        expect(result).toMatchObject({ command: 'test', step1: true, step2: true });
      });

      it('should stop pipeline on early return', async () => {
        const middleware1 = jest.fn(() => ({ earlyReturn: true, message: 'Stopped' }));
        const middleware2 = jest.fn();

        const MiddlewareManager = middlewareManager.constructor;
        const manager = new MiddlewareManager();
        manager.middlewares = [];

        manager.use(middleware1);
        manager.use(middleware2);

        const context = { command: 'test' };
        const result = await manager.execute(context);

        expect(middleware1).toHaveBeenCalled();
        expect(middleware2).not.toHaveBeenCalled();
        expect(result).toMatchObject({ earlyReturn: true, message: 'Stopped' });
      });

      it('should stop pipeline when middleware returns false', async () => {
        const middleware1 = jest.fn(() => false);
        const middleware2 = jest.fn();

        const MiddlewareManager = middlewareManager.constructor;
        const manager = new MiddlewareManager();
        manager.middlewares = [];

        manager.use(middleware1);
        manager.use(middleware2);

        const context = { command: 'test' };
        const result = await manager.execute(context);

        expect(middleware1).toHaveBeenCalled();
        expect(middleware2).not.toHaveBeenCalled();
        expect(result.earlyReturn).toBe(true);
      });

      it('should handle middleware errors gracefully', async () => {
        const errorMiddleware = jest.fn(() => {
          throw new Error('Middleware error');
        });

        const MiddlewareManager = middlewareManager.constructor;
        const manager = new MiddlewareManager();
        manager.middlewares = [];

        manager.use(errorMiddleware);

        const context = { command: 'test' };
        const result = await manager.execute(context);

        expect(result).toMatchObject({
          earlyReturn: true,
          error: true,
          message: 'Middleware error: Middleware error',
        });
        expect(logger.error).toHaveBeenCalledWith(
          '[MiddlewareManager] Error in middleware execution:',
          expect.any(Error)
        );
      });

      it('should make a copy of context to avoid mutation', async () => {
        const originalContext = { command: 'test', args: ['arg1'] };
        const middleware = jest.fn(context => {
          context.modified = true;
          return context;
        });

        const MiddlewareManager = middlewareManager.constructor;
        const manager = new MiddlewareManager();
        manager.middlewares = [];

        manager.use(middleware);

        await manager.execute(originalContext);

        expect(originalContext.modified).toBeUndefined();
      });
    });

    describe('validationMiddleware', () => {
      it('should skip validation when not required', () => {
        const context = {
          requiresValidation: false,
          command: 'test',
          args: [],
        };

        const result = middlewareManager.validationMiddleware(context);

        expect(result).toBe(context);
      });

      it('should validate command with named parameters', () => {
        const context = {
          requiresValidation: true,
          command: 'testCommand',
          args: ['value1', 'value2'],
        };

        const result = middlewareManager.validationMiddleware(context);

        expect(result.validated).toBe(true);
        expect(result.namedArgs).toMatchObject({
          param1: 'value1',
          param2: 'value2',
          _raw: ['value1', 'value2'],
        });
      });

      it('should return early on validation failure', () => {
        const context = {
          requiresValidation: true,
          command: 'failValidation',
          args: [],
        };

        const result = middlewareManager.validationMiddleware(context);

        expect(result.earlyReturn).toBe(true);
        expect(result.error).toBe(true);
        expect(result.validationErrors).toContain('Validation failed');
        expect(result.message).toContain('Validation failed');
      });

      it('should handle commands without validation rules', () => {
        const context = {
          requiresValidation: true,
          command: 'unknownCommand',
          args: ['arg1', 'arg2'],
        };

        const result = middlewareManager.validationMiddleware(context);

        expect(result.validated).toBe(true);
        expect(result.namedArgs).toMatchObject({
          _raw: ['arg1', 'arg2'],
        });
      });
    });

    describe('convertArgsToNamedParams', () => {
      it('should convert array args to named params', () => {
        const result = middlewareManager.convertArgsToNamedParams('testCommand', [
          'value1',
          'value2',
        ]);

        expect(result).toMatchObject({
          param1: 'value1',
          param2: 'value2',
          _raw: ['value1', 'value2'],
        });
      });

      it('should handle missing optional parameters', () => {
        const result = middlewareManager.convertArgsToNamedParams('testCommand', ['value1']);

        expect(result).toMatchObject({
          param1: 'value1',
          _raw: ['value1'],
        });
        expect(result.param2).toBeUndefined();
      });

      it('should handle extra arguments', () => {
        const result = middlewareManager.convertArgsToNamedParams('testCommand', [
          'value1',
          'value2',
          'extra',
        ]);

        expect(result).toMatchObject({
          param1: 'value1',
          param2: 'value2',
          _raw: ['value1', 'value2', 'extra'],
        });
      });

      it('should handle complex commands with multiple required params', () => {
        const result = middlewareManager.convertArgsToNamedParams('complexCommand', [
          'req1',
          'req2',
          'opt1',
        ]);

        expect(result).toMatchObject({
          requiredParam1: 'req1',
          requiredParam2: 'req2',
          optionalParam: 'opt1',
          _raw: ['req1', 'req2', 'opt1'],
        });
      });

      it('should return raw args for unknown commands', () => {
        const result = middlewareManager.convertArgsToNamedParams('unknownCommand', [
          'arg1',
          'arg2',
        ]);

        expect(result).toMatchObject({
          _raw: ['arg1', 'arg2'],
        });
      });
    });
  });

  describe('createLoggingMiddleware', () => {
    it('should log command execution', async () => {
      const loggingMiddleware = createLoggingMiddleware();
      const context = {
        command: 'test',
        args: ['arg1', 'arg2'],
        message: mockMessage,
      };

      const result = await loggingMiddleware(context);

      expect(logger.info).toHaveBeenCalledWith(
        'Executing command: test with args: ["arg1","arg2"] from user: testuser#1234'
      );
      expect(result).toBe(context);
    });
  });

  describe('createPermissionMiddleware', () => {
    it('should allow command when permission check passes', async () => {
      const permissionCheck = jest.fn().mockResolvedValue(true);
      const permissionMiddleware = createPermissionMiddleware(permissionCheck);

      const context = {
        command: 'test',
        message: mockMessage,
      };

      const result = await permissionMiddleware(context);

      expect(permissionCheck).toHaveBeenCalledWith(mockMessage, 'test');
      expect(result).toBe(context);
    });

    it('should return early when permission check fails', async () => {
      const permissionCheck = jest.fn().mockResolvedValue(false);
      const permissionMiddleware = createPermissionMiddleware(permissionCheck);

      const context = {
        command: 'test',
        message: mockMessage,
      };

      const result = await permissionMiddleware(context);

      expect(result).toMatchObject({
        earlyReturn: true,
        error: true,
        message: 'You do not have permission to execute this command.',
      });
    });
  });

  describe('createRateLimitMiddleware', () => {
    beforeEach(() => {
      // Clear rate limit tracking between tests
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should allow requests within rate limit', async () => {
      const rateLimitMiddleware = createRateLimitMiddleware(3, 10000);
      const context = {
        command: 'test',
        message: mockMessage,
      };

      // First request should pass
      let result = await rateLimitMiddleware(context);
      expect(result).toBe(context);

      // Second request should pass
      result = await rateLimitMiddleware(context);
      expect(result).toBe(context);

      // Third request should pass
      result = await rateLimitMiddleware(context);
      expect(result).toBe(context);
    });

    it('should block requests exceeding rate limit', async () => {
      const rateLimitMiddleware = createRateLimitMiddleware(2, 10000);
      const context = {
        command: 'test',
        message: mockMessage,
      };

      // Make 2 requests (should pass)
      await rateLimitMiddleware(context);
      await rateLimitMiddleware(context);

      // Third request should be blocked
      const result = await rateLimitMiddleware(context);
      expect(result).toMatchObject({
        earlyReturn: true,
        error: true,
        message: 'Rate limit exceeded for command: test. Please try again later.',
      });
    });

    it('should reset rate limit after time window', async () => {
      const rateLimitMiddleware = createRateLimitMiddleware(1, 5000);
      const context = {
        command: 'test',
        message: mockMessage,
      };

      // First request should pass
      await rateLimitMiddleware(context);

      // Second request should be blocked
      let result = await rateLimitMiddleware(context);
      expect(result.earlyReturn).toBe(true);

      // Advance time past the window
      jest.advanceTimersByTime(6000);

      // Third request should pass after window reset
      result = await rateLimitMiddleware(context);
      expect(result).toBe(context);
    });

    it('should track rate limits per user and command', async () => {
      const rateLimitMiddleware = createRateLimitMiddleware(1, 10000);

      const context1 = {
        command: 'test1',
        message: mockMessage,
      };

      const context2 = {
        command: 'test2',
        message: mockMessage,
      };

      const otherUserMessage = {
        author: { id: '987654321', tag: 'otheruser#5678' },
      };

      const context3 = {
        command: 'test1',
        message: otherUserMessage,
      };

      // Same user, different commands - should both pass
      await rateLimitMiddleware(context1);
      const result1 = await rateLimitMiddleware(context2);
      expect(result1).toBe(context2);

      // Different user, same command - should pass
      const result2 = await rateLimitMiddleware(context3);
      expect(result2).toBe(context3);

      // Same user, same command - should be blocked
      const result3 = await rateLimitMiddleware(context1);
      expect(result3.earlyReturn).toBe(true);
    });

    it('should use default values when not specified', async () => {
      const rateLimitMiddleware = createRateLimitMiddleware();
      const context = {
        command: 'test',
        message: mockMessage,
      };

      // Should allow 5 requests by default
      for (let i = 0; i < 5; i++) {
        const result = await rateLimitMiddleware(context);
        expect(result).toBe(context);
      }

      // 6th request should be blocked
      const result = await rateLimitMiddleware(context);
      expect(result.earlyReturn).toBe(true);
    });
  });
});
