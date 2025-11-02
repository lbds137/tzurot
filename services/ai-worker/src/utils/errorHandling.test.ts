/**
 * Error Handling Utilities Tests
 *
 * Tests for centralized error logging and handling patterns.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Logger } from 'pino';
import {
  createErrorDetails,
  logAndThrow,
  logAndReturnFallback,
  logErrorWithDetails,
  logErrorWithDetailsAndFallback
} from './errorHandling.js';

describe('errorHandling', () => {
  let mockLogger: Logger;

  beforeEach(() => {
    mockLogger = {
      error: vi.fn()
    } as unknown as Logger;
  });

  describe('createErrorDetails', () => {
    it('should extract details from Error instance', () => {
      const error = new Error('Something went wrong');
      const details = createErrorDetails(error);

      expect(details.errorType).toBe('Error');
      expect(details.errorMessage).toBe('Something went wrong');
    });

    it('should extract details from custom Error subclass', () => {
      class CustomError extends Error {
        constructor(message: string) {
          super(message);
          this.name = 'CustomError';
        }
      }

      const error = new CustomError('Custom error occurred');
      const details = createErrorDetails(error);

      expect(details.errorType).toBe('CustomError');
      expect(details.errorMessage).toBe('Custom error occurred');
    });

    it('should handle non-Error objects', () => {
      const error = { code: 'UNKNOWN', message: 'Not an Error' };
      const details = createErrorDetails(error);

      expect(details.errorType).toBe('object');
      expect(details.errorMessage).toBe('[object Object]');
    });

    it('should handle string errors', () => {
      const error = 'Plain string error';
      const details = createErrorDetails(error);

      expect(details.errorType).toBe('string');
      expect(details.errorMessage).toBe('Plain string error');
    });

    it('should handle null/undefined', () => {
      const nullDetails = createErrorDetails(null);
      expect(nullDetails.errorType).toBe('object');
      expect(nullDetails.errorMessage).toBe('null');

      const undefinedDetails = createErrorDetails(undefined);
      expect(undefinedDetails.errorType).toBe('undefined');
      expect(undefinedDetails.errorMessage).toBe('undefined');
    });

    it('should merge additional context', () => {
      const error = new Error('Test error');
      const details = createErrorDetails(error, {
        userId: '123',
        modelName: 'gpt-4',
        attemptCount: 3
      });

      expect(details.errorType).toBe('Error');
      expect(details.errorMessage).toBe('Test error');
      expect(details.userId).toBe('123');
      expect(details.modelName).toBe('gpt-4');
      expect(details.attemptCount).toBe(3);
    });

    it('should handle empty additional context', () => {
      const error = new Error('Test');
      const details = createErrorDetails(error, {});

      expect(details.errorType).toBe('Error');
      expect(details.errorMessage).toBe('Test');
      expect(Object.keys(details)).toHaveLength(2);
    });
  });

  describe('logAndThrow', () => {
    it('should log error and re-throw', () => {
      const error = new Error('Test error');

      expect(() => {
        logAndThrow(mockLogger, '[Test] Operation failed', error);
      }).toThrow(error);

      expect(mockLogger.error).toHaveBeenCalledWith(
        { err: error },
        '[Test] Operation failed'
      );
      expect(mockLogger.error).toHaveBeenCalledTimes(1);
    });

    it('should include context in log', () => {
      const error = new Error('Test error');
      const context = { userId: '123', requestId: 'abc' };

      expect(() => {
        logAndThrow(mockLogger, '[Test] Failed', error, context);
      }).toThrow(error);

      expect(mockLogger.error).toHaveBeenCalledWith(
        { err: error, userId: '123', requestId: 'abc' },
        '[Test] Failed'
      );
    });

    it('should throw original error object', () => {
      const error = new Error('Original error');
      error.cause = 'Some cause';

      try {
        logAndThrow(mockLogger, '[Test] Error', error);
        expect.fail('Should have thrown');
      } catch (caught) {
        expect(caught).toBe(error);
        expect((caught as Error).cause).toBe('Some cause');
      }
    });

    it('should work with non-Error objects', () => {
      const error = { code: 'CUSTOM_ERROR', details: 'Something bad' };

      try {
        logAndThrow(mockLogger, '[Test] Custom error', error);
        expect.fail('Should have thrown');
      } catch (caught) {
        expect(caught).toBe(error);
      }

      expect(mockLogger.error).toHaveBeenCalledWith(
        { err: error },
        '[Test] Custom error'
      );
    });
  });

  describe('logAndReturnFallback', () => {
    it('should log error and return fallback value', () => {
      const error = new Error('Query failed');
      const fallback: string[] = [];

      const result = logAndReturnFallback(
        mockLogger,
        '[Test] Using fallback',
        error,
        fallback
      );

      expect(result).toBe(fallback);
      expect(mockLogger.error).toHaveBeenCalledWith(
        { err: error },
        '[Test] Using fallback'
      );
    });

    it('should include context in log', () => {
      const error = new Error('Fetch failed');
      const context = { endpoint: '/api/data', timeout: 5000 };

      const result = logAndReturnFallback(
        mockLogger,
        '[Test] Fallback used',
        error,
        null,
        context
      );

      expect(result).toBeNull();
      expect(mockLogger.error).toHaveBeenCalledWith(
        { err: error, endpoint: '/api/data', timeout: 5000 },
        '[Test] Fallback used'
      );
    });

    it('should work with various fallback types', () => {
      const error = new Error('Failed');

      // Empty array
      expect(logAndReturnFallback(mockLogger, 'msg', error, [])).toEqual([]);

      // Empty object
      expect(logAndReturnFallback(mockLogger, 'msg', error, {})).toEqual({});

      // Null
      expect(logAndReturnFallback(mockLogger, 'msg', error, null)).toBeNull();

      // Number
      expect(logAndReturnFallback(mockLogger, 'msg', error, 0)).toBe(0);

      // Boolean
      expect(logAndReturnFallback(mockLogger, 'msg', error, false)).toBe(false);

      // String
      expect(logAndReturnFallback(mockLogger, 'msg', error, 'default')).toBe('default');
    });

    it('should not throw error', () => {
      const error = new Error('This should not be thrown');

      expect(() => {
        logAndReturnFallback(mockLogger, 'msg', error, 'safe value');
      }).not.toThrow();
    });
  });

  describe('logErrorWithDetails', () => {
    it('should log error with extracted details and re-throw', () => {
      const error = new Error('Detailed error');

      expect(() => {
        logErrorWithDetails(mockLogger, '[Test] Operation failed', error);
      }).toThrow(error);

      expect(mockLogger.error).toHaveBeenCalledWith(
        {
          err: error,
          errorType: 'Error',
          errorMessage: 'Detailed error'
        },
        '[Test] Operation failed'
      );
    });

    it('should merge error details with context', () => {
      const error = new Error('Model failed');
      const context = { modelName: 'gpt-4-vision', imageCount: 3 };

      expect(() => {
        logErrorWithDetails(
          mockLogger,
          'Vision model invocation failed',
          error,
          context
        );
      }).toThrow(error);

      expect(mockLogger.error).toHaveBeenCalledWith(
        {
          err: error,
          errorType: 'Error',
          errorMessage: 'Model failed',
          modelName: 'gpt-4-vision',
          imageCount: 3
        },
        'Vision model invocation failed'
      );
    });

    it('should handle custom Error subclasses', () => {
      class ValidationError extends Error {
        code: string;
        constructor(message: string, code: string) {
          super(message);
          this.name = 'ValidationError';
          this.code = code;
        }
      }

      const error = new ValidationError('Invalid input', 'VAL_001');

      expect(() => {
        logErrorWithDetails(mockLogger, '[Test] Validation failed', error);
      }).toThrow(error);

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          err: error,
          errorType: 'ValidationError',
          errorMessage: 'Invalid input'
        }),
        '[Test] Validation failed'
      );
    });
  });

  describe('logErrorWithDetailsAndFallback', () => {
    it('should log error with details and return fallback', () => {
      const error = new Error('Memory query failed');
      const fallback: string[] = [];

      const result = logErrorWithDetailsAndFallback(
        mockLogger,
        'Failed to query memories',
        error,
        fallback
      );

      expect(result).toBe(fallback);
      expect(mockLogger.error).toHaveBeenCalledWith(
        {
          err: error,
          errorType: 'Error',
          errorMessage: 'Memory query failed'
        },
        'Failed to query memories'
      );
    });

    it('should merge error details with context', () => {
      const error = new Error('DB connection lost');
      const context = {
        personaId: 'persona-123',
        queryLength: 256,
        attemptNumber: 3
      };

      const result = logErrorWithDetailsAndFallback(
        mockLogger,
        '[DB] Query failed',
        error,
        [],
        context
      );

      expect(result).toEqual([]);
      expect(mockLogger.error).toHaveBeenCalledWith(
        {
          err: error,
          errorType: 'Error',
          errorMessage: 'DB connection lost',
          personaId: 'persona-123',
          queryLength: 256,
          attemptNumber: 3
        },
        '[DB] Query failed'
      );
    });

    it('should work with complex fallback values', () => {
      const error = new Error('Failed');
      const complexFallback = {
        data: [],
        metadata: { count: 0, hasMore: false }
      };

      const result = logErrorWithDetailsAndFallback(
        mockLogger,
        'msg',
        error,
        complexFallback
      );

      expect(result).toBe(complexFallback);
      expect(result.data).toEqual([]);
      expect(result.metadata.count).toBe(0);
    });

    it('should not throw error', () => {
      const error = new Error('Should not throw');

      expect(() => {
        logErrorWithDetailsAndFallback(mockLogger, 'msg', error, 'safe');
      }).not.toThrow();
    });
  });

  describe('Integration scenarios', () => {
    it('should handle typical try-catch pattern with re-throw', () => {
      const doRiskyOperation = () => {
        throw new Error('Operation failed');
      };

      const wrappedOperation = () => {
        try {
          return doRiskyOperation();
        } catch (error) {
          logAndThrow(mockLogger, '[Service] Risky operation failed', error, {
            userId: '123'
          });
        }
      };

      expect(() => wrappedOperation()).toThrow('Operation failed');
      expect(mockLogger.error).toHaveBeenCalledTimes(1);
    });

    it('should handle typical try-catch pattern with fallback', () => {
      const doRiskyQuery = (): number[] => {
        throw new Error('Query timeout');
      };

      const wrappedQuery = (): number[] => {
        try {
          return doRiskyQuery();
        } catch (error) {
          return logAndReturnFallback(
            mockLogger,
            '[DB] Query timed out, returning empty results',
            error,
            [],
            { timeout: 5000 }
          );
        }
      };

      const result = wrappedQuery();
      expect(result).toEqual([]);
      expect(mockLogger.error).toHaveBeenCalledTimes(1);
    });
  });
});
