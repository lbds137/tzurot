import { describe, it, expect, vi } from 'vitest';
import {
  createShutdownHandler,
  type ShutdownSteps,
  type ClosableServer,
} from './shutdownHandler.js';

/** Call-log spies: every step records its name so ORDER is assertable. */
function makeSteps(log: string[]): ShutdownSteps {
  const record =
    (name: string) =>
    (...args: unknown[]): void => {
      void args;
      log.push(name);
    };
  const recordAsync = (name: string) => async (): Promise<void> => {
    log.push(name);
  };
  return {
    disposeDeduplicationCache: vi.fn(record('dedup')),
    stopDbNotificationListener: vi.fn(recordAsync('dbListener')),
    unsubscribeCacheInvalidation: vi.fn(recordAsync('cacheInvalidation')),
    unsubscribeCascadeInvalidation: vi.fn(recordAsync('cascadeInvalidation')),
    unsubscribeSystemSettingsInvalidation: vi.fn(recordAsync('systemSettingsInvalidation')),
    stopCascadeResolverCleanup: vi.fn(record('cascadeCleanup')),
    disconnectCacheRedis: vi.fn(record('redis')),
    shutdownEmbeddingService: vi.fn(recordAsync('embedding')),
    closeQueue: vi.fn(recordAsync('queue')),
    disposePrisma: vi.fn(recordAsync('prisma')),
  };
}

describe('createShutdownHandler', () => {
  it('drains the HTTP server BEFORE any teardown step (the connection-drain contract)', async () => {
    const log: string[] = [];
    // Server whose close callback resolves asynchronously — like real in-flight
    // requests finishing — so a fire-and-forget close would let teardown win.
    // queueMicrotask defers past the synchronous dispose body without a timer.
    const server: ClosableServer = {
      close: (cb: (err?: Error) => void): void => {
        queueMicrotask(() => {
          log.push('serverDrained');
          cb();
        });
      },
    };
    const steps = makeSteps(log);

    await createShutdownHandler(server, steps)();

    // The drain must be strictly FIRST — before Redis/Prisma/queue teardown.
    expect(log[0]).toBe('serverDrained');
    expect(log.indexOf('serverDrained')).toBeLessThan(log.indexOf('redis'));
    expect(log.indexOf('serverDrained')).toBeLessThan(log.indexOf('prisma'));
    // And every step ran exactly once, in the documented sequence.
    expect(log).toEqual([
      'serverDrained',
      'dedup',
      'dbListener',
      'cacheInvalidation',
      'cascadeInvalidation',
      'systemSettingsInvalidation',
      'cascadeCleanup',
      'redis',
      'embedding',
      'queue',
      'prisma',
    ]);
  });

  it('proceeds with teardown even when server.close reports an error', async () => {
    const log: string[] = [];
    const server: ClosableServer = {
      close: (cb: (err?: Error) => void): void => {
        cb(new Error('already closed'));
      },
    };
    const steps = makeSteps(log);

    await createShutdownHandler(server, steps)();

    expect(steps.disposePrisma).toHaveBeenCalledTimes(1);
    expect(log[log.length - 1]).toBe('prisma');
  });
});
