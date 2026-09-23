/**
 * Startup-run flag + single retry timer for the owner-channel schedulers'
 * deploy-window retry.
 *
 * `createIntervalScheduler` (`@tzurot/common-types/utils/intervalScheduler`)
 * cannot provide this on its own: its `run` option must swallow its own
 * errors (the scheduler fires it unawaited), so the factory itself never
 * observes a failure and has nothing to key a retry decision on. This module
 * holds the two pieces of state a caller needs to build that behavior on top:
 * a one-shot "this is the startup run" flag, and the single pending retry
 * timer.
 *
 * The scheduled retry runs OUTSIDE `createIntervalScheduler`'s in-flight
 * guard — it calls the scheduler's check function directly rather than going
 * through `start()`'s `guardedRun`, so it can overlap a regular interval
 * tick. Each caller documents, at its own `schedule()` call site, why that
 * overlap is harmless for its own cadence (the retry fires long before the
 * next tick, or the two share a cooldown that serializes them).
 */

/** How long to wait before retrying a startup run that failed because the gateway wasn't ready yet. */
export const STARTUP_RETRY_DELAY_MS = 5 * 60 * 1000;

export interface StartupRetry {
  /**
   * Arms the startup flag. A no-op while already armed-or-running (the
   * double-start guard): only the first call after construction or reset()
   * arms it.
   */
  arm(): void;
  /**
   * True exactly once per arm() — for the first run after it — then false
   * until the next reset()+arm(). This "first run after arm() is the
   * startup run" classification relies on the caller's `startupDelayMs`
   * firing before its first `intervalMs` tick — true while `startupDelayMs`
   * stays far below `intervalMs`.
   */
  consume(): boolean;
  /**
   * Schedules the single retry after STARTUP_RETRY_DELAY_MS, replacing
   * (clearing) any retry already pending. The callback must swallow its own
   * errors (same contract as createIntervalScheduler's run); it is invoked
   * as `void retry()`. A no-op if reset() has already run (never armed, or
   * armed-then-reset) — so a stop that lands while the startup run's gateway
   * call is still in flight wins over a schedule() that resolves afterward.
   */
  schedule(retry: () => Promise<void>): void;
  /** Clears a pending retry timer and the flag, and re-allows arm(). Call from the scheduler's stop(). */
  reset(): void;
}

export function createStartupRetry(): StartupRetry {
  let running = false;
  let pending = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  return {
    arm(): void {
      if (running) {
        return;
      }
      running = true;
      pending = true;
    },

    consume(): boolean {
      const was = pending;
      pending = false;
      return was;
    },

    schedule(retry: () => Promise<void>): void {
      if (!running) {
        return;
      }
      if (timer !== null) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => {
        timer = null;
        void retry();
      }, STARTUP_RETRY_DELAY_MS);
    },

    reset(): void {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      pending = false;
      running = false;
    },
  };
}
