/**
 * z.ai business-code classifier + free-tier reactions.
 *
 * z.ai multiplexes distinct conditions onto HTTP 429 plus a JSON `code`
 * field (verified against z.ai's own client tooling):
 *
 *   busy      1302/1305/1313        — transient concurrency/rate pressure
 *   exhausted 1308/1310/1316–1321   — the 5h or weekly window is spent;
 *                                     retrying before its reset is futile
 *   account   1113/1309             — arrears/disabled; NEVER retry into it
 *
 * The generic `parseApiError` HTTP-status classification stays authoritative
 * for retry/fallback semantics (extraction's delay path deliberately treats
 * all of these as BUSY). This module adds the free-tier REACTIONS on top:
 * window exhaustion closes admission until the window resets, and account
 * problems trip the kill switch so guest traffic stops hammering a broken
 * plan. Both are read by `ZaiFreeTierAdmission`.
 */

import type { Redis } from 'ioredis';
import {
  ZAI_FREE_TIER_KILL_SWITCH_KEY,
  ZAI_FREE_TIER_EXHAUSTED_KEY,
} from '@tzurot/common-types/constants/redis-keys';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { ZaiPlanMeter } from './ZaiPlanMeter.js';

const logger = createLogger('ZaiBusinessCodes');

export type ZaiBusinessClass = 'busy' | 'window-exhausted' | 'account-problem';

const BUSY_CODES = new Set([1302, 1305, 1313]);
const WINDOW_EXHAUSTED_CODES = new Set([1308, 1310, 1316, 1317, 1318, 1319, 1320, 1321]);
const ACCOUNT_PROBLEM_CODES = new Set([1113, 1309]);

/** Fallback cooldown when neither the error nor the meter names a reset time. */
const DEFAULT_EXHAUSTED_COOLDOWN_SECONDS = 30 * 60;
/** Bound a reset-derived TTL so a bogus far-future timestamp can't wedge the tier. */
const MAX_EXHAUSTED_COOLDOWN_SECONDS = 8 * 60 * 60;

/**
 * Extract z.ai's business `code` from an error whose message carries the
 * response body (the LangChain/OpenAI client folds the JSON body into the
 * error message). Anchored to the `"code":` field shape so unrelated numbers
 * can't false-match, with a digit boundary so a future longer code is
 * IGNORED (null → no reaction) rather than misread by its 4-digit prefix.
 */
export function classifyZaiBusinessError(error: unknown): ZaiBusinessClass | null {
  const message = error instanceof Error ? error.message : String(error);
  const match = /"code"\s*:\s*"?(\d{4})(?!\d)"?/.exec(message);
  if (match === null) {
    return null;
  }
  const code = Number(match[1]);
  if (BUSY_CODES.has(code)) {
    return 'busy';
  }
  if (WINDOW_EXHAUSTED_CODES.has(code)) {
    return 'window-exhausted';
  }
  if (ACCOUNT_PROBLEM_CODES.has(code)) {
    return 'account-problem';
  }
  return null;
}

/**
 * React to a z.ai failure on the FREE-TIER path (never called for BYOK z.ai
 * traffic — a user's own plan state is theirs). Window exhaustion closes
 * admission until the plan window resets (meter-derived when available);
 * an account problem trips the kill switch (no TTL — manual DEL after the
 * owner fixes the plan). Fail-soft: a Redis error only logs — the request's
 * own degrade path is not disturbed.
 */
export async function reactToZaiFreeTierFailure(
  redis: Redis,
  meter: ZaiPlanMeter,
  error: unknown
): Promise<void> {
  const businessClass = classifyZaiBusinessError(error);
  if (businessClass === null || businessClass === 'busy') {
    return;
  }
  try {
    if (businessClass === 'account-problem') {
      await redis.set(ZAI_FREE_TIER_KILL_SWITCH_KEY, new Date().toISOString());
      logger.error(
        { err: error },
        'z.ai account problem (arrears/disabled) — free-tier KILL SWITCH set; fix the plan then DEL zaifreeq:killswitch'
      );
      return;
    }

    const reading = await meter.getReading();
    const msUntilReset =
      reading?.resetAt !== null && reading?.resetAt !== undefined
        ? reading.resetAt.getTime() - Date.now()
        : null;
    const ttlSeconds =
      msUntilReset !== null && msUntilReset > 0
        ? Math.min(Math.ceil(msUntilReset / 1000), MAX_EXHAUSTED_COOLDOWN_SECONDS)
        : DEFAULT_EXHAUSTED_COOLDOWN_SECONDS;
    await redis.set(ZAI_FREE_TIER_EXHAUSTED_KEY, new Date().toISOString(), 'EX', ttlSeconds);
    logger.warn(
      { ttlSeconds, resetAt: reading?.resetAt?.toISOString() },
      'z.ai plan window exhausted — free tier closed until the window resets'
    );
  } catch (redisError) {
    logger.warn({ err: redisError }, 'Failed to record z.ai free-tier failure reaction');
  }
}
