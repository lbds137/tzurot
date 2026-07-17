/**
 * POST /internal/release-broadcast/reconcile
 *
 * Service-auth trigger for the release reconcile sweep. Called hourly by
 * ai-worker's scheduled job (the only service with a scheduler), and
 * manually as the ops catch-up lever for a release the hourly window
 * aged out (lookbackHours ≤ 168).
 */

import { type Request, type RequestHandler, type Response } from 'express';
import {
  ReleaseReconcileInputSchema,
  ReleaseReconcileResponseSchema,
} from '@tzurot/common-types/schemas/api/broadcast';
import { getConfig } from '@tzurot/common-types/config/config';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendError, sendContractSuccess } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import { sendZodError } from '../../utils/zodHelpers.js';
import {
  createGitHubReleasesFetcher,
  reconcileReleaseAnnouncements,
  sweepIncompleteBroadcasts,
} from '../../services/releaseReconcile.js';
import type { RouteDeps } from '../routeDeps.js';

export const handleReleaseBroadcastReconcile = (deps: RouteDeps): RequestHandler => {
  const { prisma, releaseBroadcastQueue } = deps;
  if (releaseBroadcastQueue === undefined) {
    return (_req, res) => {
      sendError(res, ErrorResponses.serviceUnavailable('Broadcast queue not configured'));
    };
  }
  return asyncHandler(async (req: Request, res: Response) => {
    const parseResult = ReleaseReconcileInputSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      return sendZodError(res, parseResult.error);
    }

    const fetchReleases = createGitHubReleasesFetcher({
      ...(getConfig().GITHUB_API_TOKEN !== undefined
        ? { token: getConfig().GITHUB_API_TOKEN }
        : {}),
    });
    const summary = await reconcileReleaseAnnouncements(
      { prisma, queue: releaseBroadcastQueue, fetchReleases },
      {
        ...(parseResult.data.lookbackHours !== undefined
          ? { lookbackHours: parseResult.data.lookbackHours }
          : {}),
      }
    );

    // Second sweep of the run: heal announced-but-incomplete wedges. Runs
    // after the missing-announcement sweep so a release both missing AND
    // crashing mid-blast is handled across two hourly cycles, not zero.
    const resweep = await sweepIncompleteBroadcasts({ prisma, queue: releaseBroadcastQueue });

    sendContractSuccess(res, ReleaseReconcileResponseSchema, { ...summary, resweep });
  });
};
