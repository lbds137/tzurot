/**
 * Start gateway-fed BullMQ workers only once the Discord client is ready.
 *
 * discord.js sets the REST token inside `client.login()` and emits
 * `Events.ClientReady` from its WebSocketManager (`isReady()` is gateway
 * status Ready), so ClientReady is the one signal that both token and
 * session exist. Workers are constructed with `autorun: false` at service creation
 * (which runs before `client.login`), so a job that BullMQ pulls off the
 * queue before this gate fires would run against a client with no usable
 * session, failing every DM. This module is the ready gate: it starts each
 * worker's run loop once, either immediately if the client is already ready
 * or on the next `Events.ClientReady` fire.
 */
import { Events, type Client } from 'discord.js';
import type { Worker } from 'bullmq';
import { createLogger } from '@tzurot/common-types/utils/logger';

const logger = createLogger('DmWorkerReadyGate');

function startWorker(worker: Worker): void {
  if (worker.isRunning()) {
    return;
  }
  // run() resolves only when the worker closes, so it is not awaited.
  worker.run().catch((err: unknown) => {
    logger.error({ err, queue: worker.name }, 'DM worker run loop failed');
  });
  logger.info({ queue: worker.name }, 'DM worker started (Discord client ready)');
}

/**
 * Starts every worker once the Discord client reaches ClientReady — either
 * immediately (client already ready) or via a one-shot listener.
 */
export function startWorkersOnClientReady(client: Client, workers: readonly Worker[]): void {
  if (client.isReady()) {
    workers.forEach(startWorker);
    return;
  }
  client.once(Events.ClientReady, () => {
    workers.forEach(startWorker);
  });
}
