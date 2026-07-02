/**
 * Process-lifecycle registration shared by all Node services.
 *
 * Owns the safety rails every entrypoint needs but each service had been
 * hand-rolling divergently: signal/exception/rejection handler registration,
 * a shutdown re-entry guard, a hard-exit backstop timer, and terminal-by-
 * construction exits. Services own only their dispose body — what to close
 * and in what order.
 *
 * Why the rails must be shared and strict: an unguarded shutdown handler
 * wired to `unhandledRejection` can recurse forever when a dispose step
 * itself rejects (the rejection re-triggers the handler), leaving a zombie
 * process — HTTP server closed, event loop alive — that the orchestrator
 * cannot restart because it never dies. Railway heals dead processes, not
 * zombies. See the gateway zombie-outage entry in
 * docs/incidents/PROJECT_POSTMORTEMS.md for the incident that motivated this.
 */

import type { Logger } from 'pino';

/**
 * What to do when an unhandled promise rejection reaches the process level.
 *
 * - `crash`: log with the `err` serializer, then `process.exit(1)` — mirrors
 *   Node's default terminal behavior but guarantees the root cause is logged
 *   in pino's structured format first. Right for job-queue workers where the
 *   orchestrator restarting a dead process is the recovery path and in-flight
 *   jobs are re-queued by lock expiry.
 * - `log-and-live`: log and continue. Right for long-lived clients (Discord
 *   gateway) where a stray rejection in one event handler should not sever
 *   every active session. The trade-off — the process may run in a degraded
 *   state — is accepted deliberately by the service choosing this policy.
 * - `shutdown`: log, then run the guarded shutdown (graceful dispose, then
 *   exit). Right for HTTP services where draining connections matters.
 */
export type RejectionPolicy = 'crash' | 'log-and-live' | 'shutdown';

export interface ProcessLifecycleOptions {
  /** Service logger; rejection/exception reasons log under the `err` key. */
  logger: Logger;
  /**
   * The service's dispose sequence — close servers, workers, pools, sockets.
   * MUST NOT call `process.exit` itself; the wrapper owns all exits so every
   * path is terminal (clean exit 0, dirty exit 1, or forced exit 1 on hang).
   */
  dispose: () => Promise<void>;
  /** How unhandled rejections are treated. See {@link RejectionPolicy}. */
  rejectionPolicy: RejectionPolicy;
  /**
   * Backstop for a dispose step that hangs (never resolves or rejects): a
   * timer armed at shutdown start forces `exit(1)` after this many ms. The
   * timer is unref'd so it cannot itself keep the process alive.
   */
  hardExitMs?: number;
}

const DEFAULT_HARD_EXIT_MS = 10_000;

/**
 * Register SIGTERM/SIGINT/uncaughtException/unhandledRejection handlers with
 * guarded, terminal-by-construction shutdown semantics.
 *
 * Returns the wrapped shutdown so services can also trigger it directly
 * (e.g. from a fatal startup check).
 */
export function registerProcessLifecycle(options: ProcessLifecycleOptions): {
  shutdown: () => Promise<void>;
} {
  const { logger, dispose, rejectionPolicy } = options;
  const hardExitMs = options.hardExitMs ?? DEFAULT_HARD_EXIT_MS;

  // Re-entry guard. Checked-and-set synchronously before any await, so a
  // second signal — or a rejection thrown INSIDE dispose re-entering via the
  // unhandledRejection handler — returns immediately instead of recursing.
  let shuttingDown = false;

  const shutdown = async (trigger?: string): Promise<void> => {
    if (shuttingDown) {
      // Suppressed re-entry is itself a diagnostic: a double-SIGTERM, or a
      // rejection thrown during dispose re-entering via the rejection handler.
      logger.warn({ trigger }, 'Shutdown re-entry suppressed — already shutting down');
      return;
    }
    shuttingDown = true;
    // trigger distinguishes a Railway-initiated SIGTERM from a local SIGINT or
    // an exception-driven shutdown in prod logs (undefined props drop out of
    // pino's JSON, so direct calls log cleanly without it).
    logger.info({ trigger }, 'Shutting down gracefully...');

    const hardExit = setTimeout(() => {
      logger.error({ hardExitMs }, 'Shutdown did not complete in time — forcing exit');
      process.exit(1);
    }, hardExitMs);
    hardExit.unref();

    // The try wraps ONLY dispose — the exit calls sit outside so nothing this
    // function does can be misread as a dispose failure. A failed dispose step
    // must still end the process: exiting dirty is strictly better than living
    // on as a half-shut-down zombie.
    try {
      await dispose();
    } catch (error) {
      clearTimeout(hardExit);
      logger.error({ err: error }, 'Shutdown step failed — exiting');
      process.exit(1);
    }
    clearTimeout(hardExit);
    logger.info('Shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  process.on('uncaughtException', error => {
    logger.fatal({ err: error }, 'Uncaught exception');
    // After an uncaught exception the process state is unsafe to keep running
    // application code in (per Node's own docs) — only the 'shutdown' policy
    // attempts graceful dispose (an HTTP service draining connections accepts
    // that trade-off explicitly). 'crash' and 'log-and-live' services exit
    // immediately: that preserves Node's default exception semantics (with
    // structured err-key logging first), and note 'log-and-live' is a policy
    // about REJECTIONS — an uncaught exception is always process-fatal.
    if (rejectionPolicy === 'shutdown') {
      void shutdown('uncaughtException');
    } else {
      process.exit(1);
    }
  });

  process.on('unhandledRejection', reason => {
    // MUST log under `err` — pino only serializes Errors via the `err`-key
    // serializer; any other key stringifies a real Error to `{}` and loses
    // the root cause exactly when it matters most.
    if (rejectionPolicy === 'log-and-live') {
      logger.error({ err: reason }, 'Unhandled rejection');
      return;
    }
    logger.fatal({ err: reason }, 'Unhandled rejection');
    if (rejectionPolicy === 'crash') {
      process.exit(1);
    } else {
      void shutdown('unhandledRejection');
    }
  });

  return { shutdown };
}
