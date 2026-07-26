/**
 * Retention Phase 3 — the notify pipeline's three internal routes.
 *
 *   POST /api/internal/retention/notify         — resolve cohort + enqueue batches
 *   POST /api/internal/retention/notify/filter  — the worker's send-time re-check
 *   POST /api/internal/retention/notify/report  — per-recipient delivery outcomes
 *
 * Operator-driven (manual-approval doctrine): only the retention:notify CLI
 * calls the enqueue route; nothing runs it on a schedule (autonomy is
 * Phase 4). The filter and report routes are the bot-client worker's two
 * seams back into the grace bookkeeping.
 *
 * Service-auth protected upstream like every /internal/* route.
 */

import { type Request, type Response, type RequestHandler } from 'express';
import { StatusCodes } from 'http-status-codes';
import {
  RetentionNotifyFilterRequestSchema,
  RetentionNotifyFilterResponseSchema,
  RetentionNotifyReportRequestSchema,
  RetentionNotifyReportResponseSchema,
  RetentionNotifyRequestSchema,
  RetentionNotifyResponseSchema,
} from '@tzurot/common-types/schemas/api/internal';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendContractSuccess, sendError } from '../../utils/responseHelpers.js';
import { sendZodError } from '../../utils/zodHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import { RetentionNotifyService } from '../../services/retention/RetentionNotifyService.js';
import type { RouteDeps } from '../routeDeps.js';

/** POST /api/internal/retention/notify — resolve the cohort and enqueue warning DMs. */
export const handleRetentionNotify = (deps: RouteDeps): RequestHandler =>
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = RetentionNotifyRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      sendZodError(res, parsed.error);
      return;
    }
    // Dry runs never enqueue, so they must not fail on a missing queue —
    // the conformance harness and any read-only caller take this path.
    if (parsed.data.dryRun !== true && deps.retentionNotifyQueue === undefined) {
      sendError(res, ErrorResponses.internalError('Retention notify queue is not configured'));
      return;
    }

    const result = await new RetentionNotifyService(deps.prisma).enqueueNotifyRun(
      deps.retentionNotifyQueue ?? null,
      parsed.data
    );
    sendContractSuccess(res, RetentionNotifyResponseSchema, result, StatusCodes.OK);
  });

/** POST /api/internal/retention/notify/filter — which of these users are still notify-eligible? */
export const handleRetentionNotifyFilter = (deps: RouteDeps): RequestHandler =>
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = RetentionNotifyFilterRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      sendZodError(res, parsed.error);
      return;
    }

    const stillEligibleUserIds = await new RetentionNotifyService(deps.prisma).filterEligible(
      parsed.data.userIds
    );
    sendContractSuccess(
      res,
      RetentionNotifyFilterResponseSchema,
      { stillEligibleUserIds },
      StatusCodes.OK
    );
  });

/** POST /api/internal/retention/notify/report — apply per-recipient outcomes. */
export const handleRetentionNotifyReport = (deps: RouteDeps): RequestHandler =>
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = RetentionNotifyReportRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      sendZodError(res, parsed.error);
      return;
    }

    // Stamp failures THROW (asyncHandler → 500): the worker's report retry is
    // safe against the IS NULL-guarded stamps, and a swallowed failure here
    // would strand a sent-but-unstamped user for the next run to double-DM.
    const processed = await new RetentionNotifyService(deps.prisma).reportOutcomes(
      parsed.data.outcomes
    );
    sendContractSuccess(res, RetentionNotifyReportResponseSchema, { processed }, StatusCodes.OK);
  });
