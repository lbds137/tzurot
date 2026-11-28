/**
 * The reroll abort call, shared by result delivery and restart recovery.
 *
 * The gateway reads the attempt's own memory ids from the generation job's
 * stored result (by `jobId`); the ids passed here are the fallback it uses
 * when that result is missing or belongs to another attempt.
 */

import { createLogger } from '@tzurot/common-types/utils/logger';
import type { clientsForUser } from '../../utils/gatewayClients.js';

const logger = createLogger('reroll-abort');

/** What an abort learned: the commit landed, the attempt can never land, or the abort itself failed. */
export type AbortOutcome = 'committed' | 'aborted' | 'unknown';

export interface AbortArgs {
  jobId: string;
  userClient: ReturnType<typeof clientsForUser>['userClient'];
  routeKey: string;
  rowId: string;
  attemptId: string;
  keepMemoryIds: string[];
  newMemoryIds: string[];
  newPendingIds: string[];
}

/**
 * Ask the gateway to remove the memories the new reply wrote. Never throws.
 * `committed` when the gateway reports this attempt had already landed (the
 * commit succeeded though its response was lost); `aborted` when it now can
 * never land (the gateway tombstoned it); `unknown` when the abort did not
 * get an answer, so nothing is known about the commit.
 */
export async function abortReroll(args: AbortArgs): Promise<AbortOutcome> {
  const detail = await abortRerollDetailed(args);
  return detail.kind === 'refused' ? 'unknown' : detail.kind;
}

/**
 * A gateway failure that proves the request will never be accepted: any 4xx
 * except 408 and 429 (a proxy's timeout and rate limit, which can follow a
 * request that went through). Timeouts, 5xx, 408 and 429 are not definite.
 */
export function isDefiniteRefusal(status: number): boolean {
  return status >= 400 && status < 500 && status !== 408 && status !== 429;
}

/** The abort's full answer: `aborted` carries the old row's state as the gateway read it under its lock. */
export type AbortDetail =
  | { kind: 'committed' }
  | { kind: 'aborted'; oldRowLive: boolean; oldRowContentDigest: string | null }
  | { kind: 'unknown' }
  /** A definite 4xx: retrying cannot change the answer. */
  | { kind: 'refused'; status: number };

/** `abortReroll` with the gateway's whole answer (recovery needs the old row's state and the refusal class). Never throws. */
export async function abortRerollDetailed(args: AbortArgs): Promise<AbortDetail> {
  const { jobId, userClient, routeKey, rowId, attemptId } = args;
  try {
    const aborted = await userClient.abortRerollAssistantMessage(routeKey, {
      rowId,
      attemptId,
      jobId,
      newMemoryIds: args.newMemoryIds,
      newPendingIds: args.newPendingIds,
      keepMemoryIds: args.keepMemoryIds,
    });
    if (!aborted.ok) {
      logger.warn({ jobId, rowId, status: aborted.status }, 'Reroll abort was refused');
      return isDefiniteRefusal(aborted.status)
        ? { kind: 'refused', status: aborted.status }
        : { kind: 'unknown' };
    }
    const { committed, oldRowLive, oldRowContentDigest } = aborted.data;
    return committed ? { kind: 'committed' } : { kind: 'aborted', oldRowLive, oldRowContentDigest };
  } catch (err) {
    logger.warn({ err, jobId, rowId }, 'Reroll abort failed');
    return { kind: 'unknown' };
  }
}
