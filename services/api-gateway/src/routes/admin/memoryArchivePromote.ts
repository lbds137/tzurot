/**
 * POST /api/admin/memory-archive/promote
 *
 * Owner-only trigger for the memory-archive auto-promotion sweep — evaluates
 * every personality's archive-summary coverage against the flip gate and
 * promotes anyone ready into the archive render lists. See
 * `../../services/archivePromotion.js` for the algorithm.
 */

import { type Request, type RequestHandler, type Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import {
  MemoryArchivePromoteRequestSchema,
  MemoryArchivePromoteResponseSchema,
} from '@tzurot/common-types/schemas/api/memoryArchive';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendError, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import { runArchivePromotion } from '../../services/archivePromotion.js';
import type { RouteDeps } from '../routeDeps.js';

/** POST /api/admin/memory-archive/promote */
export const handleMemoryArchivePromote = (deps: RouteDeps): RequestHandler => {
  const { prisma, systemSettingsInvalidation, cascadeInvalidation } = deps;
  return asyncHandler(async (req: Request, res: Response) => {
    const parsed = MemoryArchivePromoteRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(
        res,
        ErrorResponses.validationError(
          `Invalid memory-archive promote request: ${parsed.error.issues
            .map(issue => `${issue.path.join('.')}: ${issue.message}`)
            .join('; ')}`
        )
      );
      return;
    }

    const result = await runArchivePromotion(
      { prisma, systemSettingsInvalidation, cascadeInvalidation },
      { dryRun: parsed.data.dryRun }
    );

    sendCustomSuccess(res, MemoryArchivePromoteResponseSchema.parse(result), StatusCodes.OK);
  });
};
