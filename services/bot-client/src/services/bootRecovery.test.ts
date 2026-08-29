/**
 * bootRecovery Unit Tests
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { runBootRecovery, RECOVERY_TIMEOUT_MS } from './bootRecovery.js';

describe('runBootRecovery', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns the pass stats when it completes in time', async () => {
    const stats = { entriesScanned: 3, entriesResumed: 2 };

    await expect(runBootRecovery('Test recovery', () => Promise.resolve(stats))).resolves.toBe(
      stats
    );
  });

  it('returns null instead of throwing when the pass rejects', async () => {
    // Startup must survive a failed recovery — the entries retry next boot.
    await expect(
      runBootRecovery('Test recovery', () => Promise.reject(new Error('Redis down')))
    ).resolves.toBeNull();
  });

  it('returns null when the pass outruns its timeout', async () => {
    vi.useFakeTimers();
    // Never settles: only the timeout can resolve this race.
    const promise = runBootRecovery('Test recovery', () => new Promise<object>(() => {}), 1000);

    await vi.advanceTimersByTimeAsync(1001);

    await expect(promise).resolves.toBeNull();
  });

  it('does not time out a pass that finishes just inside the window', async () => {
    vi.useFakeTimers();
    const stats = { entriesScanned: 1 };
    // Resolved by hand rather than by a timer: the pass settling BEFORE the
    // deadline is the whole property under test, and a literal delay here
    // would be the flaky-real-timer shape the lint rule bans.
    let finish: (value: object) => void = () => {};
    const promise = runBootRecovery(
      'Test recovery',
      () =>
        new Promise<object>(resolve => {
          finish = resolve;
        }),
      1000
    );

    finish(stats);

    await expect(promise).resolves.toBe(stats);
    // And the deadline never fired — no pending timer survives the success.
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears the timeout timer after a fast success', async () => {
    // A leaked 30s timer would hold the event loop open on every clean boot.
    vi.useFakeTimers();
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');

    await runBootRecovery('Test recovery', () => Promise.resolve({ ok: true }), 30_000);

    expect(clearSpy).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('defaults to the shared 30s cap', () => {
    expect(RECOVERY_TIMEOUT_MS).toBe(30_000);
  });
});
