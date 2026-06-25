/**
 * RetryDecisionHelper Integration Tests
 *
 * Uses the REAL pino logger (not mocked) to verify that logger calls work correctly.
 * Catches the pino binding bug: "Cannot read properties of undefined (reading 'Symbol(pino.msgPrefix)')"
 *
 * Background: Extracting pino methods (e.g., `const logFn = logger.warn`) loses the
 * `this` context, causing runtime errors. This test catches regression if someone
 * refactors the code to extract method references again.
 *
 * @see RetryDecisionHelper.ts for the fix and detailed comments
 */

import { describe, it, expect } from 'vitest';
import { shouldRetryEmptyResponse, logDuplicateDetection } from './RetryDecisionHelper.js';
import type { RAGResponse } from '../../../../services/ConversationalRAGTypes.js';

// NOTE: No vi.mock - we use the REAL pino logger to test binding

function createMockResponse(content: string, thinkingContent?: string): RAGResponse {
  return {
    content,
    thinkingContent,
    modelUsed: 'test-model',
    tokensIn: 100,
    tokensOut: 50,
  };
}

describe('RetryDecisionHelper pino binding', () => {
  describe('shouldRetryEmptyResponse with real logger', () => {
    it('should not throw when logging empty response warning (can retry)', () => {
      const response = createMockResponse('');
      expect(() =>
        shouldRetryEmptyResponse({
          response,
          attempt: 1,
          maxAttempts: 3,
          jobId: 'pino-test-job',
        })
      ).not.toThrow();
    });

    it('should not throw when logging empty response error (exhausted)', () => {
      const response = createMockResponse('');
      expect(() =>
        shouldRetryEmptyResponse({
          response,
          attempt: 3,
          maxAttempts: 3,
          jobId: 'pino-test-job',
        })
      ).not.toThrow();
    });

    it('should not throw when response has thinking but no content', () => {
      const response = createMockResponse('', 'Some thinking content');
      expect(() =>
        shouldRetryEmptyResponse({
          response,
          attempt: 1,
          maxAttempts: 3,
          jobId: 'pino-test-job',
        })
      ).not.toThrow();
    });
  });

  describe('logDuplicateDetection with real logger', () => {
    it('should not throw when logging duplicate warning (can retry)', () => {
      const response = createMockResponse('Duplicate response');
      expect(() =>
        logDuplicateDetection({
          response,
          attempt: 1,
          maxAttempts: 3,
          matchIndex: 0,
          jobId: 'pino-test-job',
          isGuestMode: false,
        })
      ).not.toThrow();
    });

    it('should not throw when logging duplicate error (exhausted)', () => {
      const response = createMockResponse('Duplicate response');
      expect(() =>
        logDuplicateDetection({
          response,
          attempt: 3,
          maxAttempts: 3,
          matchIndex: 0,
          jobId: 'pino-test-job',
          isGuestMode: false,
        })
      ).not.toThrow();
    });

    it('should not throw in guest mode', () => {
      const response = createMockResponse('Duplicate response');
      expect(() =>
        logDuplicateDetection({
          response,
          attempt: 2,
          maxAttempts: 3,
          matchIndex: 1,
          jobId: 'pino-test-job',
          isGuestMode: true,
        })
      ).not.toThrow();
    });
  });
});
