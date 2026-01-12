/**
 * GET /ai/job/:jobId
 * Get the status of a specific job
 */

import { Router, type Request, type Response } from 'express';
import type { Queue } from 'bullmq';
import { ErrorResponses } from '../../utils/errorResponses.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendError, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { getParam } from '../../utils/requestParams.js';

export function createJobStatusRoute(aiQueue: Queue): Router {
  const router = Router();

  /**
   * GET /job/:jobId
   *
   * Get the status of a specific job.
   */
  router.get(
    '/job/:jobId',
    asyncHandler(async (req: Request, res: Response) => {
      const jobId = getParam(req.params.jobId);
      if (jobId === undefined) {
        return sendError(res, ErrorResponses.validationError('jobId is required'));
      }

      const job = await aiQueue.getJob(jobId);

      if (job === undefined) {
        return sendError(res, ErrorResponses.jobNotFound(jobId));
      }

      const state = await job.getState();
      const progress: number | object = job.progress as number | object;
      const returnvalue: unknown = job.returnvalue;

      sendCustomSuccess(res, {
        jobId: job.id,
        status: state,
        progress,
        result: returnvalue,
        timestamp: new Date().toISOString(),
      });
    })
  );

  return router;
}
