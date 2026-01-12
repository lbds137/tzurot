/**
 * POST /ai/job/:jobId/confirm-delivery
 * Confirm that a job result has been successfully delivered to Discord
 */

import { Router, type Request, type Response } from 'express';
import { createLogger } from '@tzurot/common-types';
import type { PrismaClient } from '@tzurot/common-types';
import { ErrorResponses } from '../../utils/errorResponses.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendError, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { getParam } from '../../utils/requestParams.js';

const logger = createLogger('AIRouter');

export function createConfirmDeliveryRoute(prisma: PrismaClient): Router {
  const router = Router();

  /**
   * POST /job/:jobId/confirm-delivery
   *
   * Confirm that a job result has been successfully delivered to Discord.
   * Updates the job_results table status from PENDING_DELIVERY to DELIVERED.
   */
  router.post(
    '/job/:jobId/confirm-delivery',
    asyncHandler(async (req: Request, res: Response) => {
      const jobId = getParam(req.params.jobId);
      if (jobId === undefined) {
        return sendError(res, ErrorResponses.validationError('jobId is required'));
      }

      // Update job result status to DELIVERED
      const updated = await prisma.jobResult.updateMany({
        where: {
          jobId,
          status: 'PENDING_DELIVERY', // Only update if still pending
        },
        data: {
          status: 'DELIVERED',
          deliveredAt: new Date(),
        },
      });

      if (updated.count === 0) {
        // Either job doesn't exist or already delivered
        const existing = await prisma.jobResult.findUnique({
          where: { jobId },
          select: { status: true },
        });

        if (!existing) {
          return sendError(res, ErrorResponses.jobNotFound(jobId));
        }

        // Already delivered - this is fine (idempotent)
        logger.debug({ jobId, status: existing.status }, '[AI] Job already delivered');
        return sendCustomSuccess(res, {
          jobId,
          status: existing.status,
          message: 'Already confirmed',
        });
      }

      logger.info({ jobId }, '[AI] Job delivery confirmed');

      sendCustomSuccess(res, {
        jobId,
        status: 'DELIVERED',
        message: 'Delivery confirmed',
      });
    })
  );

  return router;
}
