/**
 * Tests for the Discord-ClientReady gate that starts the DM workers — the
 * seam that fixes the boot-race where a queued job ran before the client had
 * a usable session (every DM failed as failed_transient).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { Events, type Client } from 'discord.js';
import type { Worker } from 'bullmq';

const mockLogger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));
vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => mockLogger,
  };
});

const { startWorkersOnClientReady } = await import('./dmWorkerReadyGate.js');

function makeClient(isReady: boolean): Client & EventEmitter {
  const emitter = new EventEmitter();
  return Object.assign(emitter, { isReady: vi.fn(() => isReady) }) as unknown as Client &
    EventEmitter;
}

function makeWorker(name: string, runImpl?: () => Promise<void>): Worker {
  return {
    name,
    isRunning: vi.fn(() => false),
    run: vi.fn(runImpl ?? (() => new Promise<void>(() => {}))),
  } as unknown as Worker;
}

describe('startWorkersOnClientReady', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not start workers before ClientReady, then starts both on the event', () => {
    const client = makeClient(false);
    const workerA = makeWorker('queue-a');
    const workerB = makeWorker('queue-b');

    startWorkersOnClientReady(client, [workerA, workerB]);

    expect(workerA.run).not.toHaveBeenCalled();
    expect(workerB.run).not.toHaveBeenCalled();

    client.emit(Events.ClientReady, client);

    expect(workerA.run).toHaveBeenCalledTimes(1);
    expect(workerB.run).toHaveBeenCalledTimes(1);
  });

  it('starts both workers immediately when the client is already ready, leaving no listener', () => {
    const client = makeClient(true);
    const workerA = makeWorker('queue-a');
    const workerB = makeWorker('queue-b');

    startWorkersOnClientReady(client, [workerA, workerB]);

    expect(workerA.run).toHaveBeenCalledTimes(1);
    expect(workerB.run).toHaveBeenCalledTimes(1);
    expect(client.listenerCount(Events.ClientReady)).toBe(0);
  });

  it('does not re-run a worker that is already running', () => {
    const client = makeClient(true);
    const worker = {
      name: 'queue-a',
      isRunning: vi.fn(() => true),
      run: vi.fn(),
    } as unknown as Worker;

    startWorkersOnClientReady(client, [worker]);

    expect(worker.run).not.toHaveBeenCalled();
  });

  it('logs a rejected run loop', async () => {
    const client = makeClient(false);
    const failing = makeWorker('queue-fail', () => Promise.reject(new Error('boom')));

    startWorkersOnClientReady(client, [failing]);
    client.emit(Events.ClientReady, client);
    await vi.runAllTimersAsync();

    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) as Error, queue: 'queue-fail' }),
      'DM worker run loop failed'
    );
  });
});
