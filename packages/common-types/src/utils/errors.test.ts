import { describe, it, expect } from 'vitest';
import {
  TimeoutError,
  isTimeoutError,
  AudioTooLongError,
  isTooLongError,
  SttUnavailableError,
  isSttUnavailableError,
  normalizeErrorForLogging,
} from './errors.js';

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

describe('AudioTooLongError', () => {
  it('uses the provided detail as the message', () => {
    const err = new AudioTooLongError('Audio too long (800s). Maximum is 720s.');
    expect(err.name).toBe('AudioTooLongError');
    expect(err.message).toBe('Audio too long (800s). Maximum is 720s.');
  });

  it('falls back to a default message when no detail is given', () => {
    const err = new AudioTooLongError();
    expect(err.name).toBe('AudioTooLongError');
    expect(err.message).toBe('Audio exceeds the maximum supported duration');
  });
});

describe('isTooLongError', () => {
  it('returns true for our AudioTooLongError class', () => {
    expect(isTooLongError(new AudioTooLongError())).toBe(true);
  });

  it('returns true for a native Error tagged with name "AudioTooLongError"', () => {
    const err = new Error('too long');
    err.name = 'AudioTooLongError';
    expect(isTooLongError(err)).toBe(true);
  });

  it('returns false for a TimeoutError and generic/non-Error values', () => {
    expect(isTooLongError(new TimeoutError(1, 'op'))).toBe(false);
    expect(isTooLongError(new Error('boom'))).toBe(false);
    expect(isTooLongError(null)).toBe(false);
    expect(isTooLongError({ name: 'AudioTooLongError' })).toBe(false);
  });
});

describe('SttUnavailableError', () => {
  it('uses the provided detail as the message', () => {
    const err = new SttUnavailableError('voice-engine and BYOK cascade both failed');
    expect(err.name).toBe('SttUnavailableError');
    expect(err.message).toBe('voice-engine and BYOK cascade both failed');
  });

  it('falls back to a default message when no detail is given', () => {
    const err = new SttUnavailableError();
    expect(err.name).toBe('SttUnavailableError');
    expect(err.message).toBe('Speech-to-text service unavailable after retries');
  });
});

describe('isSttUnavailableError', () => {
  it('returns true for our SttUnavailableError class', () => {
    expect(isSttUnavailableError(new SttUnavailableError())).toBe(true);
  });

  it('returns true for a native Error tagged with name "SttUnavailableError"', () => {
    const err = new Error('unavailable');
    err.name = 'SttUnavailableError';
    expect(isSttUnavailableError(err)).toBe(true);
  });

  it('returns false for sibling typed errors and generic/non-Error values', () => {
    expect(isSttUnavailableError(new TimeoutError(1, 'op'))).toBe(false);
    expect(isSttUnavailableError(new AudioTooLongError())).toBe(false);
    expect(isSttUnavailableError(new Error('boom'))).toBe(false);
    expect(isSttUnavailableError(null)).toBe(false);
    expect(isSttUnavailableError({ name: 'SttUnavailableError' })).toBe(false);
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
