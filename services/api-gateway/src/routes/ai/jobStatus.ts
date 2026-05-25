/**
 * GET /ai/job/:jobId
 * Get the status of a specific job
 */

import { type Request, type Response, type RequestHandler } from 'express';
import { ErrorResponses } from '../../utils/errorResponses.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendError, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { getParam } from '../../utils/requestParams.js';
import type { RouteDeps } from '../routeDeps.js';

/** GET /api/internal/ai/job/:jobId — fetch BullMQ job status by id. */
export const handleAiJobStatus = (deps: RouteDeps): RequestHandler => {
  const { aiQueue } = deps;
  if (aiQueue === undefined) {
    return (_req, res) => {
      sendError(res, ErrorResponses.serviceUnavailable('BullMQ queue not configured'));
    };
  }
  return asyncHandler(async (req: Request, res: Response) => {
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
  });
};
