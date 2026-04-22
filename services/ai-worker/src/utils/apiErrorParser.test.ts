/**
 * API Error Parser Tests
 *
 * Tests for parsing LangChain/OpenRouter errors into structured info.
 */

import { describe, it, expect } from 'vitest';
import { parseApiError, ApiError, shouldRetryError, getErrorLogContext } from './apiErrorParser.js';
import {
  ApiErrorType,
  ApiErrorCategory,
  ERROR_MESSAGES,
  MAX_ERROR_MESSAGE_LENGTH,
} from '@tzurot/common-types';

describe('parseApiError', () => {
  describe('HTTP status code extraction', () => {
    it('should extract status from error.status', () => {
      const error = { status: 429, message: 'Rate limited' };
      const result = parseApiError(error);
      expect(result.statusCode).toBe(429);
      expect(result.category).toBe(ApiErrorCategory.RATE_LIMIT);
    });

    it('should extract status from error.response.status', () => {
      const error = { response: { status: 401 }, message: 'Unauthorized' };
      const result = parseApiError(error);
      expect(result.statusCode).toBe(401);
      expect(result.category).toBe(ApiErrorCategory.AUTHENTICATION);
    });

    it('should extract status from error.cause.status', () => {
      const error = { cause: { status: 402 }, message: 'Payment required' };
      const result = parseApiError(error);
      expect(result.statusCode).toBe(402);
      expect(result.category).toBe(ApiErrorCategory.QUOTA_EXCEEDED);
    });

    it('should parse status from error message', () => {
      const error = new Error('Request failed with status code 429');
      const result = parseApiError(error);
      expect(result.statusCode).toBe(429);
      expect(result.category).toBe(ApiErrorCategory.RATE_LIMIT);
    });

    it('should parse status with different message formats', () => {
      const error1 = new Error('status: 500');
      expect(parseApiError(error1).statusCode).toBe(500);

      const error2 = new Error('status=403');
      expect(parseApiError(error2).statusCode).toBe(403);
    });

    // PR #864 bounded-quantifier regression guards. `statusPattern` uses
    // `\s{0,8}` / `\s{1,8}` after the ReDoS fix. If bounds were narrowed to
    // `\s{1,2}`, multi-space variants would stop matching.
    it('parses status with multi-space variants (bounded-quantifier regression)', () => {
      // Up to ~8 spaces between tokens — upper bound of \s{1,8}
      expect(parseApiError(new Error('status    code    429')).statusCode).toBe(429);
      expect(parseApiError(new Error('status        code        429')).statusCode).toBe(429);
    });

    it('parses status with tab/newline whitespace variants', () => {
      expect(parseApiError(new Error('status\tcode\t500')).statusCode).toBe(500);
    });

    it('does NOT fire on unbounded whitespace gaps (sanity — way past ceiling)', () => {
      // More than 8 spaces: pattern should not match, returning undefined status.
      // This isn't a strict requirement but confirms the cap works as a ceiling.
      const tooMany = 'status' + ' '.repeat(20) + 'code' + ' '.repeat(20) + '429';
      expect(parseApiError(new Error(tooMany)).statusCode).toBeUndefined();
    });
  });

  describe('error classification', () => {
    it('should classify 401 as permanent authentication error', () => {
      const error = { status: 401 };
      const result = parseApiError(error);
      expect(result.type).toBe(ApiErrorType.PERMANENT);
      expect(result.category).toBe(ApiErrorCategory.AUTHENTICATION);
      expect(result.shouldRetry).toBe(false);
    });

    it('should classify 402 as permanent quota error', () => {
      const error = { status: 402 };
      const result = parseApiError(error);
      expect(result.type).toBe(ApiErrorType.PERMANENT);
      expect(result.category).toBe(ApiErrorCategory.QUOTA_EXCEEDED);
      expect(result.shouldRetry).toBe(false);
    });

    it('should classify 403 as permanent content policy error', () => {
      const error = { status: 403 };
      const result = parseApiError(error);
      expect(result.type).toBe(ApiErrorType.PERMANENT);
      expect(result.category).toBe(ApiErrorCategory.CONTENT_POLICY);
      expect(result.shouldRetry).toBe(false);
    });

    it('should classify 429 as transient rate limit error', () => {
      const error = { status: 429 };
      const result = parseApiError(error);
      expect(result.type).toBe(ApiErrorType.TRANSIENT);
      expect(result.category).toBe(ApiErrorCategory.RATE_LIMIT);
      expect(result.shouldRetry).toBe(true);
    });

    it('should classify 500 as transient server error', () => {
      const error = { status: 500 };
      const result = parseApiError(error);
      expect(result.type).toBe(ApiErrorType.TRANSIENT);
      expect(result.category).toBe(ApiErrorCategory.SERVER_ERROR);
      expect(result.shouldRetry).toBe(true);
    });
  });

  describe('message pattern detection', () => {
    it('should detect quota exceeded from message', () => {
      const error = new Error('Error: You have exceeded your quota');
      const result = parseApiError(error);
      expect(result.category).toBe(ApiErrorCategory.QUOTA_EXCEEDED);
      expect(result.shouldRetry).toBe(false);
    });

    it('should detect daily limit from message', () => {
      const error = new Error('50 requests per day limit reached');
      const result = parseApiError(error);
      expect(result.category).toBe(ApiErrorCategory.QUOTA_EXCEEDED);
      expect(result.shouldRetry).toBe(false);
    });

    it('should detect rate limit from message', () => {
      const error = new Error('Too many requests, slow down');
      const result = parseApiError(error);
      expect(result.category).toBe(ApiErrorCategory.RATE_LIMIT);
      expect(result.shouldRetry).toBe(true);
    });

    it('should detect authentication error from message', () => {
      const error = new Error('Invalid API key provided');
      const result = parseApiError(error);
      expect(result.category).toBe(ApiErrorCategory.AUTHENTICATION);
      expect(result.shouldRetry).toBe(false);
    });

    it('should detect content policy from message', () => {
      const error = new Error('Content policy violation detected');
      const result = parseApiError(error);
      expect(result.category).toBe(ApiErrorCategory.CONTENT_POLICY);
      expect(result.shouldRetry).toBe(false);
    });

    it('should detect context window from message', () => {
      const error = new Error('Context length exceeded maximum');
      const result = parseApiError(error);
      expect(result.category).toBe(ApiErrorCategory.BAD_REQUEST);
      // 400 errors are now retryable (some AI APIs return 400 for transient issues)
      expect(result.shouldRetry).toBe(true);
    });

    it('should detect model not found from message', () => {
      const error = new Error('Model not found: some-model');
      const result = parseApiError(error);
      expect(result.category).toBe(ApiErrorCategory.MODEL_NOT_FOUND);
      expect(result.shouldRetry).toBe(false);
    });

    it('should detect timeout from message', () => {
      const error = new Error('Request timed out');
      const result = parseApiError(error);
      expect(result.category).toBe(ApiErrorCategory.TIMEOUT);
      expect(result.shouldRetry).toBe(true);
    });

    it('should detect server error from message', () => {
      const error = new Error('Internal server error occurred');
      const result = parseApiError(error);
      expect(result.category).toBe(ApiErrorCategory.SERVER_ERROR);
      expect(result.shouldRetry).toBe(true);
    });

    it('should detect SDK parsing error (Cannot read properties of undefined)', () => {
      const error = new Error("Cannot read properties of undefined (reading 'message')");
      const result = parseApiError(error);
      expect(result.category).toBe(ApiErrorCategory.SERVER_ERROR);
      expect(result.shouldRetry).toBe(true);
    });

    it('should detect SDK parsing error (unexpected end of JSON)', () => {
      const error = new Error('Unexpected end of JSON input');
      const result = parseApiError(error);
      expect(result.category).toBe(ApiErrorCategory.SERVER_ERROR);
      expect(result.shouldRetry).toBe(true);
    });

    it('should detect SDK parsing error (is not a function)', () => {
      const error = new Error('response.json is not a function');
      const result = parseApiError(error);
      expect(result.category).toBe(ApiErrorCategory.SERVER_ERROR);
      expect(result.shouldRetry).toBe(true);
    });
  });

  describe('content error detection', () => {
    it('should detect empty response error', () => {
      const error = new Error(ERROR_MESSAGES.EMPTY_RESPONSE);
      const result = parseApiError(error);
      expect(result.category).toBe(ApiErrorCategory.EMPTY_RESPONSE);
      expect(result.shouldRetry).toBe(true);
    });

    it('should detect censored response error', () => {
      const error = new Error(ERROR_MESSAGES.CENSORED_RESPONSE);
      const result = parseApiError(error);
      expect(result.category).toBe(ApiErrorCategory.CENSORED);
      expect(result.shouldRetry).toBe(true);
    });
  });

  describe('special-case detection (pre-status)', () => {
    it('should classify AbortError by name as TIMEOUT', () => {
      const error = new Error('Request was aborted');
      error.name = 'AbortError';
      const result = parseApiError(error);
      expect(result.category).toBe(ApiErrorCategory.TIMEOUT);
      expect(result.type).toBe(ApiErrorType.TRANSIENT);
      expect(result.shouldRetry).toBe(true);
    });

    it('should classify error with "Request was aborted" message as TIMEOUT', () => {
      const error = new Error('Request was aborted due to timeout');
      const result = parseApiError(error);
      expect(result.category).toBe(ApiErrorCategory.TIMEOUT);
      expect(result.shouldRetry).toBe(true);
    });

    it('should classify AbortError even when wrapped with a status code', () => {
      // Some LangChain wrappers attach a fake status to abort errors — special-case
      // must still win over status-based classification.
      const error = Object.assign(new Error('Request was aborted'), {
        name: 'AbortError',
        status: 500,
      });
      const result = parseApiError(error);
      expect(result.category).toBe(ApiErrorCategory.TIMEOUT);
    });

    it('should classify "Received 404 when fetching URL" as permanent MEDIA_NOT_FOUND', () => {
      // OpenRouter/vision APIs wrap media-fetch 404s inside a 400 response.
      // Without the special case, the wrapping 400 would make this retryable BAD_REQUEST.
      const error = new Error('400 Received 404 when fetching URL https://cdn.discord.com/foo.png');
      const result = parseApiError(error);
      expect(result.category).toBe(ApiErrorCategory.MEDIA_NOT_FOUND);
      expect(result.type).toBe(ApiErrorType.PERMANENT);
      expect(result.shouldRetry).toBe(false);
    });

    it('should classify MEDIA_NOT_FOUND even when error object carries status 400', () => {
      const error = Object.assign(new Error('Received 404 when fetching URL'), { status: 400 });
      const result = parseApiError(error);
      expect(result.category).toBe(ApiErrorCategory.MEDIA_NOT_FOUND);
      expect(result.shouldRetry).toBe(false);
    });

    it('should classify the actual prod OpenRouter variant "400 Received 404 status code when fetching image from URL"', () => {
      // Verified prod log sample (Railway 2026-04-14). Google AI Studio via
      // OpenRouter wraps media-fetch 404s with extra phrasing ("status code",
      // "image from") that the original minimal regex failed to match —
      // this test locks in the fix for that prod miss.
      const error = new Error(
        '400 Received 404 status code when fetching image from URL: https://i.redd.it/ks0yn4k5ed6f1.jpeg'
      );
      const result = parseApiError(error);
      expect(result.category).toBe(ApiErrorCategory.MEDIA_NOT_FOUND);
      expect(result.type).toBe(ApiErrorType.PERMANENT);
      expect(result.shouldRetry).toBe(false);
    });

    it('should classify OpenRouter variant with "status code" but without "image from"', () => {
      const error = new Error(
        '400 Received 404 status code when fetching URL: https://cdn.discordapp.com/attachments/123/456/image.png'
      );
      const result = parseApiError(error);
      expect(result.category).toBe(ApiErrorCategory.MEDIA_NOT_FOUND);
      expect(result.shouldRetry).toBe(false);
    });

    it('should classify variant with "image from" but without "status code"', () => {
      const error = new Error(
        'Received 404 when fetching image from URL https://example.com/photo.jpg'
      );
      const result = parseApiError(error);
      expect(result.category).toBe(ApiErrorCategory.MEDIA_NOT_FOUND);
      expect(result.shouldRetry).toBe(false);
    });

    it('should NOT match loosely-related "404" and "fetching URL" across distant parts of a message', () => {
      // Defensive: the regex limits distance between anchors to prevent
      // false positives on longer messages that mention both "404" and
      // "fetching URL" in unrelated contexts. The bounded .{0,40}? / .{0,30}?
      // quantifiers restrict matching to a single error-message span.
      const error = new Error(
        'Received 404 from upstream validation service. Separately, a retry fetching the secondary URL succeeded eventually after many attempts and some other long explanation.'
      );
      const result = parseApiError(error);
      // Two assertions for defense in depth:
      // - `category !== MEDIA_NOT_FOUND`: confirms the regex guard didn't
      //   false-match the distant-anchor wording.
      // - `shouldRetry === true`: asserts the behavioral contract the
      //   production code actually depends on — this error must remain
      //   retryable. If a future refactor classified this error as any
      //   OTHER permanent category (AUTHENTICATION, QUOTA_EXCEEDED, etc.)
      //   the category check would pass but the behavior check would fail.
      expect(result.category).not.toBe(ApiErrorCategory.MEDIA_NOT_FOUND);
      expect(result.shouldRetry).toBe(true);
    });
  });

  describe('network error detection', () => {
    it('should detect ECONNRESET as network error', () => {
      const error = { code: 'ECONNRESET', message: 'Connection reset' };
      const result = parseApiError(error);
      expect(result.category).toBe(ApiErrorCategory.NETWORK);
      expect(result.shouldRetry).toBe(true);
    });

    it('should detect ETIMEDOUT as network error', () => {
      const error = { code: 'ETIMEDOUT', message: 'Connection timed out' };
      const result = parseApiError(error);
      expect(result.category).toBe(ApiErrorCategory.NETWORK);
      expect(result.shouldRetry).toBe(true);
    });

    it('should detect ECONNREFUSED as network error', () => {
      const error = { code: 'ECONNREFUSED', message: 'Connection refused' };
      const result = parseApiError(error);
      expect(result.category).toBe(ApiErrorCategory.NETWORK);
      expect(result.shouldRetry).toBe(true);
    });

    it('should detect ENOTFOUND as network error', () => {
      const error = { code: 'ENOTFOUND', message: 'DNS lookup failed' };
      const result = parseApiError(error);
      expect(result.category).toBe(ApiErrorCategory.NETWORK);
      expect(result.shouldRetry).toBe(true);
    });
  });

  describe('request ID extraction', () => {
    it('should extract x-request-id from response headers', () => {
      const error = {
        response: {
          status: 500,
          headers: {
            'x-request-id': 'req-123-abc',
          },
        },
      };
      const result = parseApiError(error);
      expect(result.requestId).toBe('req-123-abc');
    });

    it('should handle missing request ID', () => {
      const error = { status: 500 };
      const result = parseApiError(error);
      expect(result.requestId).toBeUndefined();
    });
  });

  describe('reference ID generation', () => {
    it('should always generate a reference ID', () => {
      const error = new Error('Some error');
      const result = parseApiError(error);
      expect(result.referenceId).toBeDefined();
      expect(typeof result.referenceId).toBe('string');
      expect(result.referenceId.length).toBeGreaterThan(0);
    });

    it('should generate unique reference IDs', () => {
      const error1 = new Error('Error 1');
      const error2 = new Error('Error 2');
      const result1 = parseApiError(error1);
      const result2 = parseApiError(error2);
      expect(result1.referenceId).not.toBe(result2.referenceId);
    });
  });

  describe('user message assignment', () => {
    it('should provide user-friendly message for each category', () => {
      const testCases = [
        { status: 401, expectedSubstring: 'API key' },
        { status: 402, expectedSubstring: 'usage limit' },
        { status: 429, expectedSubstring: 'requests' },
        { status: 500, expectedSubstring: 'AI service' },
      ];

      for (const { status, expectedSubstring } of testCases) {
        const result = parseApiError({ status });
        expect(result.userMessage.toLowerCase()).toContain(expectedSubstring.toLowerCase());
      }
    });
  });

  describe('edge cases', () => {
    it('should handle null error', () => {
      const result = parseApiError(null);
      expect(result.type).toBe(ApiErrorType.UNKNOWN);
      expect(result.category).toBe(ApiErrorCategory.UNKNOWN);
    });

    it('should handle undefined error', () => {
      const result = parseApiError(undefined);
      expect(result.type).toBe(ApiErrorType.UNKNOWN);
      expect(result.category).toBe(ApiErrorCategory.UNKNOWN);
    });

    it('should handle string error', () => {
      const result = parseApiError('Something went wrong');
      expect(result.technicalMessage).toBe('Something went wrong');
    });

    it('should handle Error object', () => {
      const error = new Error('Test error message');
      const result = parseApiError(error);
      expect(result.technicalMessage).toBe('Test error message');
    });
  });
});

describe('ApiError', () => {
  describe('constructor', () => {
    it('should create error with message and info', () => {
      const info = parseApiError({ status: 429 });
      const error = new ApiError('Rate limited', info);
      expect(error.message).toBe('Rate limited');
      expect(error.info).toEqual(info);
      expect(error.name).toBe('ApiError');
    });
  });

  describe('fromError', () => {
    it('should create ApiError from caught error', () => {
      const originalError = new Error('Original error');
      const apiError = ApiError.fromError(originalError);
      expect(apiError).toBeInstanceOf(ApiError);
      expect(apiError.message).toBe('Original error');
      expect(apiError.info).toBeDefined();
    });

    it('should create ApiError from non-Error', () => {
      const apiError = ApiError.fromError({ status: 500 });
      expect(apiError).toBeInstanceOf(ApiError);
      expect(apiError.info.statusCode).toBe(500);
    });
  });
});

describe('shouldRetryError', () => {
  it('should return true for transient errors', () => {
    expect(shouldRetryError({ status: 429 })).toBe(true);
    expect(shouldRetryError({ status: 500 })).toBe(true);
    expect(shouldRetryError({ status: 502 })).toBe(true);
    expect(shouldRetryError({ status: 503 })).toBe(true);
    expect(shouldRetryError({ code: 'ECONNRESET' })).toBe(true);
  });

  it('should return false for permanent errors', () => {
    expect(shouldRetryError({ status: 401 })).toBe(false);
    expect(shouldRetryError({ status: 402 })).toBe(false);
    expect(shouldRetryError({ status: 403 })).toBe(false);
    // Note: 400 is now retryable (some AI APIs return 400 for transient issues)
  });

  it('should return true for 400 errors (now retryable)', () => {
    expect(shouldRetryError({ status: 400 })).toBe(true);
  });

  it('should return true for unknown errors (conservative approach)', () => {
    expect(shouldRetryError(new Error('Unknown error'))).toBe(true);
  });
});

describe('getErrorLogContext', () => {
  it('should return safe logging context', () => {
    const error = {
      status: 429,
      response: {
        headers: {
          'x-request-id': 'req-abc',
        },
      },
    };
    const context = getErrorLogContext(error);

    expect(context.errorCategory).toBe(ApiErrorCategory.RATE_LIMIT);
    expect(context.errorType).toBe(ApiErrorType.TRANSIENT);
    expect(context.statusCode).toBe(429);
    expect(context.shouldRetry).toBe(true);
    expect(context.referenceId).toBeDefined();
    // Uses explicit naming to distinguish from internal job requestId
    expect(context.openRouterRequestId).toBe('req-abc');
  });

  it('should truncate long technical messages', () => {
    const longMessage = 'a'.repeat(1000);
    const error = new Error(longMessage);
    const context = getErrorLogContext(error);

    expect((context.technicalMessage as string).length).toBeLessThanOrEqual(
      MAX_ERROR_MESSAGE_LENGTH
    );
  });

  it('should not include sensitive data', () => {
    const error = new Error('Error with API key: sk-abc123');
    const context = getErrorLogContext(error);

    // The function truncates but doesn't sanitize - that's handled by logSanitizer
    expect(context).not.toHaveProperty('apiKey');
    expect(context).not.toHaveProperty('token');
    expect(context).not.toHaveProperty('password');
  });
});
