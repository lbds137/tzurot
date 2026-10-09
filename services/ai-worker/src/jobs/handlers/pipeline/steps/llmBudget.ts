/**
 * Shared LLM job-budget deadline helpers.
 *
 * The three-tier shape, in one module: an attempt runs at most
 * TIMEOUTS.LLM_PER_ATTEMPT, an invocation hop's retry ladder at most
 * TIMEOUTS.LLM_INVOCATION, and the whole job's LLM phase at most
 * TIMEOUTS.LLM_JOB_BUDGET (plus one in-flight attempt of overshoot). Keeps the
 * per-layer pre-hop checks clone-free: each fallback layer gates its hop with
 * `hasBudgetForAttempt` instead of duplicating the arithmetic, and the
 * invoker's entry gate + clamp read the SAME helpers.
 */

import { TIMEOUTS } from '@tzurot/common-types/constants/timing';

/**
 * Stamp the job's absolute LLM-phase deadline: now + TIMEOUTS.LLM_JOB_BUDGET.
 * Called once at GenerationStep entry, before any attempt or fallback hop.
 */
export function stampLlmDeadline(now: number = Date.now()): number {
  return now + TIMEOUTS.LLM_JOB_BUDGET;
}

/**
 * Pre-hop gate: is there budget left for one more full attempt?
 * `undefined` means "no budget stamped" — backward-compat no-op, the hop runs
 * ungated (existing tests and legacy callers keep their behavior).
 */
export function hasBudgetForAttempt(
  deadline: number | undefined,
  now: number = Date.now()
): boolean {
  return deadline === undefined || deadline - now >= TIMEOUTS.LLM_PER_ATTEMPT;
}

/**
 * Remaining job LLM budget in ms, floored at 0. An `undefined` deadline means
 * "no budget stamped" — reported as the full per-hop budget so the clamp
 * caller keeps its legacy unclamped shape.
 */
export function remainingBudgetMs(deadline: number | undefined, now: number = Date.now()): number {
  return deadline === undefined ? TIMEOUTS.LLM_INVOCATION : Math.max(deadline - now, 0);
}

/**
 * The retry budget one invocation hop gets: the full LLM_INVOCATION ceiling
 * clamped to the job deadline's remaining budget. The `Math.max(..., 1)` floor
 * matters: the between-attempts global-timeout check skips a <=0 value, so a
 * spent budget must survive as a 1ms budget that still stops the ladder at the
 * next check.
 */
export function hopRetryBudgetMs(deadline: number | undefined, now: number = Date.now()): number {
  return Math.min(TIMEOUTS.LLM_INVOCATION, Math.max(remainingBudgetMs(deadline, now), 1));
}
