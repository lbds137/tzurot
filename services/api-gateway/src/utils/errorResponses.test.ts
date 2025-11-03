/**
 * Error Response Utilities Tests
 *
 * Comprehensive test coverage for error response creation utilities.
 * Tests ensure consistency across all error types and edge cases.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ErrorCode,
  createErrorResponse,
  getStatusCode,
  createErrorFromException,
  ErrorResponses,
} from './errorResponses.js';

describe('errorResponses', () => {
  describe('createErrorResponse', () => {
    beforeEach(() => {
      // Mock Date for consistent timestamps in tests
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2025-11-02T12:00:00.000Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should create error response with all required fields', () => {
      const response = createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Invalid input');

      expect(response).toEqual({
        error: 'VALIDATION_ERROR',
        message: 'Invalid input',
        timestamp: '2025-11-02T12:00:00.000Z',
      });
    });

    it('should include requestId when provided', () => {
      const response = createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Invalid input', 'req-123');

      expect(response).toEqual({
        error: 'VALIDATION_ERROR',
        message: 'Invalid input',
        requestId: 'req-123',
        timestamp: '2025-11-02T12:00:00.000Z',
      });
    });

    it('should omit requestId when not provided', () => {
      const response = createErrorResponse(ErrorCode.NOT_FOUND, 'Resource not found');

      expect(response).not.toHaveProperty('requestId');
    });

    it('should handle all error codes', () => {
      const errorCodes = Object.values(ErrorCode);

      errorCodes.forEach(code => {
        const response = createErrorResponse(code, 'Test message');
        expect(response.error).toBe(code);
        expect(response.message).toBe('Test message');
        expect(response.timestamp).toBe('2025-11-02T12:00:00.000Z');
      });
    });
  });

  describe('getStatusCode', () => {
    it('should return 400 for VALIDATION_ERROR', () => {
      expect(getStatusCode(ErrorCode.VALIDATION_ERROR)).toBe(400);
    });

    it('should return 403 for UNAUTHORIZED', () => {
      expect(getStatusCode(ErrorCode.UNAUTHORIZED)).toBe(403);
    });

    it('should return 404 for NOT_FOUND', () => {
      expect(getStatusCode(ErrorCode.NOT_FOUND)).toBe(404);
    });

    it('should return 404 for JOB_NOT_FOUND', () => {
      expect(getStatusCode(ErrorCode.JOB_NOT_FOUND)).toBe(404);
    });

    it('should return 409 for CONFLICT', () => {
      expect(getStatusCode(ErrorCode.CONFLICT)).toBe(409);
    });

    it('should return 500 for INTERNAL_ERROR', () => {
      expect(getStatusCode(ErrorCode.INTERNAL_ERROR)).toBe(500);
    });

    it('should return 500 for CONFIGURATION_ERROR', () => {
      expect(getStatusCode(ErrorCode.CONFIGURATION_ERROR)).toBe(500);
    });

    it('should return 500 for JOB_FAILED', () => {
      expect(getStatusCode(ErrorCode.JOB_FAILED)).toBe(500);
    });

    it('should return 500 for PROCESSING_ERROR', () => {
      expect(getStatusCode(ErrorCode.PROCESSING_ERROR)).toBe(500);
    });

    it('should return 500 for SYNC_ERROR', () => {
      expect(getStatusCode(ErrorCode.SYNC_ERROR)).toBe(500);
    });

    it('should return 500 for METRICS_ERROR', () => {
      expect(getStatusCode(ErrorCode.METRICS_ERROR)).toBe(500);
    });
  });

  describe('createErrorFromException', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2025-11-02T12:00:00.000Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should extract message from Error instance', () => {
      const error = new Error('Something went wrong');
      const response = createErrorFromException(error);

      expect(response).toEqual({
        error: 'INTERNAL_ERROR',
        message: 'Something went wrong',
        timestamp: '2025-11-02T12:00:00.000Z',
      });
    });

    it('should use fallback message for non-Error exceptions', () => {
      const response = createErrorFromException('string error');

      expect(response).toEqual({
        error: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
        timestamp: '2025-11-02T12:00:00.000Z',
      });
    });

    it('should use custom fallback message', () => {
      const response = createErrorFromException(null, 'Custom fallback message');

      expect(response).toEqual({
        error: 'INTERNAL_ERROR',
        message: 'Custom fallback message',
        timestamp: '2025-11-02T12:00:00.000Z',
      });
    });

    it('should include requestId when provided', () => {
      const error = new Error('Test error');
      const response = createErrorFromException(error, 'Fallback', 'req-456');

      expect(response).toEqual({
        error: 'INTERNAL_ERROR',
        message: 'Test error',
        requestId: 'req-456',
        timestamp: '2025-11-02T12:00:00.000Z',
      });
    });

    it('should handle undefined exception', () => {
      const response = createErrorFromException(undefined);

      expect(response.error).toBe('INTERNAL_ERROR');
      expect(response.message).toBe('An unexpected error occurred');
    });

    it('should handle null exception', () => {
      const response = createErrorFromException(null);

      expect(response.error).toBe('INTERNAL_ERROR');
      expect(response.message).toBe('An unexpected error occurred');
    });
  });

  describe('ErrorResponses convenience functions', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2025-11-02T12:00:00.000Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    describe('validationError', () => {
      it('should create validation error', () => {
        const response = ErrorResponses.validationError('Invalid request body');

        expect(response).toEqual({
          error: 'VALIDATION_ERROR',
          message: 'Invalid request body',
          timestamp: '2025-11-02T12:00:00.000Z',
        });
      });

      it('should include requestId when provided', () => {
        const response = ErrorResponses.validationError('Invalid', 'req-123');

        expect(response.requestId).toBe('req-123');
      });
    });

    describe('unauthorized', () => {
      it('should create unauthorized error with default message', () => {
        const response = ErrorResponses.unauthorized();

        expect(response).toEqual({
          error: 'UNAUTHORIZED',
          message: 'This endpoint is only available to the bot owner',
          timestamp: '2025-11-02T12:00:00.000Z',
        });
      });

      it('should create unauthorized error with custom message', () => {
        const response = ErrorResponses.unauthorized('Access denied');

        expect(response.message).toBe('Access denied');
      });
    });

    describe('notFound', () => {
      it('should create not found error', () => {
        const response = ErrorResponses.notFound('Personality');

        expect(response).toEqual({
          error: 'NOT_FOUND',
          message: 'Personality not found',
          timestamp: '2025-11-02T12:00:00.000Z',
        });
      });

      it('should work with different resource names', () => {
        const response = ErrorResponses.notFound('User');
        expect(response.message).toBe('User not found');
      });
    });

    describe('conflict', () => {
      it('should create conflict error', () => {
        const response = ErrorResponses.conflict('Resource already exists');

        expect(response).toEqual({
          error: 'CONFLICT',
          message: 'Resource already exists',
          timestamp: '2025-11-02T12:00:00.000Z',
        });
      });
    });

    describe('internalError', () => {
      it('should create internal error with default message', () => {
        const response = ErrorResponses.internalError();

        expect(response).toEqual({
          error: 'INTERNAL_ERROR',
          message: 'An internal error occurred',
          timestamp: '2025-11-02T12:00:00.000Z',
        });
      });

      it('should create internal error with custom message', () => {
        const response = ErrorResponses.internalError('Database connection failed');

        expect(response.message).toBe('Database connection failed');
      });
    });

    describe('configurationError', () => {
      it('should create configuration error', () => {
        const response = ErrorResponses.configurationError('Missing API key');

        expect(response).toEqual({
          error: 'CONFIGURATION_ERROR',
          message: 'Missing API key',
          timestamp: '2025-11-02T12:00:00.000Z',
        });
      });
    });

    describe('jobFailed', () => {
      it('should create job failed error', () => {
        const response = ErrorResponses.jobFailed('Job processing failed');

        expect(response).toEqual({
          error: 'JOB_FAILED',
          message: 'Job processing failed',
          timestamp: '2025-11-02T12:00:00.000Z',
        });
      });
    });

    describe('jobNotFound', () => {
      it('should create job not found error', () => {
        const response = ErrorResponses.jobNotFound('job-123');

        expect(response).toEqual({
          error: 'JOB_NOT_FOUND',
          message: 'Job job-123 not found',
          timestamp: '2025-11-02T12:00:00.000Z',
        });
      });

      it('should include requestId when provided', () => {
        const response = ErrorResponses.jobNotFound('job-123', 'req-456');

        expect(response.requestId).toBe('req-456');
      });
    });

    describe('processingError', () => {
      it('should create processing error', () => {
        const response = ErrorResponses.processingError('Image processing failed');

        expect(response).toEqual({
          error: 'PROCESSING_ERROR',
          message: 'Image processing failed',
          timestamp: '2025-11-02T12:00:00.000Z',
        });
      });
    });

    describe('syncError', () => {
      it('should create sync error', () => {
        const response = ErrorResponses.syncError('Database sync failed');

        expect(response).toEqual({
          error: 'SYNC_ERROR',
          message: 'Database sync failed',
          timestamp: '2025-11-02T12:00:00.000Z',
        });
      });
    });

    describe('metricsError', () => {
      it('should create metrics error', () => {
        const response = ErrorResponses.metricsError('Failed to retrieve metrics');

        expect(response).toEqual({
          error: 'METRICS_ERROR',
          message: 'Failed to retrieve metrics',
          timestamp: '2025-11-02T12:00:00.000Z',
        });
      });
    });
  });

  describe('Edge cases', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2025-11-02T12:00:00.000Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should handle empty string message', () => {
      const response = createErrorResponse(ErrorCode.VALIDATION_ERROR, '');

      expect(response.message).toBe('');
    });

    it('should handle very long messages', () => {
      const longMessage = 'A'.repeat(1000);
      const response = createErrorResponse(ErrorCode.INTERNAL_ERROR, longMessage);

      expect(response.message).toBe(longMessage);
    });

    it('should handle special characters in message', () => {
      const message = 'Error: "Invalid" input <script>alert(1)</script>';
      const response = createErrorResponse(ErrorCode.VALIDATION_ERROR, message);

      expect(response.message).toBe(message);
    });

    it('should handle special characters in requestId', () => {
      const requestId = 'req-123-abc_DEF.456';
      const response = createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Test', requestId);

      expect(response.requestId).toBe(requestId);
    });
  });
});
