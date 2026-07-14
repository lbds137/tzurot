/**
 * POST /admin/broadcast
 * Owner-only DM blast through the release-broadcast pipeline.
 * Dry-run resolves eligible recipients without writing or enqueueing anything.
 */

import { type Request, type RequestHandler, type Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import {
  BroadcastInputSchema,
  BroadcastResponseSchema,
} from '@tzurot/common-types/schemas/api/broadcast';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendError, sendContractSuccess } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import { sendZodError } from '../../utils/zodHelpers.js';
import { resolveEligibleRecipients, enqueueBroadcast } from '../../services/releaseBroadcast.js';
import type { RouteDeps } from '../routeDeps.js';

const logger = createLogger('admin-broadcast');

/** Dry-run preview size — enough to sanity-check the audience, not enumerate it. */
const SAMPLE_SIZE = 10;

/** Timestamped default when the owner doesn't supply a label. */
function defaultLabel(now: Date): string {
  return `adhoc-${now.toISOString().slice(0, 16).replace(/[:T]/g, '-')}`;
}

export const handleBroadcast = (deps: RouteDeps): RequestHandler => {
  const { prisma, releaseBroadcastQueue } = deps;
  if (releaseBroadcastQueue === undefined) {
    return (_req, res) => {
      sendError(res, ErrorResponses.serviceUnavailable('Broadcast queue not configured'));
    };
  }
  return asyncHandler(async (req: Request, res: Response) => {
    const parseResult = BroadcastInputSchema.safeParse(req.body);
    if (!parseResult.success) {
      return sendZodError(res, parseResult.error);
    }
    const { message, level, label, dryRun } = parseResult.data;

    if (dryRun) {
      const recipients = await resolveEligibleRecipients(prisma, level);
      logger.info({ level, eligible: recipients.length }, 'Broadcast dry-run resolved');
      return sendContractSuccess(res, BroadcastResponseSchema, {
        dryRun: true,
        eligibleCount: recipients.length,
        sample: recipients.slice(0, SAMPLE_SIZE).map(r => ({ username: r.username })),
      });
    }

    const version = label ?? defaultLabel(new Date());
    const result = await enqueueBroadcast(prisma, releaseBroadcastQueue, {
      version,
      level,
      body: message,
    });

    if (!result.ok) {
      return sendError(
        res,
        ErrorResponses.validationError(
          `Version "${version}" was already announced — pick a different label.`
        )
      );
    }

    sendContractSuccess(
      res,
      BroadcastResponseSchema,
      {
        dryRun: false,
        version,
        releaseId: result.releaseId,
        recipients: result.recipients,
        batches: result.batches,
      },
      StatusCodes.OK
    );
  });
};
