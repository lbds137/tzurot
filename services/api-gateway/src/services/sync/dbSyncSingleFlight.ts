/**
 * db-sync single-flight guard — refuses a second concurrent
 * `POST /api/admin/db-sync` while one is already running, instead of
 * letting two syncs race writes across the same dev<->prod pair.
 *
 * Same SET-PX-NX / GET-then-DEL shape as
 * `services/api-gateway/src/services/retention/runLease.ts`, narrowed to a
 * single boolean guard (one sync at a time, no per-run label or refresh) —
 * a whole sync is one HTTP call, unlike a retention run's many leased
 * calls, so there is nothing to refresh mid-run.
 */

import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import { createLogger } from '@tzurot/common-types/utils/logger';

const logger = createLogger('db-sync-single-flight');

export const DB_SYNC_SINGLE_FLIGHT_KEY = 'db-sync:single-flight';

/**
 * Crash-reclaim bound only — the `finally`-release is the normal path. The
 * gateway sets no server-side timeout on this route (Node leaves in-flight
 * response duration unlimited by default — see `GATEWAY_TIMEOUTS.LONG_SYNC`'s
 * comment, `packages/common-types/src/constants/discord.ts`), and the
 * transient sync pools (`transientPoolOptions`) carry no `statement_timeout`,
 * so no code-derived ceiling on a sync's duration exists. Set at 6x the 300s
 * client budget `GATEWAY_TIMEOUTS.LONG_SYNC` — a sync running past ~2 minutes
 * is already the async-job refactor's own trigger
 * (`packages/clients/src/routes/admin.ts` `dbSync` entry), so 30 minutes is a
 * wide margin for a live sync while still reclaiming a crashed one inside a
 * single business day. A sync outliving this TTL loses its guard: a second
 * request can then acquire and run concurrently with the first. Not verified
 * by any test beyond the token-mismatch case in `releaseDbSyncSingleFlight`.
 */
export const DB_SYNC_SINGLE_FLIGHT_TTL_MS = 30 * 60 * 1000;

/** The Redis commands the guard uses — narrowed so a test double implements exactly these. */
export type DbSyncSingleFlightRedis = Pick<Redis, 'set' | 'get' | 'del'>;

/** The guard store could not be reached; the caller must not assume it holds (or lacks) the guard. */
export class DbSyncSingleFlightUnavailableError extends Error {
  constructor(cause: unknown) {
    super('Database sync single-flight guard store (Redis) is unavailable', { cause });
    this.name = 'DbSyncSingleFlightUnavailableError';
  }
}

/**
 * Take the guard, or return null when another sync already holds it.
 *
 * The token is an ephemeral lease token (`randomUUID`), not a DB entity id —
 * the deterministic-id convention is for rows, and a lease token must NOT be
 * derivable by a second caller (same justification as `runLease.ts`).
 *
 * Fails closed: a Redis rejection throws rather than being read as "no sync
 * running" — this guards writes to both databases, the same posture and
 * reason as `runLease.ts` (lines 18-20).
 */
export async function acquireDbSyncSingleFlight(
  redis: DbSyncSingleFlightRedis
): Promise<string | null> {
  const token = randomUUID();
  try {
    const result = await redis.set(
      DB_SYNC_SINGLE_FLIGHT_KEY,
      token,
      'PX',
      DB_SYNC_SINGLE_FLIGHT_TTL_MS,
      'NX'
    );
    return result === 'OK' ? token : null;
  } catch (error) {
    throw new DbSyncSingleFlightUnavailableError(error);
  }
}

/**
 * Release the guard, but only if it still holds THIS token — GET-then-DEL is
 * non-atomic, deliberately (no Lua — see `.claude/rules/03-database.md` §
 * Redis counters): the only race is the TTL lapsing mid-sync AND a
 * competing acquire landing in that gap, in which case this release must
 * not delete the other sync's guard. Accepted, not covered by any test.
 *
 * Never throws: any Redis rejection is caught and logged — the TTL
 * reclaims the guard on its own.
 */
export async function releaseDbSyncSingleFlight(
  redis: DbSyncSingleFlightRedis,
  token: string
): Promise<void> {
  try {
    const stored = await redis.get(DB_SYNC_SINGLE_FLIGHT_KEY);
    if (stored === token) {
      await redis.del(DB_SYNC_SINGLE_FLIGHT_KEY);
    } else {
      logger.warn(
        { hadStored: stored !== null },
        'db-sync single-flight guard was not ours at release time — the TTL ' +
          'expired mid-sync or another sync took it; leaving it in place'
      );
    }
  } catch (error) {
    logger.warn(
      { err: error },
      'Failed to release db-sync single-flight guard — the TTL will reclaim it'
    );
  }
}
