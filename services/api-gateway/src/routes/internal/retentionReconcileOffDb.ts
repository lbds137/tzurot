/**
 * POST /api/internal/retention/reconcile-off-db
 *
 * Replay the off-DB cleanup a purge still owes (Retention Phase 2, D15).
 *
 * A purge commits its DB transaction first and then unlinks avatars, evicts
 * Redis sessions, and broadcasts cache invalidations. Those steps can fail
 * after the rows are already gone — so each purge writes an audit-ledger row
 * whose reconciliation status doubles as the retry queue. This endpoint drains
 * it. Of the off-DB effects, only the **avatar unlink** is replayed: the caches
 * and sessions expire on their own, whereas an un-unlinked avatar file stays
 * publicly downloadable indefinitely.
 *
 * Idempotent by construction (a settled ledger is a zero-row no-op), which is
 * why the purge CLI calls it unconditionally at the end of every run.
 */

import { type Request, type Response, type RequestHandler } from 'express';
import { StatusCodes } from 'http-status-codes';
import { RetentionReconcileOffDbResponseSchema } from '@tzurot/common-types/schemas/api/internal';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendContractSuccess } from '../../utils/responseHelpers.js';
import { RetentionPurgeService } from '../../services/retention/RetentionPurgeService.js';
import type { RouteDeps } from '../routeDeps.js';

/** POST /api/internal/retention/reconcile-off-db — drain the off-DB retry queue. */
export const handleRetentionReconcileOffDb = (deps: RouteDeps): RequestHandler =>
  asyncHandler(async (_req: Request, res: Response) => {
    const result = await new RetentionPurgeService(deps).reconcileOffDb();
    sendContractSuccess(res, RetentionReconcileOffDbResponseSchema, result, StatusCodes.OK);
  });
