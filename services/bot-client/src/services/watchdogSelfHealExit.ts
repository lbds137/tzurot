import type { createLogger } from '@tzurot/common-types/utils/logger';

type Logger = ReturnType<typeof createLogger>;

/** The shutdown returned by `registerProcessLifecycle`, resolved when the watchdog fires. */
export type LifecycleShutdown = (trigger?: string, successExitCode?: number) => Promise<void>;

interface WatchdogSelfHealExitOptions {
  logger: Logger;
  /**
   * Resolves the process-lifecycle shutdown at fire time. Late-bound because
   * the watchdog is wired earlier in the entrypoint than the lifecycle is
   * registered, so the reference does not exist yet at wiring time.
   */
  getShutdown: () => LifecycleShutdown | undefined;
  /** Injected so tests never fire a real process exit. */
  exitProcess?: (code: number) => void;
}

/**
 * Builds the `exit` callback GatewayWatchdog invokes on a self-heal wedge.
 *
 * It routes into `registerProcessLifecycle`'s single shutdown and hands the
 * watchdog's code through as that shutdown's clean-dispose exit code. Two
 * things follow, both pinned by `watchdogSelfHealExit.test.ts` together with
 * `processLifecycle.test.ts`: the self-heal and a concurrent SIGTERM share one
 * re-entry guard instead of running dispose behind two guards blind to each
 * other, and the platform — which restarts only on a non-zero exit — still
 * sees a failure rather than graceful shutdown's own 0.
 */
export function buildWatchdogSelfHealExit(
  options: WatchdogSelfHealExitOptions
): (code: number) => void {
  const { logger, getShutdown } = options;
  const exitProcess = options.exitProcess ?? ((code: number) => process.exit(code));

  return (code: number): void => {
    const shutdown = getShutdown();
    if (shutdown !== undefined) {
      // That shutdown exits on every one of its own paths (pinned by
      // processLifecycle.test.ts), so the catch is belt-and-braces: without it
      // a floating rejection here would surface as an unhandled rejection
      // instead of ending the wedged process.
      void shutdown('gateway-watchdog-selfheal', code).catch((err: unknown) => {
        logger.error({ err }, 'Watchdog self-heal shutdown rejected — exiting anyway');
        exitProcess(code);
      });
      return;
    }
    // Defensive arm: the watchdog defers every exit behind a 30-minute
    // min-uptime gate (WATCHDOG_THRESHOLDS.MIN_UPTIME_BEFORE_EXIT_MS) while the
    // entrypoint registers the lifecycle during module evaluation, so this is
    // not expected to be reachable in the running service. It still exits
    // non-zero rather than leaving a wedged process alive.
    logger.error(
      { code },
      'Watchdog fired before the process lifecycle was registered — exiting directly'
    );
    exitProcess(code);
  };
}
