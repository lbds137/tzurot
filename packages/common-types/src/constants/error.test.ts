/**
 * Error Constants Tests
 *
 * Tests for error classification, reference ID generation, and message formatting.
 */

import { describe, it, expect } from 'vitest';
import {
  ApiErrorType,
  ApiErrorCategory,
  generateErrorReferenceId,
  classifyHttpStatus,
  isPermanentError,
  isTransientError,
  formatErrorSpoiler,
  formatPersonalityErrorMessage,
  stripErrorSpoiler,
  HTTP_STATUS_TO_CATEGORY,
  PERMANENT_ERROR_CATEGORIES,
  TRANSIENT_ERROR_CATEGORIES,
  USER_ERROR_MESSAGES,
} from './error.js';

describe('generateErrorReferenceId', () => {
  it('should generate a non-empty string', () => {
    const id = generateErrorReferenceId();
    expect(id).toBeTruthy();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('should generate unique IDs', () => {
    const ids = new Set<string>();
    // Generate 10 IDs - small enough to avoid timestamp collisions in tight loop
    // (Date.now() has millisecond resolution, so same-ms calls rely on 3-char
    // random suffix = 36^3 = 46,656 possibilities)
    for (let i = 0; i < 10; i++) {
      ids.add(generateErrorReferenceId());
    }
    // Allow for rare collision (at most 1) due to same-millisecond generation
    expect(ids.size).toBeGreaterThanOrEqual(9);
  });

  it('should contain base36 characters only', () => {
    const id = generateErrorReferenceId();
    // Base36 uses 0-9 and a-z
    expect(id).toMatch(/^[0-9a-z]+$/);
  });
});

describe('classifyHttpStatus', () => {
  it('should classify 400 as bad request (permanent)', () => {
    const result = classifyHttpStatus(400);
    expect(result.type).toBe(ApiErrorType.PERMANENT);
    expect(result.category).toBe(ApiErrorCategory.BAD_REQUEST);
  });

  it('should classify 401 as authentication (permanent)', () => {
    const result = classifyHttpStatus(401);
    expect(result.type).toBe(ApiErrorType.PERMANENT);
    expect(result.category).toBe(ApiErrorCategory.AUTHENTICATION);
  });

  it('should classify 402 as quota exceeded (permanent)', () => {
    const result = classifyHttpStatus(402);
    expect(result.type).toBe(ApiErrorType.PERMANENT);
    expect(result.category).toBe(ApiErrorCategory.QUOTA_EXCEEDED);
  });

  it('should classify 403 as content policy (permanent)', () => {
    const result = classifyHttpStatus(403);
    expect(result.type).toBe(ApiErrorType.PERMANENT);
    expect(result.category).toBe(ApiErrorCategory.CONTENT_POLICY);
  });

  it('should classify 404 as model not found (permanent)', () => {
    const result = classifyHttpStatus(404);
    expect(result.type).toBe(ApiErrorType.PERMANENT);
    expect(result.category).toBe(ApiErrorCategory.MODEL_NOT_FOUND);
  });

  it('should classify 429 as rate limit (transient)', () => {
    const result = classifyHttpStatus(429);
    expect(result.type).toBe(ApiErrorType.TRANSIENT);
    expect(result.category).toBe(ApiErrorCategory.RATE_LIMIT);
  });

  it('should classify 500 as server error (transient)', () => {
    const result = classifyHttpStatus(500);
    expect(result.type).toBe(ApiErrorType.TRANSIENT);
    expect(result.category).toBe(ApiErrorCategory.SERVER_ERROR);
  });

  it('should classify 502 as server error (transient)', () => {
    const result = classifyHttpStatus(502);
    expect(result.type).toBe(ApiErrorType.TRANSIENT);
    expect(result.category).toBe(ApiErrorCategory.SERVER_ERROR);
  });

  it('should classify 503 as server error (transient)', () => {
    const result = classifyHttpStatus(503);
    expect(result.type).toBe(ApiErrorType.TRANSIENT);
    expect(result.category).toBe(ApiErrorCategory.SERVER_ERROR);
  });

  it('should classify 504 as server error (transient)', () => {
    const result = classifyHttpStatus(504);
    expect(result.type).toBe(ApiErrorType.TRANSIENT);
    expect(result.category).toBe(ApiErrorCategory.SERVER_ERROR);
  });

  it('should classify unknown status as unknown', () => {
    const result = classifyHttpStatus(418); // I'm a teapot
    expect(result.type).toBe(ApiErrorType.UNKNOWN);
    expect(result.category).toBe(ApiErrorCategory.UNKNOWN);
  });
});

describe('isPermanentError', () => {
  it('should return true for permanent categories', () => {
    expect(isPermanentError(ApiErrorCategory.AUTHENTICATION)).toBe(true);
    expect(isPermanentError(ApiErrorCategory.QUOTA_EXCEEDED)).toBe(true);
    expect(isPermanentError(ApiErrorCategory.CONTENT_POLICY)).toBe(true);
    expect(isPermanentError(ApiErrorCategory.BAD_REQUEST)).toBe(true);
    expect(isPermanentError(ApiErrorCategory.MODEL_NOT_FOUND)).toBe(true);
  });

  it('should return false for transient categories', () => {
    expect(isPermanentError(ApiErrorCategory.RATE_LIMIT)).toBe(false);
    expect(isPermanentError(ApiErrorCategory.SERVER_ERROR)).toBe(false);
    expect(isPermanentError(ApiErrorCategory.TIMEOUT)).toBe(false);
    expect(isPermanentError(ApiErrorCategory.NETWORK)).toBe(false);
    expect(isPermanentError(ApiErrorCategory.EMPTY_RESPONSE)).toBe(false);
    expect(isPermanentError(ApiErrorCategory.CENSORED)).toBe(false);
  });

  it('should return false for unknown category', () => {
    expect(isPermanentError(ApiErrorCategory.UNKNOWN)).toBe(false);
  });
});

describe('isTransientError', () => {
  it('should return true for transient categories', () => {
    expect(isTransientError(ApiErrorCategory.RATE_LIMIT)).toBe(true);
    expect(isTransientError(ApiErrorCategory.SERVER_ERROR)).toBe(true);
    expect(isTransientError(ApiErrorCategory.TIMEOUT)).toBe(true);
    expect(isTransientError(ApiErrorCategory.NETWORK)).toBe(true);
    expect(isTransientError(ApiErrorCategory.EMPTY_RESPONSE)).toBe(true);
    expect(isTransientError(ApiErrorCategory.CENSORED)).toBe(true);
  });

  it('should return false for permanent categories', () => {
    expect(isTransientError(ApiErrorCategory.AUTHENTICATION)).toBe(false);
    expect(isTransientError(ApiErrorCategory.QUOTA_EXCEEDED)).toBe(false);
    expect(isTransientError(ApiErrorCategory.CONTENT_POLICY)).toBe(false);
    expect(isTransientError(ApiErrorCategory.BAD_REQUEST)).toBe(false);
    expect(isTransientError(ApiErrorCategory.MODEL_NOT_FOUND)).toBe(false);
  });

  it('should return false for unknown category', () => {
    expect(isTransientError(ApiErrorCategory.UNKNOWN)).toBe(false);
  });
});

describe('formatErrorSpoiler', () => {
  it('should format category and reference ID in spoiler tags', () => {
    const result = formatErrorSpoiler(ApiErrorCategory.QUOTA_EXCEEDED, 'abc123');
    expect(result).toBe('||*(error: quota exceeded; reference: abc123)*||');
  });

  it('should replace underscores with spaces in category', () => {
    const result = formatErrorSpoiler(ApiErrorCategory.EMPTY_RESPONSE, 'xyz789');
    expect(result).toBe('||*(error: empty response; reference: xyz789)*||');
  });

  it('should handle single-word categories', () => {
    const result = formatErrorSpoiler(ApiErrorCategory.TIMEOUT, 'ref001');
    expect(result).toBe('||*(error: timeout; reference: ref001)*||');
  });
});

describe('formatPersonalityErrorMessage', () => {
  const testRefId = 'test123';

  it('should append error spoiler to personality message', () => {
    const input = 'I had trouble thinking...';
    const result = formatPersonalityErrorMessage(input, ApiErrorCategory.SERVER_ERROR, testRefId);
    expect(result).toBe(
      'I had trouble thinking... ||*(error: server error; reference: test123)*||'
    );
  });

  it('should handle empty personality message', () => {
    const result = formatPersonalityErrorMessage('', ApiErrorCategory.TIMEOUT, testRefId);
    expect(result).toBe(' ||*(error: timeout; reference: test123)*||');
  });

  it('should include category in error spoiler', () => {
    const result = formatPersonalityErrorMessage(
      'Oops!',
      ApiErrorCategory.QUOTA_EXCEEDED,
      testRefId
    );
    expect(result).toBe('Oops! ||*(error: quota exceeded; reference: test123)*||');
  });
});

describe('HTTP_STATUS_TO_CATEGORY mapping', () => {
  it('should have entries for all common HTTP error codes', () => {
    expect(HTTP_STATUS_TO_CATEGORY[400]).toBe(ApiErrorCategory.BAD_REQUEST);
    expect(HTTP_STATUS_TO_CATEGORY[401]).toBe(ApiErrorCategory.AUTHENTICATION);
    expect(HTTP_STATUS_TO_CATEGORY[402]).toBe(ApiErrorCategory.QUOTA_EXCEEDED);
    expect(HTTP_STATUS_TO_CATEGORY[403]).toBe(ApiErrorCategory.CONTENT_POLICY);
    expect(HTTP_STATUS_TO_CATEGORY[404]).toBe(ApiErrorCategory.MODEL_NOT_FOUND);
    expect(HTTP_STATUS_TO_CATEGORY[429]).toBe(ApiErrorCategory.RATE_LIMIT);
    expect(HTTP_STATUS_TO_CATEGORY[500]).toBe(ApiErrorCategory.SERVER_ERROR);
    expect(HTTP_STATUS_TO_CATEGORY[502]).toBe(ApiErrorCategory.SERVER_ERROR);
    expect(HTTP_STATUS_TO_CATEGORY[503]).toBe(ApiErrorCategory.SERVER_ERROR);
    expect(HTTP_STATUS_TO_CATEGORY[504]).toBe(ApiErrorCategory.SERVER_ERROR);
  });
});

describe('USER_ERROR_MESSAGES', () => {
  it('should have a message for every category', () => {
    const categories = Object.values(ApiErrorCategory);
    for (const category of categories) {
      expect(USER_ERROR_MESSAGES[category]).toBeDefined();
      expect(typeof USER_ERROR_MESSAGES[category]).toBe('string');
      expect(USER_ERROR_MESSAGES[category].length).toBeGreaterThan(0);
    }
  });
});

describe('PERMANENT_ERROR_CATEGORIES', () => {
  it('should contain expected permanent categories', () => {
    expect(PERMANENT_ERROR_CATEGORIES.has(ApiErrorCategory.AUTHENTICATION)).toBe(true);
    expect(PERMANENT_ERROR_CATEGORIES.has(ApiErrorCategory.QUOTA_EXCEEDED)).toBe(true);
    expect(PERMANENT_ERROR_CATEGORIES.has(ApiErrorCategory.CONTENT_POLICY)).toBe(true);
    expect(PERMANENT_ERROR_CATEGORIES.has(ApiErrorCategory.BAD_REQUEST)).toBe(true);
    expect(PERMANENT_ERROR_CATEGORIES.has(ApiErrorCategory.MODEL_NOT_FOUND)).toBe(true);
  });

  it('should not contain transient categories', () => {
    expect(PERMANENT_ERROR_CATEGORIES.has(ApiErrorCategory.RATE_LIMIT)).toBe(false);
    expect(PERMANENT_ERROR_CATEGORIES.has(ApiErrorCategory.SERVER_ERROR)).toBe(false);
    expect(PERMANENT_ERROR_CATEGORIES.has(ApiErrorCategory.TIMEOUT)).toBe(false);
  });
});

describe('TRANSIENT_ERROR_CATEGORIES', () => {
  it('should contain expected transient categories', () => {
    expect(TRANSIENT_ERROR_CATEGORIES.has(ApiErrorCategory.RATE_LIMIT)).toBe(true);
    expect(TRANSIENT_ERROR_CATEGORIES.has(ApiErrorCategory.SERVER_ERROR)).toBe(true);
    expect(TRANSIENT_ERROR_CATEGORIES.has(ApiErrorCategory.TIMEOUT)).toBe(true);
    expect(TRANSIENT_ERROR_CATEGORIES.has(ApiErrorCategory.NETWORK)).toBe(true);
    expect(TRANSIENT_ERROR_CATEGORIES.has(ApiErrorCategory.EMPTY_RESPONSE)).toBe(true);
    expect(TRANSIENT_ERROR_CATEGORIES.has(ApiErrorCategory.CENSORED)).toBe(true);
  });

  it('should not contain permanent categories', () => {
    expect(TRANSIENT_ERROR_CATEGORIES.has(ApiErrorCategory.AUTHENTICATION)).toBe(false);
    expect(TRANSIENT_ERROR_CATEGORIES.has(ApiErrorCategory.QUOTA_EXCEEDED)).toBe(false);
    expect(TRANSIENT_ERROR_CATEGORIES.has(ApiErrorCategory.CONTENT_POLICY)).toBe(false);
    expect(TRANSIENT_ERROR_CATEGORIES.has(ApiErrorCategory.BAD_REQUEST)).toBe(false);
  });
});

describe('stripErrorSpoiler', () => {
  it('should remove error spoiler from end of message', () => {
    const input = 'Oops! Something went wrong ||*(error: timeout; reference: abc123)*||';
    expect(stripErrorSpoiler(input)).toBe('Oops! Something went wrong');
  });

  it('should remove error spoiler with different categories', () => {
    const input = 'I had trouble thinking... ||*(error: quota exceeded; reference: xyz789)*||';
    expect(stripErrorSpoiler(input)).toBe('I had trouble thinking...');
  });

  it('should handle message with only spoiler', () => {
    const input = '||*(error: server error; reference: ref001)*||';
    expect(stripErrorSpoiler(input)).toBe('');
  });

  it('should preserve message without spoiler', () => {
    const input = 'This is a normal message without any error spoiler';
    expect(stripErrorSpoiler(input)).toBe('This is a normal message without any error spoiler');
  });

  it('should preserve regular Discord spoilers (not error format)', () => {
    // Regular Discord spoiler is ||text|| without the asterisks
    const input = 'This has a ||regular spoiler|| in it';
    expect(stripErrorSpoiler(input)).toBe('This has a ||regular spoiler|| in it');
  });

  it('should handle the generic placeholder format', () => {
    const input = 'Error message ||*(an error has occurred)*||';
    expect(stripErrorSpoiler(input)).toBe('Error message');
  });

  it('should trim whitespace after removing spoiler', () => {
    const input = 'Error message   ||*(error: timeout; reference: ref)*||';
    expect(stripErrorSpoiler(input)).toBe('Error message');
  });
});
