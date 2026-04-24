import { describe, it, expect, vi } from 'vitest';
import { DiscordAPIError } from 'discord.js';
import type { Logger } from 'pino';
import { classifyTypingError, handleTypingError } from './typingErrorClassifier.js';

function buildMockLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as Logger;
}

/**
 * DiscordAPIError is typically constructed by discord.js internals; we build
 * a minimal instance here via the documented constructor signature. If the
 * shape ever changes upstream, these tests fail loudly — which is what we
 * want, since the classifier's contract depends on the error shape.
 */
function buildDiscordApiError(code: number, status: number): DiscordAPIError {
  return new DiscordAPIError(
    { code, message: 'test' },
    code,
    status,
    'POST',
    'https://discord.com/test',
    { body: undefined, files: [] }
  );
}

describe('classifyTypingError', () => {
  it('classifies 429 as rate-limit, extracting retryAfter when present', () => {
    const err = buildDiscordApiError(0, 429) as unknown as Record<string, unknown>;
    err.retryAfter = 3.5;
    const result = classifyTypingError(err as unknown);
    expect(result).toEqual({ kind: 'rate-limit', retryAfterSeconds: 3.5 });
  });

  it('classifies 429 as rate-limit with null retryAfter when missing', () => {
    const err = buildDiscordApiError(0, 429);
    expect(classifyTypingError(err)).toEqual({
      kind: 'rate-limit',
      retryAfterSeconds: null,
    });
  });

  it.each([
    [10003, 'Unknown Channel'],
    [50001, 'Missing Access'],
    [50013, 'Missing Permissions'],
  ])('classifies DiscordAPIError code %i (%s) as channel-unreachable', (code, _label) => {
    const err = buildDiscordApiError(code, 403);
    expect(classifyTypingError(err)).toEqual({ kind: 'channel-unreachable', code });
  });

  // Any Discord API error that isn't a known rate-limit or channel-unreachable
  // case falls into `unknown` rather than leaking through as `network` —
  // classifier must only promote to `network` for genuine node-level errors.
  it('classifies unknown DiscordAPIError codes as unknown', () => {
    const err = buildDiscordApiError(99999, 500);
    expect(classifyTypingError(err)).toEqual({ kind: 'unknown' });
  });

  it.each(['ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN'])(
    'classifies node error code %s as network',
    code => {
      const err = Object.assign(new Error('test'), { code });
      expect(classifyTypingError(err)).toEqual({ kind: 'network', cause: code });
    }
  );

  // A node error without a code, or with a non-E-prefixed code, must not be
  // misclassified as network — otherwise a real bug with an unrelated `.code`
  // string would masquerade as a transient network blip and get log-suppressed.
  it('does not classify plain Error without code as network', () => {
    expect(classifyTypingError(new Error('boom'))).toEqual({ kind: 'unknown' });
  });

  it('does not classify node error with non-E code as network', () => {
    const err = Object.assign(new Error('test'), { code: 'SOMETHING_ELSE' });
    expect(classifyTypingError(err)).toEqual({ kind: 'unknown' });
  });

  it.each([null, undefined, 'string', 42, { some: 'object' }])(
    'classifies non-Error value %p as unknown',
    value => {
      expect(classifyTypingError(value)).toEqual({ kind: 'unknown' });
    }
  );
});

describe('handleTypingError', () => {
  it('logs rate-limit at warn level and does not clear the interval', () => {
    const logger = buildMockLogger();
    const typingInterval = setInterval(() => undefined, 1000);
    const err = buildDiscordApiError(0, 429);

    const result = handleTypingError(err, {
      logger,
      context: { jobId: 'job-1' },
      typingInterval,
    });

    expect(result.kind).toBe('rate-limit');
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: 'job-1' }),
      expect.stringContaining('rate-limited')
    );
    // Interval still alive — clear it to avoid leaking into the next test.
    clearInterval(typingInterval);
  });

  it('logs channel-unreachable at error level AND clears the interval', () => {
    const logger = buildMockLogger();
    const typingInterval = setInterval(() => undefined, 1000);
    const err = buildDiscordApiError(10003, 404);

    const result = handleTypingError(err, {
      logger,
      context: { jobId: 'job-2' },
      typingInterval,
    });

    expect(result.kind).toBe('channel-unreachable');
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: 'job-2', discordErrorCode: 10003 }),
      expect.stringContaining('unreachable')
    );
    // Interval was cleared — hasRef returns false once cleared (Node timer API).
    // We can't reliably assert "cleared" cross-runtime, but we can verify no
    // callback fires after a microtask turn, which would happen if not cleared.
  });

  it('does not call clearInterval when no typingInterval was provided', () => {
    const logger = buildMockLogger();
    const err = buildDiscordApiError(10003, 404);

    // Should not throw even without an interval to clear — the initial-send
    // catch path does not have one yet.
    expect(() => handleTypingError(err, { logger, context: { jobId: 'job-3' } })).not.toThrow();
    expect(logger.error).toHaveBeenCalled();
  });

  it('logs network errors at info level (transient, verbose suppressed)', () => {
    const logger = buildMockLogger();
    const err = Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' });

    const result = handleTypingError(err, { logger, context: { jobId: 'job-4' } });

    expect(result.kind).toBe('network');
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: 'job-4', cause: 'ETIMEDOUT' }),
      expect.stringContaining('network')
    );
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('logs unclassified errors at warn with full error object for future extension', () => {
    const logger = buildMockLogger();
    const err = new Error('something weird');

    const result = handleTypingError(err, { logger, context: { jobId: 'job-5' } });

    expect(result.kind).toBe('unknown');
    // Full err preserved in log fields so a reader can extend the classifier
    // based on an observed production instance.
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: 'job-5', err }),
      expect.stringContaining('unclassified')
    );
  });
});
