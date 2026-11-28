/**
 * Per-row double-click guard for Reroll.
 *
 * One reroll of a given history row at a time: the first click takes a Redis
 * `SET NX` lock keyed by the row, a second click while it is held is refused.
 * The value is the attempt id, so a release only deletes a lock that is still
 * this attempt's own (a lock that expired and was re-taken by a newer attempt
 * is left alone). The TTL matches the longest a tracked job can live, so a
 * lock orphaned by a restart frees itself.
 *
 * Release is read-then-delete, not atomic: a lock that expires between the two
 * calls could delete a newer attempt's lock. That window is the TTL boundary
 * only, and the cost is a missed double-click refusal; not verified under load.
 */

import type { Redis } from 'ioredis';
import { TRACKED_JOB_MAX_LIFETIME_MS } from '../JobTracker.js';
import { REROLL_BOOT_ID } from './rerollInflight.js';

const LOCK_KEY_PREFIX = 'reroll:lock:';

function lockKey(rowId: string): string {
  return `${LOCK_KEY_PREFIX}${rowId}`;
}

/** Take the row's lock for `attemptId`. False when another attempt holds it. */
export async function acquireRerollGuard(
  redis: Redis,
  rowId: string,
  attemptId: string
): Promise<boolean> {
  const result = await redis.set(
    lockKey(rowId),
    attemptId,
    'PX',
    TRACKED_JOB_MAX_LIFETIME_MS,
    'NX'
  );
  return result === 'OK';
}

/** How a claim on the row's lock for an attempt came out. */
export type GuardClaim =
  /** The lock was free and is now taken for the attempt by this call. */
  | 'acquired'
  /** The lock was already held by that same attempt (a dead handler's own lock). */
  | 'alreadyOurs'
  /** Another attempt holds the lock. */
  | 'held';

/**
 * Take the row's lock on behalf of `attemptId`, counting a lock already held BY
 * that attempt as taken: recovery acts for a dead attempt whose own lock may
 * still be in Redis. The answer says which, so the caller releases only a lock
 * it took itself.
 *
 * The `alreadyOurs` branch gives no exclusion against a live handler of that
 * same attempt (it holds the same lock value, so the claim passes); the minimum
 * record age in `rerollInflight.ts` is the only separation between the two.
 */
export async function claimRerollGuardFor(
  redis: Redis,
  rowId: string,
  attemptId: string
): Promise<GuardClaim> {
  if (await acquireRerollGuard(redis, rowId, attemptId)) {
    return 'acquired';
  }
  return (await redis.get(lockKey(rowId))) === attemptId ? 'alreadyOurs' : 'held';
}

/** Release the row's lock if it is still held by `attemptId`. Never throws. */
export async function releaseRerollGuard(
  redis: Redis,
  rowId: string,
  attemptId: string
): Promise<void> {
  try {
    const holder = await redis.get(lockKey(rowId));
    if (holder === attemptId) {
      await redis.del(lockKey(rowId));
    }
  } catch {
    // A release that fails leaves the lock to its TTL; the reroll outcome is
    // already decided, so it must not surface as a second failure.
  }
}

const JOB_KEY_PREFIX = 'reroll:job:';

/** How much longer than the orphan sweep (`TRACKED_JOB_MAX_LIFETIME_MS`) a job record lives. */
const JOB_RECORD_GRACE_MS = 10 * 60 * 1000;

/**
 * Job record lifetime. Longer than the orphan sweep on purpose: the sweep only
 * releases the per-row guard, so a result that arrives after it still finds
 * its record and has its memories aborted instead of being dropped.
 */
export const REROLL_JOB_RECORD_TTL_MS = TRACKED_JOB_MAX_LIFETIME_MS + JOB_RECORD_GRACE_MS;

/**
 * What a reroll result needs when the job tracker no longer knows the job
 * (a restart lost the in-memory slot): enough to undo the memories the worker
 * wrote and to release the guard, without the interaction.
 */
export interface RerollJobRecord {
  rowId: string;
  attemptId: string;
  /** First stored Discord chunk id; the gateway's route key for the row. */
  routeKey: string;
  /** Discord id the abort call acts as (the clicker). */
  actorId: string;
  /** The old reply's planned memory ids, which an abort must not touch. */
  keepMemoryIds: string[];
}

const HANDLED_KEY_PREFIX = 'reroll:handled:';

/**
 * Mark a job's result as owned by the tracked path of THIS process. A duplicate
 * delivery of the same result then finds this marker and is dropped as a
 * duplicate instead of being reported as a genuine loss. The value is the boot
 * id and the time it was set: a marker from another boot means that process's
 * handler died OR, in a rolling overlap, is still running, so the marker alone
 * does not prove a dead owner; its age is what separates the two. Only the
 * tracked path ever sets it. Never throws.
 */
export async function markRerollJobHandled(redis: Redis, jobId: string): Promise<void> {
  const marker: HandledMarker = { bootId: REROLL_BOOT_ID, markedAt: Date.now() };
  try {
    await redis.set(
      `${HANDLED_KEY_PREFIX}${jobId}`,
      JSON.stringify(marker),
      'PX',
      REROLL_JOB_RECORD_TTL_MS
    );
  } catch {
    // Best effort: without the marker a duplicate is reported as an unknown job.
  }
}

/** Who claimed a job's result on the tracked path, and when. */
export interface HandledMarker {
  bootId: string;
  /** Ms epoch the tracked path set the marker. */
  markedAt: number;
}

function parseHandledMarker(raw: string): HandledMarker | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      return null;
    }
    const v = parsed as Record<string, unknown>;
    return typeof v.bootId === 'string' && typeof v.markedAt === 'number'
      ? { bootId: v.bootId, markedAt: v.markedAt }
      : null;
  } catch {
    return null;
  }
}

/**
 * The marker of the process whose tracked path claimed this job's result, or
 * null when none is set. A value that is not a marker (unreadable) reads as one
 * from an unknown boot long ago, so it never blocks the unknown path. Never throws.
 */
export async function rerollJobHandledBy(
  redis: Redis,
  jobId: string
): Promise<HandledMarker | null> {
  try {
    const raw = await redis.get(`${HANDLED_KEY_PREFIX}${jobId}`);
    if (raw === null) {
      return null;
    }
    return parseHandledMarker(raw) ?? { bootId: 'unreadable', markedAt: 0 };
  } catch {
    return null;
  }
}

/** Remember a submitted reroll job for `REROLL_JOB_RECORD_TTL_MS`. Never throws. */
export async function rememberRerollJob(
  redis: Redis,
  jobId: string,
  record: RerollJobRecord
): Promise<void> {
  try {
    await redis.set(
      `${JOB_KEY_PREFIX}${jobId}`,
      JSON.stringify(record),
      'PX',
      REROLL_JOB_RECORD_TTL_MS
    );
  } catch {
    // Best effort: without the record a lost result leaves the guard to its TTL.
  }
}

/**
 * Delete a job's record without reading it: the tracked path is done with the
 * attempt (its in-flight record exists, or the attempt ended). Never throws.
 */
export async function deleteRerollJob(redis: Redis, jobId: string): Promise<void> {
  try {
    await redis.del(`${JOB_KEY_PREFIX}${jobId}`);
  } catch {
    // The record's TTL removes it; an early abort on a redelivery is the only cost.
  }
}

function isRerollJobRecord(value: unknown): value is RerollJobRecord {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const v = value as Record<string, unknown>;
  return (
    typeof v.rowId === 'string' &&
    typeof v.attemptId === 'string' &&
    typeof v.routeKey === 'string' &&
    typeof v.actorId === 'string' &&
    Array.isArray(v.keepMemoryIds) &&
    v.keepMemoryIds.every(id => typeof id === 'string')
  );
}

/**
 * Claim a job's record: read and delete it in one MULTI, so of two concurrent
 * callers exactly one gets it. Null when absent, already claimed or unreadable.
 * Never throws.
 */
export async function takeRerollJob(redis: Redis, jobId: string): Promise<RerollJobRecord | null> {
  try {
    const key = `${JOB_KEY_PREFIX}${jobId}`;
    const replies = await redis.multi().get(key).del(key).exec();
    const raw: unknown = replies?.[0]?.[1];
    if (typeof raw !== 'string') {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    return isRerollJobRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
