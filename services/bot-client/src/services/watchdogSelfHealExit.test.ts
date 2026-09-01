import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildWatchdogSelfHealExit, type LifecycleShutdown } from './watchdogSelfHealExit.js';

type BuiltLogger = Parameters<typeof buildWatchdogSelfHealExit>[0]['logger'];

function makeLogger(): { logger: BuiltLogger; error: ReturnType<typeof vi.fn> } {
  const error = vi.fn();
  const logger = { info: vi.fn(), warn: vi.fn(), error } as unknown as BuiltLogger;
  return { logger, error };
}

describe('buildWatchdogSelfHealExit', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('routes into the lifecycle shutdown with the self-heal trigger and the watchdog code', () => {
    const { logger, error } = makeLogger();
    const shutdown = vi.fn<LifecycleShutdown>().mockResolvedValue(undefined);
    const exitProcess = vi.fn();

    const exit = buildWatchdogSelfHealExit({
      logger,
      getShutdown: () => shutdown,
      exitProcess,
    });
    exit(1);

    expect(shutdown).toHaveBeenCalledWith('gateway-watchdog-selfheal', 1);
    // The one shutdown owns the exit; this callback must never exit on its own
    // when the lifecycle is wired, or the two paths race again.
    expect(exitProcess).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('resolves the shutdown at fire time, not at build time (late binding)', () => {
    const { logger } = makeLogger();
    const shutdown = vi.fn<LifecycleShutdown>().mockResolvedValue(undefined);
    // Mirrors the entrypoint's holder, populated after the watchdog is wired.
    const holder: { shutdown?: LifecycleShutdown } = {};
    const exitProcess = vi.fn();

    // Built while the reference is still undefined — the entrypoint's real order.
    const exit = buildWatchdogSelfHealExit({
      logger,
      getShutdown: () => holder.shutdown,
      exitProcess,
    });
    holder.shutdown = shutdown;
    exit(1);

    expect(shutdown).toHaveBeenCalledWith('gateway-watchdog-selfheal', 1);
    expect(exitProcess).not.toHaveBeenCalled();
  });

  it('exits directly with the code when no lifecycle shutdown is registered yet', () => {
    const { logger, error } = makeLogger();
    const exitProcess = vi.fn();

    const exit = buildWatchdogSelfHealExit({
      logger,
      getShutdown: () => undefined,
      exitProcess,
    });
    exit(1);

    expect(exitProcess).toHaveBeenCalledWith(1);
    expect(exitProcess).not.toHaveBeenCalledWith(0);
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ code: 1 }), expect.any(String));
  });

  it('logs and still exits non-zero if the lifecycle shutdown rejects, without an unhandled rejection', async () => {
    const { logger, error } = makeLogger();
    const shutdownError = new Error('dispose blew up');
    const shutdown = vi.fn<LifecycleShutdown>().mockRejectedValue(shutdownError);
    const exitProcess = vi.fn();

    const exit = buildWatchdogSelfHealExit({
      logger,
      getShutdown: () => shutdown,
      exitProcess,
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
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ err: shutdownError }),
      expect.any(String)
    );
    expect(exitProcess).toHaveBeenCalledWith(1);
    expect(exitProcess).not.toHaveBeenCalledWith(0);
  });
});
