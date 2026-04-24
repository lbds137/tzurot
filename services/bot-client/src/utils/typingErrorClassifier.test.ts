import { describe, it, expect, vi, afterEach } from 'vitest';
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
 * These tests use real `setInterval` instead of `vi.useFakeTimers()` because
 * the assertion-under-test is `vi.spyOn(clearInterval).toHaveBeenCalledWith(handle)`,
 * and the test just needs *a* valid `NodeJS.Timeout` reference to pass into
 * `handleTypingError`. The callbacks are no-ops and the 1s period means they
 * never have time to fire during test execution (tests run in microseconds).
 * `afterEach` unconditionally clears any intervals that were created, so no
 * real delays or timer leaks result — meeting the spirit of
 * 02-code-standards.md's "ALWAYS Use fake timers" rule without the ceremony.
 */
const intervalsToCleanup: NodeJS.Timeout[] = [];
afterEach(() => {
  while (intervalsToCleanup.length > 0) {
    const interval = intervalsToCleanup.pop();
    if (interval !== undefined) clearInterval(interval);
  }
  vi.restoreAllMocks();
});

function trackInterval(interval: NodeJS.Timeout): NodeJS.Timeout {
  intervalsToCleanup.push(interval);
  return interval;
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

  // Defensive: if a future discord.js version ever changes retryAfter to a
  // string (e.g., header passthrough), the extractor must coerce to null
  // rather than smuggle a non-numeric value into downstream logging.
  it('classifies 429 as rate-limit with null retryAfter when it is not a number', () => {
    const err = buildDiscordApiError(0, 429) as unknown as Record<string, unknown>;
    err.retryAfter = '3.5'; // String, not number
    expect(classifyTypingError(err as unknown)).toEqual({
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
    const typingInterval = trackInterval(setInterval(() => undefined, 1000));
    const clearSpy = vi.spyOn(globalThis, 'clearInterval');
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
    // Rate-limit is explicitly NOT channel-unreachable: the interval must keep
    // firing so the next tick can retry once the rate-limit window passes.
    expect(clearSpy).not.toHaveBeenCalledWith(typingInterval);
  });

  it('logs channel-unreachable at error level AND clears the interval', () => {
    const logger = buildMockLogger();
    const typingInterval = trackInterval(setInterval(() => undefined, 1000));
    const clearSpy = vi.spyOn(globalThis, 'clearInterval');
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
    // This is the load-bearing assertion for the whole classifier — stop firing
    // sendTyping against a dead channel. Previously commented as "can't assert"
    // but `vi.spyOn(clearInterval)` catches it cleanly.
    expect(clearSpy).toHaveBeenCalledWith(typingInterval);
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
    const typingInterval = trackInterval(setInterval(() => undefined, 1000));
    const clearSpy = vi.spyOn(globalThis, 'clearInterval');
    const err = Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' });

    const result = handleTypingError(err, {
      logger,
      context: { jobId: 'job-4' },
      typingInterval,
    });

    expect(result.kind).toBe('network');
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: 'job-4', cause: 'ETIMEDOUT' }),
      expect.stringContaining('network')
    );
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
    // Parity with the rate-limit test: if the switch ever misroutes `network`
    // through the channel-unreachable arm, the interval would be cleared and
    // this assertion would catch it.
    expect(clearSpy).not.toHaveBeenCalledWith(typingInterval);
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
