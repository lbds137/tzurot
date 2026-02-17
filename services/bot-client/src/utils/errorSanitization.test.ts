/**
 * Tests for sanitizeErrorForDiscord
 */

import { describe, it, expect } from 'vitest';
import { sanitizeErrorForDiscord } from './errorSanitization.js';

describe('sanitizeErrorForDiscord', () => {
  it('should sanitize Prisma unique constraint errors', () => {
    expect(sanitizeErrorForDiscord('Unique constraint failed on the fields')).toBe(
      'A duplicate request was detected. Please wait a moment and try again.'
    );
  });

  it('should sanitize P2002 error codes', () => {
    expect(sanitizeErrorForDiscord('Error code P2002')).toBe(
      'A duplicate request was detected. Please wait a moment and try again.'
    );
  });

  it('should sanitize connection refused errors', () => {
    expect(sanitizeErrorForDiscord('connect ECONNREFUSED 127.0.0.1:5432')).toBe(
      'Service temporarily unavailable. Please try again in a moment.'
    );
  });

  it('should sanitize connection failure errors', () => {
    expect(sanitizeErrorForDiscord('connect failed: ECONNREFUSED')).toBe(
      'Service temporarily unavailable. Please try again in a moment.'
    );
    expect(sanitizeErrorForDiscord('Could not connect — connection refused')).toBe(
      'Service temporarily unavailable. Please try again in a moment.'
    );
  });

  it('should not false-positive on "connect" in benign context', () => {
    expect(sanitizeErrorForDiscord('Could not disconnect')).toBe('Could not disconnect');
    expect(sanitizeErrorForDiscord('Failed to connect to database')).toBe(
      'Failed to connect to database'
    );
  });

  it('should sanitize long error messages (>200 chars)', () => {
    const longError = 'x'.repeat(201);
    expect(sanitizeErrorForDiscord(longError)).toBe(
      'Something went wrong. Please try again or contact support.'
    );
  });

  it('should sanitize Prisma-related errors', () => {
    expect(sanitizeErrorForDiscord('prisma client query failed')).toBe(
      'Something went wrong. Please try again or contact support.'
    );
  });

  it('should sanitize stack traces', () => {
    const errorWithStack = 'Error: Something\n    at SomeClass.method (file.ts:42:15)';
    expect(sanitizeErrorForDiscord(errorWithStack)).toBe(
      'Something went wrong. Please try again or contact support.'
    );
  });

  it('should not false-positive on "at" at start of message', () => {
    // "at" at start of string has no leading whitespace — doesn't match stack trace pattern
    expect(sanitizeErrorForDiscord('at least one field required')).toBe(
      'at least one field required'
    );
  });

  it('should pass through short, non-technical messages', () => {
    expect(sanitizeErrorForDiscord('Shape not found')).toBe('Shape not found');
    expect(sanitizeErrorForDiscord('Invalid format')).toBe('Invalid format');
  });

  it('should pass through messages exactly at 200 chars', () => {
    const exactLength = 'a'.repeat(200);
    expect(sanitizeErrorForDiscord(exactLength)).toBe(exactLength);
  });
});
