/**
 * Boot-recovery timeout wrapper.
 *
 * Both startup recovery passes — `MultiTagRecovery` and `SingleJobRecovery` —
 * re-fetch Discord channels and messages, and discord.js applies no per-call
 * timeout to those. If Discord's API is degraded during a restart (exactly
 * when recovery matters most) an unbounded pass would stall startup, and
 * `ResultsListener` would never attach: the bot would accept Discord events
 * while being unable to deliver a single AI result.
 *
 * Capping each pass bounds that worst case. A pass that loses the race is NOT
 * cancelled — it keeps running in the background — so callers that must
 * compensate for a half-finished pass do so in their own failure branch.
 */

import { createLogger } from '@tzurot/common-types/utils/logger';

const logger = createLogger('BootRecovery');

/**
 * Overall cap for one recovery pass. 30s leaves ample room for 20+ entries at
 * normal Discord latency while bounding a degraded-API restart.
 */
export const RECOVERY_TIMEOUT_MS = 30_000;

/**
 * Run one recovery pass under `timeoutMs`, logging its stats on success.
 *
 * Returns the pass's stats, or `null` when it threw or timed out — never
 * rethrows, because a failed recovery must not abort startup. Unrecovered
 * entries keep their Redis state and are retried on the next boot.
 */
export async function runBootRecovery<T extends object>(
  label: string,
  run: () => Promise<T>,
  timeoutMs: number = RECOVERY_TIMEOUT_MS
): Promise<T | null> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const stats = await Promise.race([
      run(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} exceeded ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
    // Widened to a concrete record before logging: pino's overloads can't
    // resolve their "is this a string?" conditional against an unresolved
    // generic. Kept flat (not nested under `stats`) so the per-pass counters
    // stay greppable as top-level fields, as they were before this wrapper.
    const fields: Record<string, unknown> = { pass: label, ...stats };
    logger.info(fields, 'Boot recovery pass finished');
    return stats;
  } catch (err) {
    logger.error(
      { err, pass: label },
      'Boot recovery pass failed — continuing startup; entries will retry next restart'
    );
    return null;
  } finally {
    // Without this the timer keeps the event loop alive for the full window
    // after a fast success — a 30s delay on every clean boot's shutdown path.
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}
