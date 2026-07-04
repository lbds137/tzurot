/**
 * POST /ai/job/:jobId/confirm-delivery
 * Confirm that a job result has been successfully delivered to Discord
 */

import { type Request, type Response, type RequestHandler } from 'express';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { ErrorResponses } from '../../utils/errorResponses.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendError, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { getParam } from '../../utils/requestParams.js';
import type { RouteDeps } from '../routeDeps.js';

const logger = createLogger('AIRouter');

/**
 * POST /api/internal/ai/job/:jobId/confirm-delivery — confirm a job result
 * has been successfully delivered to Discord. Updates job_results status
 * from PENDING_DELIVERY → DELIVERED. Idempotent.
 */
export const handleAiConfirmDelivery = (deps: RouteDeps): RequestHandler => {
  const { prisma } = deps;
  return asyncHandler(async (req: Request, res: Response) => {
    const jobId = getParam(req.params.jobId);
    if (jobId === undefined) {
      return sendError(res, ErrorResponses.validationError('jobId is required'));
    }

    const updated = await prisma.jobResult.updateMany({
      where: {
        jobId,
        status: 'PENDING_DELIVERY',
      },
      data: {
        status: 'DELIVERED',
        deliveredAt: new Date(),
      },
    });

    if (updated.count === 0) {
      const existing = await prisma.jobResult.findUnique({
        where: { jobId },
        select: { status: true },
      });

      if (!existing) {
        return sendError(res, ErrorResponses.jobNotFound(jobId));
      }

      logger.debug({ jobId, status: existing.status }, 'Job already delivered');
      return sendCustomSuccess(res, {
        jobId,
        status: existing.status,
        message: 'Already confirmed',
      });
    }

    logger.info({ jobId }, 'Job delivery confirmed');

    sendCustomSuccess(res, {
      jobId,
      status: 'DELIVERED',
      message: 'Delivery confirmed',
    });
  });
};
