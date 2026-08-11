import { describe, it, expect, vi } from 'vitest';
import {
  isConnectionFailure,
  isRetryableGatewayFailure,
  withGatewayRetry,
} from './gatewayRetry.js';

const ok = <T>(data: T): { ok: true; data: T } => ({ ok: true, data });
const err = (
  status: number,
  kind: 'network' | 'timeout' | 'http' = 'http',
  error = 'boom'
): { ok: false; kind: 'network' | 'timeout' | 'http'; error: string; status: number } => ({
  ok: false,
  kind,
  error,
  status,
});

describe('isRetryableGatewayFailure', () => {
  it.each([
    ['network', 0, true],
    ['timeout', 0, true],
    ['http', 500, true],
    ['http', 503, true],
    ['http', 400, false],
    ['http', 404, false],
  ] as const)('kind=%s status=%d -> retryable=%s', (kind, status, expected) => {
    expect(isRetryableGatewayFailure({ kind, status })).toBe(expected);
  });
});

describe('isConnectionFailure', () => {
  // The non-idempotent predicate: a timeout or a 5xx means the request DID
  // reach a gateway that may already have created the job, so repeating it
  // would bill and answer twice.
  it.each([
    ['network', true],
    ['timeout', false],
    ['http', false],
  ] as const)('kind=%s -> retryable=%s', (kind, expected) => {
    expect(isConnectionFailure({ kind })).toBe(expected);
  });

  it('rejects a 5xx that isRetryableGatewayFailure would accept', () => {
    const failure = { kind: 'http', status: 503 };
    expect(isRetryableGatewayFailure(failure)).toBe(true);
    expect(isConnectionFailure(failure)).toBe(false);
  });
});

describe('withGatewayRetry', () => {
  it('retries a retryable failure, then succeeds', async () => {
    vi.useFakeTimers();
    try {
      const call = vi
        .fn()
        .mockResolvedValueOnce(err(0, 'network'))
        .mockResolvedValueOnce(ok({ value: 'done' }));

      const promise = withGatewayRetry(call, {
        maxAttempts: 3,
        baseDelayMs: 100,
        operation: 'doing a thing',
      });
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toEqual({ result: ok({ value: 'done' }), attempts: 2 });
      expect(call).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns the failure immediately on a non-retryable 4xx (operation called once)', async () => {
    const call = vi.fn().mockResolvedValue(err(400, 'http'));

    const result = await withGatewayRetry(call, {
      maxAttempts: 3,
      baseDelayMs: 100,
      operation: 'doing a thing',
    });

    expect(result).toEqual({ result: err(400, 'http'), attempts: 1 });
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('returns the last failure after exhausting maxAttempts on a persistent retryable failure', async () => {
    vi.useFakeTimers();
    try {
      const call = vi.fn().mockResolvedValue(err(0, 'network'));

      const promise = withGatewayRetry(call, {
        maxAttempts: 3,
        baseDelayMs: 100,
        operation: 'doing a thing',
      });
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toEqual({ result: err(0, 'network'), attempts: 3 });
      expect(call).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('never throws — a persistent failure resolves with the failure result, not a rejection', async () => {
    vi.useFakeTimers();
    try {
      const call = vi.fn().mockResolvedValue(err(503, 'http'));

      const promise = withGatewayRetry(call, {
        maxAttempts: 2,
        baseDelayMs: 50,
        operation: 'doing a thing',
      });
      await vi.runAllTimersAsync();
      await expect(promise).resolves.toEqual({ result: err(503, 'http'), attempts: 2 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('honours a caller-supplied isRetryable, so a 5xx is not repeated', async () => {
    const call = vi.fn().mockResolvedValue(err(503, 'http'));

    const outcome = await withGatewayRetry(call, {
      maxAttempts: 3,
      baseDelayMs: 100,
      operation: 'doing a thing',
      isRetryable: isConnectionFailure,
    });

    expect(outcome).toEqual({ result: err(503, 'http'), attempts: 1 });
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('throws on maxAttempts < 1 rather than skipping the call', async () => {
    const call = vi.fn();

    await expect(
      withGatewayRetry(call, { maxAttempts: 0, baseDelayMs: 100, operation: 'doing a thing' })
    ).rejects.toThrow('maxAttempts must be >= 1');
    expect(call).not.toHaveBeenCalled();
  });
});
