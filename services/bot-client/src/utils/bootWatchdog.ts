/**
 * A hung boot is invisible to both of the process's own reporting paths: the
 * error-channel reporter needs a logged-in Discord client to post to, so a
 * boot that never reaches login has no way to report itself, and the platform
 * marks the deploy successful once the process has started, so a process that
 * never finishes starting still reads as healthy. Arming a deadline that exits
 * nonzero turns a silent hang into a platform restart, which at least recovers
 * service even though it can't explain why the previous attempt stalled.
 */

import { createLogger } from '@tzurot/common-types/utils/logger';

const logger = createLogger('BootWatchdog');

// A healthy boot reaches "ready" in seconds; this is a generous ceiling to
// catch a boot that never completes.
const BOOT_DEADLINE_MS = 5 * 60 * 1000;

/**
 * The named boot milestones, as a literal union so a typo at a call site is a
 * compile error instead of a silently wrong phase name in the one log line
 * this module exists to produce.
 */
export type BootPhase =
  | 'commands-deployed'
  | 'commands-loaded'
  | 'services-initialized'
  | 'gateway-health-checked'
  | 'logged-in';

export interface BootWatchdog {
  /** Record the most recently completed boot phase, for the deadline log. */
  notePhase(phase: BootPhase): void;
  /** Cancel the deadline once boot has completed. Safe to call more than once. */
  disarm(): void;
}

export function armBootWatchdog(options?: {
  deadlineMs?: number;
  exit?: (code: number) => void;
}): BootWatchdog {
  const deadlineMs = options?.deadlineMs ?? BOOT_DEADLINE_MS;
  const exit = options?.exit ?? ((code: number) => process.exit(code));

  // Always a string, even if the deadline fires before the first phase is noted.
  let lastPhase: BootPhase | 'armed' = 'armed';

  // Deliberately not unref'd: the deadline is the only thing that can end a
  // hung boot, so it stays a live handle for the whole boot window.
  //
  // The error line below relies on pino writing to stdout SYNCHRONOUSLY (the
  // default, no-transport destination): exit() follows it with no flush, so an
  // async transport (e.g. ENABLE_PRETTY_LOGS routing through a worker thread)
  // could terminate the process before the one log line this module exists to
  // produce is flushed. If the logger ever grows an async transport in
  // production, this exit needs a flush-then-exit sequence.
  let timer: NodeJS.Timeout | undefined = setTimeout(() => {
    timer = undefined;
    logger.error(
      { lastPhase, deadlineMs },
      'Boot deadline exceeded — exiting so the platform restart policy can recover'
    );
    exit(1);
  }, deadlineMs);

  return {
    notePhase(phase: BootPhase): void {
      lastPhase = phase;
    },
    disarm(): void {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    },
  };
}
