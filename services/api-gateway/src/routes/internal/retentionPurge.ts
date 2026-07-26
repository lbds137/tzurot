/**
 * POST /api/internal/retention/purge
 *
 * Erase ONE purge-eligible account (Retention Phase 2, D2/D4/D5). This is the
 * epic's first destructive capability, and it is deliberately narrow:
 *
 *   - **One user per call.** A whole-cohort endpoint would exceed the platform's
 *     ~60s request timeout partway through and leave a partial, unrecorded
 *     purge. The operator's CLI loops; each call gets its own transaction.
 *   - **Idempotent.** An already-purged target, or one who became active since
 *     the cohort was selected, returns 200 with a `skipped` status. Every one of
 *     those is a normal outcome of a resumable loop, not an error.
 *   - **Eligibility is re-checked inside the erasure transaction**, not here —
 *     a check at this layer would reopen the TOCTOU window it closes.
 *
 * Service-auth protected like every internal route. Nothing calls it on a
 * schedule: autonomous execution is Phase 4.
 */

import { type Request, type Response, type RequestHandler } from 'express';
import { StatusCodes } from 'http-status-codes';
import {
  RetentionPurgeRequestSchema,
  RetentionPurgeResponseSchema,
} from '@tzurot/common-types/schemas/api/internal';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendContractSuccess, sendError } from '../../utils/responseHelpers.js';
import { sendZodError } from '../../utils/zodHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import { SuperuserDeletionError } from '../../services/AccountDeletionService.js';
import { RetentionPurgeService } from '../../services/retention/RetentionPurgeService.js';
import type { RouteDeps } from '../routeDeps.js';

/** POST /api/internal/retention/purge — erase one eligible account. */
export const handleRetentionPurge = (deps: RouteDeps): RequestHandler =>
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = RetentionPurgeRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      sendZodError(res, parsed.error);
      return;
    }
    const { discordId, runContext, breakerOverride } = parsed.data;

    try {
      const outcome = await new RetentionPurgeService(deps).purgeUser({
        discordId,
        runContext: runContext ?? null,
        breakerOverride,
      });
      sendContractSuccess(res, RetentionPurgeResponseSchema, outcome, StatusCodes.OK);
    } catch (error) {
      if (error instanceof SuperuserDeletionError) {
        // Unreachable through the predicate (it excludes superusers) — so
        // reaching here means the two disagree, which is worth surfacing
        // loudly rather than reporting as a routine skip.
        sendError(res, ErrorResponses.forbidden(error.message));
        return;
      }
      throw error;
    }
  });
