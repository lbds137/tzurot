import type { createLogger } from '@tzurot/common-types/utils/logger';

type Logger = ReturnType<typeof createLogger>;

/** Minimal shape of a timer handle this helper needs — only `unref`. */
interface UnreffableTimer {
  unref: () => void;
}

interface WatchdogExitOptions {
  logger: Logger;
  /** Backstop deadline for a dispose step that never settles. */
  hardExitMs?: number;
  /** Injected so tests never fire a real process exit. */
  exitProcess?: (code: number) => void;
  /** Injected so tests drive the backstop without a real timer. */
  setTimeoutFn?: (handler: () => void, ms: number) => UnreffableTimer;
  clearTimeoutFn?: (timer: UnreffableTimer) => void;
}

const DEFAULT_HARD_EXIT_MS = 10_000;

/**
 * Builds the `exit` callback GatewayWatchdog invokes on a self-heal wedge:
 * dispose the bot client, then exit with the watchdog's non-zero code.
 *
 * The exit code is never 0 on any path — including a dispose that rejects or
 * a dispose that never settles — because the platform restarts the process
 * only on a non-zero exit; a 0 here would leave the bot cleanly stopped
 * instead of restarted. That is a deliberate departure from graceful
 * shutdown's own success path (`registerProcessLifecycle`'s `shutdown()`,
 * which exits 0 on a clean dispose): this callback exists specifically for
 * the watchdog's forced-restart case, not a graceful stop. Pinned by
 * `buildWatchdogExit.test.ts`.
 *
 * The once-guard below covers only repeated calls to THIS callback (e.g. two
 * watchdog arms firing back to back); it does not coordinate with a
 * concurrent SIGTERM-triggered dispose running through
 * `registerProcessLifecycle` — `disposeBotClient` itself has no re-entry
 * guard of its own.
 */
export function buildWatchdogExit(
  dispose: () => Promise<void>,
  options: WatchdogExitOptions
): (code: number) => void {
  const { logger } = options;
  const hardExitMs = options.hardExitMs ?? DEFAULT_HARD_EXIT_MS;
  const exitProcess = options.exitProcess ?? ((code: number) => process.exit(code));
  const setTimeoutFn =
    options.setTimeoutFn ?? ((handler: () => void, ms: number) => setTimeout(handler, ms));
  const clearTimeoutFn =
    options.clearTimeoutFn ?? ((timer: UnreffableTimer) => clearTimeout(timer as NodeJS.Timeout));

  let disposeStarted = false;

  return (code: number): void => {
    if (disposeStarted) {
      logger.warn(
        { code },
        'Watchdog exit callback invoked again while a prior exit was already in flight'
      );
      return;
    }
    disposeStarted = true;

    const timer = setTimeoutFn(() => {
      logger.error(
        { hardExitMs, code },
        'Watchdog exit dispose step exceeded its hard-exit backstop — exiting anyway'
      );
      exitProcess(code);
    }, hardExitMs);
    timer.unref();

    // Driven as a self-contained async IIFE so a rejecting dispose is always
    // caught here and never escapes as an unhandled rejection.
    void (async (): Promise<void> => {
      try {
        await dispose();
        clearTimeoutFn(timer);
        exitProcess(code);
      } catch (err: unknown) {
        clearTimeoutFn(timer);
        logger.error({ err }, 'Watchdog exit dispose step failed — exiting anyway');
        exitProcess(code);
      }
    })();
  };
}
