/**
 * Tests for registerProcessLifecycle.
 *
 * process.on / process.exit are spied (never real): exit throws a sentinel so
 * code after an exit point can't run, and handlers are captured from the spy
 * and invoked directly.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Logger } from 'pino';
import { registerProcessLifecycle, type RejectionPolicy } from './processLifecycle.js';

class ExitSentinel extends Error {
  constructor(public readonly code: number | undefined) {
    super(`process.exit(${code})`);
  }
}

function makeLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    debug: vi.fn(),
  } as unknown as Logger;
}

describe('registerProcessLifecycle', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let onSpy: ReturnType<typeof vi.spyOn>;
  let logger: Logger;

  beforeEach(() => {
    vi.useFakeTimers();
    logger = makeLogger();
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new ExitSentinel(code);
    }) as never);
    onSpy = vi.spyOn(process, 'on').mockImplementation((() => process) as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function register(opts: { dispose?: () => Promise<void>; policy?: RejectionPolicy } = {}): {
    shutdown: () => Promise<void>;
    handlers: Map<string, (arg?: unknown) => void>;
    dispose: ReturnType<typeof vi.fn>;
  } {
    const dispose = vi.fn(opts.dispose ?? (() => Promise.resolve()));
    const { shutdown } = registerProcessLifecycle({
      logger,
      dispose,
      rejectionPolicy: opts.policy ?? 'shutdown',
    });
    const handlers = new Map<string, (arg?: unknown) => void>();
    for (const [event, handler] of onSpy.mock.calls as [string, (arg?: unknown) => void][]) {
      handlers.set(event, handler);
    }
    return { shutdown, handlers, dispose };
  }

  it('registers all four process handlers', () => {
    const { handlers } = register();
    expect([...handlers.keys()].sort()).toEqual([
      'SIGINT',
      'SIGTERM',
      'uncaughtException',
      'unhandledRejection',
    ]);
  });

  it('logs which trigger initiated the shutdown (SIGTERM vs SIGINT is deploy-debugging signal)', async () => {
    const { handlers } = register();
    exitSpy.mockImplementation((() => undefined) as never);

    handlers.get('SIGTERM')?.();
    await vi.runAllTimersAsync();

    expect(logger.info).toHaveBeenCalledWith({ trigger: 'SIGTERM' }, 'Shutting down gracefully...');
  });

  it('runs dispose then exits 0 on clean shutdown', async () => {
    const { shutdown, dispose } = register();

    await expect(shutdown()).rejects.toThrow('process.exit(0)');

    expect(dispose).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('exits 1 (not rethrow, not hang) when a dispose step fails', async () => {
    const { shutdown } = register({
      dispose: () => Promise.reject(new Error('redis already closed')),
    });

    await expect(shutdown()).rejects.toThrow('process.exit(1)');

    expect(logger.error).toHaveBeenCalledWith(
      { err: expect.objectContaining({ message: 'redis already closed' }) },
      'Shutdown step failed — exiting'
    );
  });

  it('is re-entrant safe: a second shutdown call returns without running dispose again', async () => {
    // The zombie-loop scenario: dispose rejects, the unhandledRejection handler
    // re-invokes shutdown. The guard makes the second call a no-op instead of
    // an infinite loop.
    let resolveDispose = (): void => {};
    const { shutdown, dispose } = register({
      dispose: () =>
        new Promise<void>(resolve => {
          resolveDispose = resolve;
        }),
    });

    const first = shutdown();
    const second = shutdown(); // guard hits — resolves immediately, no exit

    await expect(second).resolves.toBeUndefined();
    expect(dispose).toHaveBeenCalledTimes(1);

    resolveDispose();
    await expect(first).rejects.toThrow('process.exit(0)');
  });

  it('forces exit 1 via the hard-exit timer when dispose hangs', async () => {
    const { shutdown } = register({
      dispose: () => new Promise<never>(() => {}), // never settles
    });

    const pending = shutdown();
    pending.catch(() => {}); // the sentinel from the timer path

    expect(() => vi.advanceTimersByTime(10_000)).toThrow('process.exit(1)');
    expect(logger.error).toHaveBeenCalledWith(
      { hardExitMs: 10_000 },
      'Shutdown did not complete in time — forcing exit'
    );
  });

  it("uncaughtException with 'shutdown' policy logs fatal under err and runs graceful dispose", async () => {
    const { handlers, dispose } = register({ policy: 'shutdown' });
    const boom = new Error('boom');
    // The handler fire-and-forgets shutdown (`void shutdown()`), so a throwing
    // exit spy would surface as an unhandled rejection — record-only here.
    exitSpy.mockImplementation((() => undefined) as never);

    handlers.get('uncaughtException')?.(boom);
    await vi.runAllTimersAsync();

    expect(logger.fatal).toHaveBeenCalledWith({ err: boom }, 'Uncaught exception');
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("uncaughtException with 'crash' policy exits 1 immediately — NO dispose post-corruption", () => {
    // The process state after an uncaught exception is unsafe to run more
    // application code in; non-'shutdown' policies preserve Node's default
    // crash semantics (a worker must not close BullMQ/Prisma over the corpse).
    const { handlers, dispose } = register({ policy: 'crash' });

    expect(() => handlers.get('uncaughtException')?.(new Error('boom'))).toThrow('process.exit(1)');
    expect(dispose).not.toHaveBeenCalled();
  });

  it("uncaughtException with 'log-and-live' policy ALSO exits — the live-through policy covers rejections only", () => {
    const { handlers, dispose } = register({ policy: 'log-and-live' });

    expect(() => handlers.get('uncaughtException')?.(new Error('boom'))).toThrow('process.exit(1)');
    expect(dispose).not.toHaveBeenCalled();
  });

  describe('rejectionPolicy', () => {
    it("'log-and-live' logs under err and does NOT shut down or exit", () => {
      const { handlers, dispose } = register({ policy: 'log-and-live' });
      const reason = new Error('stray rejection');

      handlers.get('unhandledRejection')?.(reason);

      expect(logger.error).toHaveBeenCalledWith({ err: reason }, 'Unhandled rejection');
      expect(dispose).not.toHaveBeenCalled();
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it("'crash' logs fatal under err then exits 1 without dispose", () => {
      const { handlers, dispose } = register({ policy: 'crash' });
      const reason = new Error('worker rejection');

      expect(() => handlers.get('unhandledRejection')?.(reason)).toThrow('process.exit(1)');

      expect(logger.fatal).toHaveBeenCalledWith({ err: reason }, 'Unhandled rejection');
      expect(dispose).not.toHaveBeenCalled();
    });

    it("'shutdown' logs fatal under err then runs the guarded shutdown", async () => {
      const { handlers, dispose } = register({ policy: 'shutdown' });
      const reason = new Error('gateway rejection');
      // Fire-and-forget shutdown path — record-only exit (see uncaughtException test).
      exitSpy.mockImplementation((() => undefined) as never);

      handlers.get('unhandledRejection')?.(reason);
      await vi.runAllTimersAsync();

      expect(logger.fatal).toHaveBeenCalledWith({ err: reason }, 'Unhandled rejection');
      expect(dispose).toHaveBeenCalledTimes(1);
    });

    it("'shutdown' policy survives a rejection thrown DURING shutdown (no recursion)", async () => {
      // The exact zombie-outage shape: dispose rejects → that rejection is
      // unhandled → the handler fires again mid-shutdown. The guard returns
      // immediately; the original shutdown's catch exits 1. No infinite loop.
      const { shutdown, handlers, dispose } = register({
        policy: 'shutdown',
        dispose: () => Promise.reject(new Error('double-close')),
      });

      const first = shutdown();
      handlers.get('unhandledRejection')?.(new Error('double-close')); // re-entry — guarded no-op

      await expect(first).rejects.toThrow('process.exit(1)');
      expect(dispose).toHaveBeenCalledTimes(1);
    });
  });
});
