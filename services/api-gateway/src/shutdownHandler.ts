/**
 * Graceful shutdown handler (extracted from index.ts so the dispose ORDER is
 * testable — the drain-before-teardown invariant is load-bearing).
 *
 * Order contract: the HTTP server drains FIRST — `server.close` stops new
 * connections and its callback fires once in-flight requests finish; tearing
 * down Redis/Prisma while requests are mid-response yanks their connections
 * (a shutdown-window failure that opens on every deploy). A stuck keep-alive
 * socket can't hang shutdown: registerProcessLifecycle's 10s hard-exit bounds
 * the whole dispose sequence.
 *
 * The re-entry guard, hard-exit backstop, and terminal exit(0)/exit(1)
 * semantics live in registerProcessLifecycle (common-types), which wraps
 * this. See the gateway zombie-outage entry in docs/incidents/PROJECT_POSTMORTEMS.md.
 */

import { createLogger } from '@tzurot/common-types/utils/logger';

const logger = createLogger('ShutdownHandler');

/** The minimal server surface the handler needs (Express listen() result). */
export interface ClosableServer {
  close(callback: (err?: Error) => void): unknown;
}

/**
 * Every side-effectful teardown step, injected — index.ts wires the real
 * services; tests wire spies and assert the order contract.
 */
export interface ShutdownSteps {
  disposeDeduplicationCache: () => void;
  stopDbNotificationListener: () => Promise<void>;
  unsubscribeCacheInvalidation: () => Promise<void>;
  unsubscribeCascadeInvalidation: () => Promise<void>;
  unsubscribeSystemSettingsInvalidation: () => Promise<void>;
  stopCascadeResolverCleanup: () => void;
  disconnectCacheRedis: () => void;
  shutdownEmbeddingService: () => Promise<void>;
  closeQueue: () => Promise<void>;
  disposePrisma: () => Promise<void>;
}

export function createShutdownHandler(
  server: ClosableServer,
  steps: ShutdownSteps
): () => Promise<void> {
  return async (): Promise<void> => {
    // Drain in-flight HTTP FIRST (see module doc for the order contract).
    await new Promise<void>(resolve => {
      server.close(err => {
        if (err !== undefined) {
          logger.warn({ err }, 'HTTP server close reported an error');
        } else {
          logger.info('HTTP server closed');
        }
        resolve();
      });
    });

    steps.disposeDeduplicationCache();
    logger.info('Request deduplication cache disposed');

    await steps.stopDbNotificationListener();
    logger.info('Database notification listener stopped');

    await steps.unsubscribeCacheInvalidation();
    await steps.unsubscribeCascadeInvalidation();
    await steps.unsubscribeSystemSettingsInvalidation();
    steps.stopCascadeResolverCleanup();
    steps.disconnectCacheRedis();
    logger.info('Cache invalidation services closed');

    await steps.shutdownEmbeddingService();
    logger.info('Embedding service shut down');

    await steps.closeQueue();

    // disposePrisma logs 'Prisma client disconnected' itself — no second line here.
    await steps.disposePrisma();
  };
}
