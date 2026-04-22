import { describe, it, expect } from 'vitest';
import { TimeoutError, isTimeoutError, normalizeErrorForLogging } from './errors.js';

describe('TimeoutError', () => {
  it('constructs with timeoutMs, operationName, and formatted message', () => {
    const err = new TimeoutError(5000, 'fetch user');
    expect(err.name).toBe('TimeoutError');
    expect(err.timeoutMs).toBe(5000);
    expect(err.operationName).toBe('fetch user');
    expect(err.message).toBe('fetch user timed out after 5000ms');
  });

  it('preserves cause when provided', () => {
    const cause = new Error('abort');
    const err = new TimeoutError(1000, 'op', cause);
    expect(err.cause).toBe(cause);
  });
});

describe('isTimeoutError', () => {
  it('returns true for our TimeoutError class', () => {
    expect(isTimeoutError(new TimeoutError(1, 'op'))).toBe(true);
  });

  it('returns true for native Error with name "TimeoutError" (AbortSignal.timeout pattern)', () => {
    const err = new Error('timeout');
    err.name = 'TimeoutError';
    expect(isTimeoutError(err)).toBe(true);
  });

  it('returns false for generic Error', () => {
    expect(isTimeoutError(new Error('boom'))).toBe(false);
  });

  it('returns false for non-Error values', () => {
    expect(isTimeoutError(null)).toBe(false);
    expect(isTimeoutError('TimeoutError')).toBe(false);
    expect(isTimeoutError({ name: 'TimeoutError' })).toBe(false);
  });
});

describe('normalizeErrorForLogging', () => {
  it('passes Error instances through unchanged', () => {
    const err = new Error('real error');
    expect(normalizeErrorForLogging(err, 'op')).toBe(err);
  });

  it('wraps non-Error objects with JSON-stringified detail', () => {
    const normalized = normalizeErrorForLogging({ foo: 'bar' }, 'LangChain call');
    expect(normalized).toBeInstanceOf(Error);
    expect(normalized.name).toBe('NormalizedError');
    expect(normalized.message).toContain('[LangChain call]');
    expect(normalized.message).toContain('"foo":"bar"');
  });

  it('truncates very long JSON detail to 500 chars + ellipsis', () => {
    const huge = { blob: 'x'.repeat(2000) };
    const normalized = normalizeErrorForLogging(huge, 'op');
    // 500 chars + '...' + '[op] Non-Error object thrown: ' prefix
    expect(normalized.message.endsWith('...')).toBe(true);
  });

  it('falls back to String(error) when JSON.stringify throws (circular ref)', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const normalized = normalizeErrorForLogging(circular, 'op');
    expect(normalized).toBeInstanceOf(Error);
    expect(normalized.name).toBe('NormalizedError');
    // String(circular) is '[object Object]'
    expect(normalized.message).toContain('[object Object]');
  });
});
