/**
 * Structured logging for Discord gateway shard lifecycle events.
 *
 * Without these listeners a dead or zombied gateway websocket is invisible: the process stays
 * up, the logs go quiet, and every interaction silently vanishes. Each handler below is a
 * synchronous log call — no async work, so nothing here can delay the gateway event loop.
 *
 * Fields are deliberately non-identifying: shard ids, websocket close codes, and counts only.
 *
 * Payload order is NOT uniform across these events: shardDisconnect and shardError pass their
 * close-event / error object FIRST and the shard id second, while the other four lead with the
 * shard id. Check the discord.js ClientEvents typings before adding an event here. Swapping the
 * two is only caught by the compiler where a property is read off the payload (closeEvent.code
 * on a number errors); where the value is merely forwarded into the log object it type-checks
 * fine, and the result is an Error silently logged as a shard id.
 */
import { type Client, Events } from 'discord.js';
import type { createLogger } from '@tzurot/common-types/utils/logger';

type Logger = ReturnType<typeof createLogger>;

/**
 * Registers structured logging for every shard-lifecycle event the client emits.
 *
 * Call once from the composition root, alongside the other client-event registrations.
 */
export function registerShardLifecycleLogging(client: Client, logger: Logger): void {
  client.on(Events.ShardDisconnect, (closeEvent, shardId) => {
    logger.warn({ shardId, code: closeEvent.code }, 'Shard disconnected from gateway');
  });

  client.on(Events.ShardReconnecting, shardId => {
    logger.info({ shardId }, 'Shard reconnecting');
  });

  client.on(Events.ShardResume, (shardId, replayedEvents) => {
    logger.info({ shardId, replayedEvents }, 'Shard resumed');
  });

  client.on(Events.ShardReady, (shardId, unavailableGuilds) => {
    // Log only the SIZE — the set holds guild ids, which don't belong in logs.
    logger.info({ shardId, unavailableGuildCount: unavailableGuilds?.size ?? 0 }, 'Shard ready');
  });

  client.on(Events.ShardError, (error, shardId) => {
    logger.error({ err: error, shardId }, 'Shard websocket error');
  });

  client.on(Events.Invalidated, () => {
    logger.error({}, 'Discord session invalidated — the client will not reconnect');
  });
}
