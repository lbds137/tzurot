const errorTracker = require('../../../src/utils/errorTracker');
const logger = require('../../../src/logger');

// Mock the logger
jest.mock('../../../src/logger', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
}));

describe('errorTracker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('trackError', () => {
    it('should track a basic error with default context', () => {
      const error = new Error('Test error');
      const errorId = errorTracker.trackError(error);

      expect(errorId).toMatch(/^ERR-unk-unk-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('[ErrorTracker] UNKNOWN: Test error'),
        expect.objectContaining({
          errorId,
          category: 'unknown',
          operation: 'unknown',
          metadata: {},
        })
      );
    });

    it('should track a critical error with custom context', () => {
      const error = new Error('Critical error');
      const context = {
        category: errorTracker.ErrorCategory.DISCORD_API,
        operation: 'sendMessage',
        metadata: { channelId: '123456' },
        isCritical: true,
      };

      const errorId = errorTracker.trackError(error, context);

      expect(errorId).toMatch(/^ERR-dis-sen-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('[ErrorTracker] CRITICAL DISCORD_API: Critical error'),
        expect.objectContaining({
          errorId,
          category: 'discord_api',
          operation: 'sendMessage',
          metadata: { channelId: '123456' },
        })
      );
    });

    it('should track frequent errors and increase log level', () => {
      const error = new Error('Frequent error');
      const context = {
        category: errorTracker.ErrorCategory.WEBHOOK,
        operation: 'send',
      };

      // Track the same error 6 times
      for (let i = 0; i < 6; i++) {
        errorTracker.trackError(error, context);
      }

      // Should have logged warning 6 times and error once (on the 6th occurrence)
      expect(logger.warn).toHaveBeenCalledTimes(6);
      expect(logger.error).toHaveBeenCalledTimes(1);
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Frequent error detected (6 occurrences)'),
        expect.any(Object)
      );
    });

    it('should cleanup old errors after cache lifetime', () => {
      const error1 = new Error('Old error');
      const error2 = new Error('Recent error');

      // Track first error
      errorTracker.trackError(error1);

      // Advance time by 25 minutes
      jest.advanceTimersByTime(25 * 60 * 1000);

      // Track second error
      errorTracker.trackError(error2);

      // Advance time by another 10 minutes (total 35 minutes)
      jest.advanceTimersByTime(10 * 60 * 1000);

      // Track a new error to trigger cleanup
      const error3 = new Error('New error');
      errorTracker.trackError(error3);

      // Now track the first error again - should be treated as new (not frequent)
      errorTracker.trackError(error1);

      // Should have 4 warnings total (no frequent error detection)
      expect(logger.warn).toHaveBeenCalledTimes(4);
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('should handle errors with all error categories', () => {
      const categories = Object.values(errorTracker.ErrorCategory);

      categories.forEach(category => {
        const error = new Error(`Error for ${category}`);
        const errorId = errorTracker.trackError(error, { category });

        expect(errorId).toMatch(/^ERR-[a-z_]{3}-unk-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
        expect(logger.warn).toHaveBeenCalledWith(
          expect.stringContaining(
            `[ErrorTracker] ${category.toUpperCase()}: Error for ${category}`
          ),
          expect.any(Object)
        );
      });
    });

    it('should cleanup multiple old errors when triggered', () => {
      // Track several errors
      const errors = [];
      for (let i = 0; i < 5; i++) {
        const error = new Error(`Error ${i}`);
        errors.push(error);
        errorTracker.trackError(error, {
          category: errorTracker.ErrorCategory.MESSAGE,
          operation: `operation${i}`,
        });
      }

      // Advance time past cache lifetime
      jest.advanceTimersByTime(31 * 60 * 1000); // 31 minutes

      // Track a new error to trigger cleanup
      const triggerError = new Error('Trigger cleanup');
      errorTracker.trackError(triggerError);

      // Track one of the old errors again
      errorTracker.trackError(errors[0], {
        category: errorTracker.ErrorCategory.MESSAGE,
        operation: 'operation0',
      });

      // Should have tracked 7 errors total (5 initial + 1 trigger + 1 re-track)
      // No frequent error detection should occur
      expect(logger.warn).toHaveBeenCalledTimes(7);
      expect(logger.error).not.toHaveBeenCalled();
    });
  });

  describe('createEnhancedWebhookClient', () => {
    it('should wrap webhook client methods with error tracking', async () => {
      const mockWebhookClient = {
        send: jest.fn().mockResolvedValue({ id: '123' }),
        edit: jest.fn().mockResolvedValue({ id: '456' }),
        nonMethodProperty: 'value',
      };

      const metadata = { channelId: '789' };
      const enhancedClient = errorTracker.createEnhancedWebhookClient(mockWebhookClient, metadata);

      // Non-method properties should be passed through
      expect(enhancedClient.nonMethodProperty).toBe('value');

      // Successful method call should work normally
      const result = await enhancedClient.send({ content: 'Test message' });
      expect(result).toEqual({ id: '123' });
      expect(mockWebhookClient.send).toHaveBeenCalledWith({ content: 'Test message' });
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('should track errors when webhook methods fail', async () => {
      const webhookError = new Error('Webhook send failed');
      const mockWebhookClient = {
        send: jest.fn().mockRejectedValue(webhookError),
      };

      const metadata = { webhookId: 'test-webhook' };
      const enhancedClient = errorTracker.createEnhancedWebhookClient(mockWebhookClient, metadata);

      await expect(enhancedClient.send({ content: 'Test message' })).rejects.toThrow(
        'Webhook send failed'
      );

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('[ErrorTracker] CRITICAL WEBHOOK: Webhook send failed'),
        expect.objectContaining({
          category: 'webhook',
          operation: 'send',
          metadata: expect.objectContaining({
            webhookId: 'test-webhook',
            args: [{ content: 'Test message' }],
          }),
        })
      );

      // Error should have errorId attached
      expect(webhookError.errorId).toMatch(/^ERR-web-sen-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    it('should truncate long message content in error metadata', async () => {
      const mockWebhookClient = {
        send: jest.fn().mockRejectedValue(new Error('Send failed')),
      };

      const enhancedClient = errorTracker.createEnhancedWebhookClient(mockWebhookClient);
      const longContent = 'a'.repeat(100);

      await expect(enhancedClient.send({ content: longContent })).rejects.toThrow();

      expect(logger.error).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          metadata: expect.objectContaining({
            args: [
              expect.objectContaining({
                content: expect.stringMatching(/^a{50}\.\.\. \(100 chars\)$/),
              }),
            ],
          }),
        })
      );
    });

    it('should handle non-object arguments correctly', async () => {
      const mockWebhookClient = {
        delete: jest.fn().mockRejectedValue(new Error('Delete failed')),
      };

      const enhancedClient = errorTracker.createEnhancedWebhookClient(mockWebhookClient);

      await expect(enhancedClient.delete('message-id')).rejects.toThrow();

      expect(logger.error).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          metadata: expect.objectContaining({
            args: ['message-id'],
          }),
        })
      );
    });
  });

  describe('createEnhancedError', () => {
    it('should create an error with enhanced metadata', () => {
      const error = errorTracker.createEnhancedError(
        'Enhanced error message',
        errorTracker.ErrorCategory.AVATAR,
        'fetchAvatar',
        { userId: '12345' }
      );

      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe('Enhanced error message');
      expect(error.category).toBe('avatar');
      expect(error.operation).toBe('fetchAvatar');
      expect(error.metadata).toEqual({ userId: '12345' });
      expect(error.timestamp).toBeDefined();
      expect(error.errorId).toMatch(/^ERR-ava-fet-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

      // Should have tracked the error
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('[ErrorTracker] AVATAR: Enhanced error message'),
        expect.objectContaining({
          errorId: error.errorId,
          category: 'avatar',
          operation: 'fetchAvatar',
          metadata: { userId: '12345' },
        })
      );
    });

    it('should track enhanced errors as non-critical by default', () => {
      const error = errorTracker.createEnhancedError(
        'Non-critical error',
        errorTracker.ErrorCategory.MESSAGE,
        'processMessage'
      );

      // Should use warn, not error
      expect(logger.warn).toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();
    });
  });

  describe('ErrorCategory', () => {
    it('should export all expected error categories', () => {
      expect(errorTracker.ErrorCategory).toEqual({
        DISCORD_API: 'discord_api',
        WEBHOOK: 'webhook',
        AVATAR: 'avatar',
        MESSAGE: 'message',
        RATE_LIMIT: 'rate_limit',
        AI_SERVICE: 'ai_service',
        API_CONTENT: 'api_content',
        UNKNOWN: 'unknown',
      });
    });
  });

  describe('edge cases', () => {
    it('should handle errors without stack traces', () => {
      const error = new Error('No stack');
      delete error.stack;

      const errorId = errorTracker.trackError(error);

      expect(errorId).toBeDefined();
      expect(logger.warn).toHaveBeenCalled();
    });

    it('should handle errors with empty messages', () => {
      const error = new Error('');

      const errorId = errorTracker.trackError(error);

      expect(errorId).toBeDefined();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('[ErrorTracker] UNKNOWN:'),
        expect.any(Object)
      );
    });

    it('should handle very long operation names in error ID generation', () => {
      const error = new Error('Test');
      const errorId = errorTracker.trackError(error, {
        operation: 'veryLongOperationNameThatExceedsNormalLength',
      });

      // Should only use first 3 characters of operation and include UUID
      expect(errorId).toMatch(/^ERR-unk-ver-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    it('should handle concurrent error tracking', () => {
      const errors = [];
      const results = [];

      // Track multiple errors concurrently
      for (let i = 0; i < 10; i++) {
        const error = new Error(`Concurrent error ${i}`);
        errors.push(error);
        results.push(errorTracker.trackError(error));
      }

      // All should have unique error IDs
      const uniqueIds = new Set(results);
      expect(uniqueIds.size).toBe(10);

      // All should have been logged
      expect(logger.warn).toHaveBeenCalledTimes(10);
    });

    it('should handle null and undefined in context metadata', () => {
      const error = new Error('Test error');

      // Test with null metadata
      const errorId1 = errorTracker.trackError(error, {
        category: errorTracker.ErrorCategory.WEBHOOK,
        operation: 'test',
        metadata: null,
      });

      expect(errorId1).toBeDefined();
      expect(logger.warn).toHaveBeenCalled();
    });

    it('should handle errors with undefined properties', () => {
      const error = new Error('Test error');
      error.stack = undefined;

      const errorId = errorTracker.trackError(error, {
        category: undefined,
        operation: undefined,
      });

      expect(errorId).toMatch(/^ERR-unk-unk-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(logger.warn).toHaveBeenCalled();
    });
  });
});
