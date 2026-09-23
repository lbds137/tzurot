/**
 * Tests for the shared startup-run flag + single retry timer.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createStartupRetry, STARTUP_RETRY_DELAY_MS } from './startupRetry.js';

describe('createStartupRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('consume() is false without arm()', () => {
    const startupRetry = createStartupRetry();

    expect(startupRetry.consume()).toBe(false);
  });

  it('consume() is true once after arm(), then false', () => {
    const startupRetry = createStartupRetry();

    startupRetry.arm();

    expect(startupRetry.consume()).toBe(true);
    expect(startupRetry.consume()).toBe(false);
  });

  it('a second arm() without reset does NOT re-arm — the double-start guard', () => {
    const startupRetry = createStartupRetry();

    startupRetry.arm();
    startupRetry.consume();
    startupRetry.arm();

    expect(startupRetry.consume()).toBe(false);
  });

  it('reset() then arm() re-arms', () => {
    const startupRetry = createStartupRetry();

    startupRetry.arm();
    startupRetry.consume();
    startupRetry.reset();
    startupRetry.arm();

    expect(startupRetry.consume()).toBe(true);
  });

  it('schedule() without any arm() is a no-op', async () => {
    const startupRetry = createStartupRetry();
    const retry = vi.fn().mockResolvedValue(undefined);

    startupRetry.schedule(retry);

    await vi.advanceTimersByTimeAsync(STARTUP_RETRY_DELAY_MS);

    expect(retry).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('schedule() fires the callback once after exactly STARTUP_RETRY_DELAY_MS', async () => {
    const startupRetry = createStartupRetry();
    const retry = vi.fn().mockResolvedValue(undefined);

    startupRetry.arm();
    startupRetry.schedule(retry);

    await vi.advanceTimersByTimeAsync(STARTUP_RETRY_DELAY_MS - 1);
    expect(retry).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(retry).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reset() clears a pending retry — stop clears the pending retry', async () => {
    const startupRetry = createStartupRetry();
    const retry = vi.fn().mockResolvedValue(undefined);

    startupRetry.arm();
    startupRetry.schedule(retry);
    startupRetry.reset();

    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);

    expect(retry).not.toHaveBeenCalled();
  });

  it('a second schedule() replaces the first — the callback fires once total', async () => {
    const startupRetry = createStartupRetry();
    const first = vi.fn().mockResolvedValue(undefined);
    const second = vi.fn().mockResolvedValue(undefined);

    startupRetry.arm();
    startupRetry.schedule(first);
    startupRetry.schedule(second);

    await vi.advanceTimersByTimeAsync(STARTUP_RETRY_DELAY_MS);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('reset() then schedule() is a no-op — a schedule that resolves after stop must not re-arm a timer', async () => {
    const startupRetry = createStartupRetry();
    const retry = vi.fn().mockResolvedValue(undefined);

    startupRetry.arm();
    startupRetry.consume();
    startupRetry.reset();
    startupRetry.schedule(retry);

    await vi.advanceTimersByTimeAsync(STARTUP_RETRY_DELAY_MS);

    expect(retry).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
