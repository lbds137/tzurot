/**
 * Retention run lease — the routes that bracket a run, plus the guard every
 * leased route runs before it acts.
 *
 *   POST /api/internal/retention/run/begin — take the run lease (409 when held)
 *   POST /api/internal/retention/run/end   — release it
 *
 * Leased (they call `refreshRunLeaseOrRespond` first): `retention/purge` and a
 * non-dry `retention/notify`. NOT leased: dry-run notify and the preview (both
 * read-only), and `reconcile-off-db` (idempotent avatar-unlink retries, called
 * by the purge CLI while it already holds the lease).
 *
 * Every lease failure answers BEFORE the route acts: 409 when another run holds
 * the lease, 503 when the lease store is missing or unreachable (fail closed —
 * see runLease.ts).
 *
 * Service-auth protected upstream like every /internal/* route.
 */

import { type Request, type Response, type RequestHandler } from 'express';
import { StatusCodes } from 'http-status-codes';
import { API_ERROR_SUBCODE } from '@tzurot/common-types/constants/error';
import {
  RetentionRunBeginRequestSchema,
  RetentionRunBeginResponseSchema,
  RetentionRunEndRequestSchema,
  RetentionRunEndResponseSchema,
} from '@tzurot/common-types/schemas/api/internal';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendContractSuccess, sendError } from '../../utils/responseHelpers.js';
import { sendZodError } from '../../utils/zodHelpers.js';
import {
  createErrorResponse,
  ErrorCode,
  ErrorResponses,
  type ErrorResponse,
} from '../../utils/errorResponses.js';
import {
  RUN_LEASE_TTL_MS,
  RunLease,
  RunLeaseUnavailableError,
  type RunLeaseHolder,
} from '../../services/retention/runLease.js';
import type { RouteDeps } from '../routeDeps.js';

/** Lease label for a leased call whose body carried no runContext. */
export const UNLABELLED_RUN = 'unlabelled retention run';

type LeaseConflictCode =
  typeof API_ERROR_SUBCODE.RUN_IN_PROGRESS | typeof API_ERROR_SUBCODE.RUN_LEASE_CONFLICT;

function describeHolder(holder: RunLeaseHolder | null): string {
  return holder === null
    ? 'another run (its lease record is unreadable or just changed hands)'
    : `"${holder.runContext}" (since ${holder.acquiredAt})`;
}

/** 409 carrying the holder, with a subcode the CLI branches on. */
function sendLeaseConflict(
  res: Response,
  code: LeaseConflictCode,
  message: string,
  holder: RunLeaseHolder | null
): void {
  const body: ErrorResponse & { holder: RunLeaseHolder | null } = {
    ...createErrorResponse(ErrorCode.CONFLICT, message),
    code,
    holder,
  };
  sendError(res, body);
}

function sendLeaseUnavailable(res: Response): void {
  sendError(
    res,
    ErrorResponses.serviceUnavailable(
      'Retention run lease is unavailable (Redis); refusing to act without it.'
    )
  );
}

/**
 * Run a lease operation, answering 503 (and returning null) when the lease
 * store is absent or unreachable. Any other error propagates to asyncHandler.
 */
async function withLease<T>(
  deps: RouteDeps,
  res: Response,
  op: (lease: RunLease) => Promise<T>
): Promise<T | null> {
  if (deps.redis === undefined) {
    sendLeaseUnavailable(res);
    return null;
  }
  try {
    return await op(new RunLease(deps.redis));
  } catch (error) {
    if (error instanceof RunLeaseUnavailableError) {
      sendLeaseUnavailable(res);
      return null;
    }
    throw error;
  }
}

/**
 * The guard a leased route runs BEFORE it acts. Returns true when this run
 * still holds the lease (refreshed); otherwise it has already answered 409
 * (lease lost to another run) or 503 (lease store unavailable) and the caller
 * must return without acting.
 */
export async function refreshRunLeaseOrRespond(
  deps: RouteDeps,
  res: Response,
  runId: string,
  runContext: string
): Promise<boolean> {
  const result = await withLease(deps, res, lease => lease.refresh(runId, runContext));
  if (result === null) {
    return false;
  }
  if (!result.ok) {
    sendLeaseConflict(
      res,
      API_ERROR_SUBCODE.RUN_LEASE_CONFLICT,
      `This run no longer holds the retention run lease — it is held by ` +
        `${describeHolder(result.holder)}. Stop, and re-run once that run ends.`,
      result.holder
    );
    return false;
  }
  return true;
}

/** POST /api/internal/retention/run/begin — take the run lease. */
export const handleRetentionRunBegin = (deps: RouteDeps): RequestHandler =>
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = RetentionRunBeginRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      sendZodError(res, parsed.error);
      return;
    }
    const result = await withLease(deps, res, lease => lease.acquire(parsed.data.runContext));
    if (result === null) {
      return;
    }
    if (!result.acquired) {
      sendLeaseConflict(
        res,
        API_ERROR_SUBCODE.RUN_IN_PROGRESS,
        `Another retention run is in progress: ${describeHolder(result.holder)}.`,
        result.holder
      );
      return;
    }
    sendContractSuccess(
      res,
      RetentionRunBeginResponseSchema,
      { runId: result.runId, leaseTtlMs: RUN_LEASE_TTL_MS },
      StatusCodes.OK
    );
  });

/** POST /api/internal/retention/run/end — release the run lease (never someone else's). */
export const handleRetentionRunEnd = (deps: RouteDeps): RequestHandler =>
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = RetentionRunEndRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      sendZodError(res, parsed.error);
      return;
    }
    const released = await withLease(deps, res, lease => lease.release(parsed.data.runId));
    if (released === null) {
      return;
    }
    sendContractSuccess(res, RetentionRunEndResponseSchema, { released }, StatusCodes.OK);
  });
