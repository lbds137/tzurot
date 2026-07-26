/**
 * GET /api/internal/retention/preview
 *
 * The purge-eligible cohort (Retention Phase 2, D2/D3): who has gone
 * unreachable AND inactive past the retention window, what would happen to the
 * characters they own, and how large the cohort is relative to the userbase.
 *
 * READ-ONLY — this route selects and reports; it deletes nothing. It shares
 * `RetentionPurgeService`'s single eligibility predicate with the (later) purge
 * and nag, so the number an operator reviews here is by construction the same
 * set the purge would act on.
 *
 * Service-auth protected like every internal route. Consumed by
 * `pnpm ops retention:preview`.
 */

import { type Request, type Response, type RequestHandler } from 'express';
import { StatusCodes } from 'http-status-codes';
import { RetentionPreviewResponseSchema } from '@tzurot/common-types/schemas/api/internal';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendContractSuccess } from '../../utils/responseHelpers.js';
import { RetentionPurgeService } from '../../services/retention/RetentionPurgeService.js';
import type { RouteDeps } from '../routeDeps.js';

/** GET /api/internal/retention/preview — read-only purge-eligible cohort. */
export const handleRetentionPreview = (deps: RouteDeps): RequestHandler =>
  asyncHandler(async (_req: Request, res: Response) => {
    const preview = await new RetentionPurgeService(deps).buildPreview();
    sendContractSuccess(res, RetentionPreviewResponseSchema, preview, StatusCodes.OK);
  });
