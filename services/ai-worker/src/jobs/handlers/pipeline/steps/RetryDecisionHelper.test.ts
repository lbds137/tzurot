/**
 * Tests for Retry Decision Helper
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { shouldRetryEmptyResponse, logDuplicateDetection } from './RetryDecisionHelper.js';
import type { RAGResponse } from '../../../../services/ConversationalRAGService.js';

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
