import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildWatchdogExit } from './buildWatchdogExit.js';

interface CapturedTimer {
  handler: () => void;
  unref: () => void;
}

function buildHarness() {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const exitProcess = vi.fn();
  let captured: CapturedTimer | undefined;
  const unrefSpy = vi.fn();
  const setTimeoutFn = vi.fn((handler: () => void, _ms: number) => {
    const timer: CapturedTimer = { handler, unref: () => unrefSpy() };
    captured = timer;
    return timer;
  });
  const clearTimeoutFn = vi.fn();
  return {
    logger,
    exitProcess,
    setTimeoutFn,
    clearTimeoutFn,
    unrefSpy,
    getCaptured: () => captured,
  };
}

describe('buildWatchdogExit', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('arms the backstop with the configured hardExitMs and unrefs it', async () => {
    const { logger, exitProcess, setTimeoutFn, clearTimeoutFn, unrefSpy } = buildHarness();
    const dispose = vi.fn().mockResolvedValue(undefined);
    const exit = buildWatchdogExit(dispose, {
      logger: logger as unknown as Parameters<typeof buildWatchdogExit>[1]['logger'],
      hardExitMs: 5_000,
      exitProcess,
      setTimeoutFn,
      clearTimeoutFn,
    });

    exit(1);
    await vi.advanceTimersByTimeAsync(0);

    expect(setTimeoutFn).toHaveBeenCalledWith(expect.any(Function), 5_000);
    expect(unrefSpy).toHaveBeenCalledTimes(1);
  });

  it('calls exitProcess with the code after dispose resolves, and clears the backstop', async () => {
    const { logger, exitProcess, setTimeoutFn, clearTimeoutFn } = buildHarness();
    const dispose = vi.fn().mockResolvedValue(undefined);
    const exit = buildWatchdogExit(dispose, {
      logger: logger as unknown as Parameters<typeof buildWatchdogExit>[1]['logger'],
      exitProcess,
      setTimeoutFn,
      clearTimeoutFn,
    });

    exit(1);
    await vi.advanceTimersByTimeAsync(0);

    expect(dispose).toHaveBeenCalledTimes(1);
    expect(clearTimeoutFn).toHaveBeenCalledTimes(1);
    expect(exitProcess).toHaveBeenCalledWith(1);
    expect(exitProcess).not.toHaveBeenCalledWith(0);
  });

  it('calls exitProcess with the code after dispose rejects, and logs the error under the err key', async () => {
    const { logger, exitProcess, setTimeoutFn, clearTimeoutFn } = buildHarness();
    const disposeError = new Error('dispose blew up');
    const dispose = vi.fn().mockRejectedValue(disposeError);
    const exit = buildWatchdogExit(dispose, {
      logger: logger as unknown as Parameters<typeof buildWatchdogExit>[1]['logger'],
      exitProcess,
      setTimeoutFn,
      clearTimeoutFn,
    });

    exit(1);
    await vi.advanceTimersByTimeAsync(0);

    expect(clearTimeoutFn).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: disposeError }),
      expect.any(String)
    );
    expect(exitProcess).toHaveBeenCalledWith(1);
    expect(exitProcess).not.toHaveBeenCalledWith(0);
  });

  it('fires exitProcess via the captured backstop handler when dispose never settles', async () => {
    const { logger, exitProcess, setTimeoutFn, clearTimeoutFn, getCaptured } = buildHarness();
    const dispose = vi.fn(() => new Promise<void>(() => {}));
    const exit = buildWatchdogExit(dispose, {
      logger: logger as unknown as Parameters<typeof buildWatchdogExit>[1]['logger'],
      hardExitMs: 10_000,
      exitProcess,
      setTimeoutFn,
      clearTimeoutFn,
    });

    exit(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(exitProcess).not.toHaveBeenCalled();

    getCaptured()?.handler();

    expect(exitProcess).toHaveBeenCalledWith(1);
    expect(exitProcess).not.toHaveBeenCalledWith(0);
  });

  it('does not invoke dispose a second time or exit again on a repeated call (once-guard)', async () => {
    const { logger, exitProcess, setTimeoutFn, clearTimeoutFn } = buildHarness();
    const dispose = vi.fn().mockResolvedValue(undefined);
    const exit = buildWatchdogExit(dispose, {
      logger: logger as unknown as Parameters<typeof buildWatchdogExit>[1]['logger'],
      exitProcess,
      setTimeoutFn,
      clearTimeoutFn,
    });

    exit(1);
    await vi.advanceTimersByTimeAsync(0);
    exit(1);

    expect(dispose).toHaveBeenCalledTimes(1);
    expect(exitProcess).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ code: 1 }),
      expect.any(String)
    );
  });

  it('does not let a rejecting dispose escape as an unhandled rejection', async () => {
    const { logger, exitProcess, setTimeoutFn, clearTimeoutFn } = buildHarness();
    const dispose = vi.fn().mockRejectedValue(new Error('boom'));
    const exit = buildWatchdogExit(dispose, {
      logger: logger as unknown as Parameters<typeof buildWatchdogExit>[1]['logger'],
      exitProcess,
      setTimeoutFn,
      clearTimeoutFn,
    });

    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      exit(1);
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
    } finally {
      process.off('unhandledRejection', unhandled);
    }

    expect(unhandled).not.toHaveBeenCalled();
    expect(exitProcess).toHaveBeenCalledWith(1);
  });
});
