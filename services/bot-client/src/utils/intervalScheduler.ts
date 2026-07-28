/**
 * Interval-scheduler factory — the shared skeleton of bot-client's periodic
 * background checks (verification cleanup, secret-rotation nag, retention nag).
 *
 * The shape every consumer shares: a guarded start (no double-scheduling), a
 * recurring `setInterval` run, one startup run after a short delay (bot-client
 * restarts on every deploy, so the startup run is what makes daily checks
 * restart-friendly — restarts make them fire more often, never less), and a
 * stop that clears BOTH timers. Clearing the startup timer matters: without it,
 * a shutdown inside the startup-delay window leaves a stray one-shot check
 * firing after the scheduler was told to stop.
 *
 * Deliberately `setInterval`-based: bot-client is single-instance, and these
 * are idempotent checks. If bot-client ever scales past one replica, this
 * factory is the single seam to swap for BullMQ repeatable jobs (see
 * 04-discord.md § Timer Patterns).
 */

import type { createLogger } from '@tzurot/common-types/utils/logger';

type Logger = ReturnType<typeof createLogger>;

export interface IntervalSchedulerOptions<Args extends unknown[]> {
  intervalMs: number;
  /** Delay before the one startup run. */
  startupDelayMs: number;
  /**
   * The consumer's own named logger — it carries the scheduler's identity in
   * every start/stop/already-running line, so the factory needs no label.
   */
  logger: Logger;
  /**
   * One check cycle. Must swallow its own errors — the scheduler fires it
   * unawaited, so a rejection here would surface as an unhandled rejection.
   */
  run: (...args: Args) => Promise<void>;
}

export interface IntervalScheduler<Args extends unknown[]> {
  /** Idempotent while running: a second call warns and does nothing. */
  start: (...args: Args) => void;
  /** Safe to call when not running. Clears the recurring AND startup timers. */
  stop: () => void;
}

export function createIntervalScheduler<Args extends unknown[]>(
  options: IntervalSchedulerOptions<Args>
): IntervalScheduler<Args> {
  const { intervalMs, startupDelayMs, logger, run } = options;
  let interval: ReturnType<typeof setInterval> | null = null;
  let startupTimeout: ReturnType<typeof setTimeout> | null = null;
  let inFlight = false;

  // A run cycle outlasting intervalMs must not overlap the next tick — the
  // consumers are idempotent but not reentrant (a slow DB call under one
  // cycle would stack a second identical cycle on top). Skip-and-log keeps
  // the cadence honest: the next tick after the long run completes picks up.
  // The flag deliberately survives stop(): it guards the RUN, not the
  // scheduler generation — a stop-then-restart while a run is still executing
  // must keep skipping until that run resolves, or the restart reintroduces
  // exactly the overlap this guard exists to prevent.
  const guardedRun = async (...args: Args): Promise<void> => {
    if (inFlight) {
      logger.warn('Previous run still in flight — skipping this tick');
      return;
    }
    inFlight = true;
    try {
      await run(...args);
    } finally {
      inFlight = false;
    }
  };

  return {
    start(...args: Args): void {
      if (interval !== null) {
        logger.warn('Scheduler already running');
        return;
      }

      interval = setInterval(() => {
        void guardedRun(...args);
      }, intervalMs);

      startupTimeout = setTimeout(() => {
        startupTimeout = null;
        void guardedRun(...args);
      }, startupDelayMs);

      logger.info({ intervalHours: intervalMs / (60 * 60 * 1000) }, 'Scheduler started');
    },

    stop(): void {
      if (startupTimeout !== null) {
        clearTimeout(startupTimeout);
        startupTimeout = null;
      }
      if (interval !== null) {
        clearInterval(interval);
        interval = null;
        logger.info('Scheduler stopped');
      }
    },
  };
}
