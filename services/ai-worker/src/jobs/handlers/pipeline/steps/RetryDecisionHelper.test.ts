/**
 * Tests for Retry Decision Helper
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  shouldRetryEmptyResponse,
  logDuplicateDetection,
  logRetryEscalation,
  logRetrySuccess,
  selectBetterFallback,
  logFallbackUsed,
  type FallbackResponse,
} from './RetryDecisionHelper.js';
import type { RAGResponse } from '../../../../services/ConversationalRAGTypes.js';

// Mock common-types
vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types')>();
  return {
    ...actual,
    createLogger: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

function createMockResponse(content: string, thinkingContent?: string): RAGResponse {
  return {
    content,
    thinkingContent,
    modelUsed: 'test-model',
    tokensIn: 100,
    tokensOut: 50,
  };
}

describe('shouldRetryEmptyResponse', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return "continue" when response has content', () => {
    const response = createMockResponse('Hello, world!');
    const result = shouldRetryEmptyResponse({
      response,
      attempt: 1,
      maxAttempts: 3,
      jobId: 'test-job',
    });
    expect(result).toBe('continue');
  });

  it('should return "retry" when response is empty and can retry', () => {
    const response = createMockResponse('');
    const result = shouldRetryEmptyResponse({
      response,
      attempt: 1,
      maxAttempts: 3,
      jobId: 'test-job',
    });
    expect(result).toBe('retry');
  });

  it('should return "return" when response is empty and cannot retry', () => {
    const response = createMockResponse('');
    const result = shouldRetryEmptyResponse({
      response,
      attempt: 3,
      maxAttempts: 3,
      jobId: 'test-job',
    });
    expect(result).toBe('return');
  });

  it('should handle response with only thinking content', () => {
    const response = createMockResponse('', '<reasoning>Some thinking</reasoning>');
    const result = shouldRetryEmptyResponse({
      response,
      attempt: 1,
      maxAttempts: 3,
      jobId: 'test-job',
    });
    expect(result).toBe('retry');
  });

  it('should return "retry" when on second attempt of three', () => {
    const response = createMockResponse('');
    const result = shouldRetryEmptyResponse({
      response,
      attempt: 2,
      maxAttempts: 3,
      jobId: 'test-job',
    });
    expect(result).toBe('retry');
  });
});

describe('logDuplicateDetection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return "retry" when can retry', () => {
    const response = createMockResponse('Duplicate response');
    const result = logDuplicateDetection({
      response,
      attempt: 1,
      maxAttempts: 3,
      matchIndex: 0,
      jobId: 'test-job',
      isGuestMode: false,
    });
    expect(result).toBe('retry');
  });

  it('should return "return" when cannot retry', () => {
    const response = createMockResponse('Duplicate response');
    const result = logDuplicateDetection({
      response,
      attempt: 3,
      maxAttempts: 3,
      matchIndex: 0,
      jobId: 'test-job',
      isGuestMode: false,
    });
    expect(result).toBe('return');
  });

  it('should handle undefined matchIndex', () => {
    const response = createMockResponse('Duplicate response');
    const result = logDuplicateDetection({
      response,
      attempt: 1,
      maxAttempts: 3,
      matchIndex: undefined,
      jobId: 'test-job',
      isGuestMode: false,
    });
    expect(result).toBe('retry');
  });

  it('should handle guest mode', () => {
    const response = createMockResponse('Duplicate response');
    const result = logDuplicateDetection({
      response,
      attempt: 1,
      maxAttempts: 3,
      matchIndex: 2,
      jobId: 'test-job',
      isGuestMode: true,
    });
    expect(result).toBe('retry');
  });

  it('should handle undefined jobId', () => {
    const response = createMockResponse('Duplicate response');
    const result = logDuplicateDetection({
      response,
      attempt: 2,
      maxAttempts: 3,
      matchIndex: 1,
      jobId: undefined,
      isGuestMode: false,
    });
    expect(result).toBe('retry');
  });
});

describe('selectBetterFallback', () => {
  function createFallback(
    reason: 'empty' | 'duplicate',
    attempt: number,
    content = 'fallback content'
  ): FallbackResponse {
    return {
      response: createMockResponse(content),
      reason,
      attempt,
    };
  }

  it('should return candidate when no existing fallback', () => {
    const candidate = createFallback('duplicate', 1);
    const result = selectBetterFallback(undefined, candidate);
    expect(result).toBe(candidate);
  });

  it('should prefer duplicate over empty (duplicate has content)', () => {
    const existing = createFallback('duplicate', 1, 'I have real content');
    const candidate = createFallback('empty', 2, '');
    const result = selectBetterFallback(existing, candidate);
    expect(result).toBe(existing);
  });

  it('should upgrade from empty to duplicate', () => {
    const existing = createFallback('empty', 1, '');
    const candidate = createFallback('duplicate', 2, 'Duplicate content');
    const result = selectBetterFallback(existing, candidate);
    expect(result).toBe(candidate);
  });

  it('should prefer later attempt when same reason (both duplicate)', () => {
    const existing = createFallback('duplicate', 1, 'First duplicate');
    const candidate = createFallback('duplicate', 2, 'Second duplicate');
    const result = selectBetterFallback(existing, candidate);
    expect(result).toBe(candidate);
  });

  it('should prefer later attempt when same reason (both empty)', () => {
    const existing = createFallback('empty', 1);
    const candidate = createFallback('empty', 2);
    const result = selectBetterFallback(existing, candidate);
    expect(result).toBe(candidate);
  });
});

describe('logRetryEscalation', () => {
  it('should not throw on attempt > 1', () => {
    expect(() =>
      logRetryEscalation('job-1', 2, {
        temperatureOverride: 0.9,
        frequencyPenaltyOverride: 0.3,
        historyReductionPercent: 50,
      })
    ).not.toThrow();
  });

  it('should be a no-op on attempt 1', () => {
    // Should not throw and should not log (first attempt, no escalation)
    expect(() => logRetryEscalation('job-1', 1, {})).not.toThrow();
  });
});

describe('logRetrySuccess', () => {
  it('should not throw when called with valid args', () => {
    expect(() => logRetrySuccess('job-1', 'test-model', 2, 1, 0)).not.toThrow();
  });

  it('should not throw with undefined jobId and modelUsed', () => {
    expect(() => logRetrySuccess(undefined, undefined, 3, 2, 1)).not.toThrow();
  });
});

describe('logFallbackUsed', () => {
  it('should not throw when called with valid fallback', () => {
    const fallback: FallbackResponse = {
      response: createMockResponse('Fallback content'),
      reason: 'duplicate',
      attempt: 1,
    };
    expect(() => logFallbackUsed(fallback, 'job-123')).not.toThrow();
  });

  it('should not throw when jobId is undefined', () => {
    const fallback: FallbackResponse = {
      response: createMockResponse('Fallback content'),
      reason: 'empty',
      attempt: 2,
    };
    expect(() => logFallbackUsed(fallback, undefined)).not.toThrow();
  });
});
