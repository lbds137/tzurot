import { describe, it, expect, beforeEach, vi } from 'vitest';
import { type Client, Events } from 'discord.js';
import { registerShardLifecycleLogging } from './ShardLifecycleLogger.js';

type Handler = (...args: unknown[]) => void;

describe('registerShardLifecycleLogging', () => {
  let handlers: Map<string, Handler>;
  let client: Client;
  let logger: {
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };

  /** Invokes the handler registered for `event`, failing loudly if none was registered. */
  function emit(event: string, ...args: unknown[]): void {
    const handler = handlers.get(event);
    if (handler === undefined) {
      throw new Error(`No handler registered for ${event}`);
    }
    handler(...args);
  }

  beforeEach(() => {
    handlers = new Map();
    const on = vi.fn((event: string, handler: Handler) => {
      handlers.set(event, handler);
    });
    client = { on } as unknown as Client;
    logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    registerShardLifecycleLogging(
      client,
      logger as unknown as Parameters<typeof registerShardLifecycleLogging>[1]
    );
  });

  it('registers a handler for every shard-lifecycle event', () => {
    expect([...handlers.keys()].sort()).toEqual(
      [
        Events.ShardDisconnect,
        Events.ShardReconnecting,
        Events.ShardResume,
        Events.ShardReady,
        Events.ShardError,
        Events.Invalidated,
      ].sort()
    );
  });

  it('logs a warning with shardId and close code on shard disconnect', () => {
    emit(Events.ShardDisconnect, { code: 4004, reason: 'auth failed', wasClean: false }, 3);

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      { shardId: 3, code: 4004 },
      'Shard disconnected from gateway'
    );
  });

  it('logs an info with shardId on shard reconnecting', () => {
    emit(Events.ShardReconnecting, 1);

    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith({ shardId: 1 }, 'Shard reconnecting');
  });

  it('logs an info with shardId and replayedEvents on shard resume', () => {
    emit(Events.ShardResume, 2, 17);

    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith({ shardId: 2, replayedEvents: 17 }, 'Shard resumed');
  });

  it('logs an info with the unavailable-guild COUNT (never ids) on shard ready', () => {
    emit(Events.ShardReady, 0, new Set(['111111111111111111', '222222222222222222']));

    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      { shardId: 0, unavailableGuildCount: 2 },
      'Shard ready'
    );
    // The guild ids themselves must never reach the log payload.
    expect(JSON.stringify(logger.info.mock.calls[0])).not.toContain('111111111111111111');
  });

  it('logs unavailableGuildCount 0 when shard ready reports no unavailable guilds', () => {
    emit(Events.ShardReady, 4, undefined);

    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      { shardId: 4, unavailableGuildCount: 0 },
      'Shard ready'
    );
  });

  it('logs an error with the error under `err` on shard error', () => {
    const error = new Error('websocket exploded');

    emit(Events.ShardError, error, 5);

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith({ err: error, shardId: 5 }, 'Shard websocket error');
  });

  it('logs an error stating the client will not reconnect on session invalidation', () => {
    emit(Events.Invalidated);

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      {},
      'Discord session invalidated — the client will not reconnect'
    );
  });
});
