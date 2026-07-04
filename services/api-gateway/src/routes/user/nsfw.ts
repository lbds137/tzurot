/**
 * User NSFW Verification Routes
 * GET /user/nsfw - Get NSFW verification status
 * POST /user/nsfw/verify - Mark user as NSFW verified (called when user interacts in NSFW channel)
 */

import { Router, type Response, type RequestHandler } from 'express';
import { StatusCodes } from 'http-status-codes';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { requireUserAuth, requireProvisionedUser } from '../../services/AuthMiddleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { resolveProvisionedUserId } from '../../utils/resolveProvisionedUserId.js';
import { sendCustomSuccess } from '../../utils/responseHelpers.js';
import type { ProvisionedRequest } from '../../types.js';
import type { RouteDeps } from '../routeDeps.js';

const logger = createLogger('user-nsfw');

/** GET /api/user/nsfw — current NSFW verification state */
export const handleGetNsfwStatus = (deps: RouteDeps): RequestHandler => {
  const { prisma } = deps;
  return asyncHandler(async (req: ProvisionedRequest, res: Response) => {
    const userId = resolveProvisionedUserId(req);

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { nsfwVerified: true, nsfwVerifiedAt: true },
    });

    if (user === null) {
      return sendCustomSuccess(
        res,
        {
          nsfwVerified: false,
          nsfwVerifiedAt: null,
        },
        StatusCodes.OK
      );
    }

    sendCustomSuccess(
      res,
      {
        nsfwVerified: user.nsfwVerified,
        nsfwVerifiedAt: user.nsfwVerifiedAt?.toISOString() ?? null,
      },
      StatusCodes.OK
    );
  });
};

/** POST /api/user/nsfw/verify — mark user as NSFW verified */
export const handleVerifyNsfw = (deps: RouteDeps): RequestHandler => {
  const { prisma } = deps;
  return asyncHandler(async (req: ProvisionedRequest, res: Response) => {
    const discordUserId = req.userId;

    logger.info({ discordUserId }, 'Verifying user via NSFW channel interaction');

    const userId = resolveProvisionedUserId(req);

    const existingUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { nsfwVerified: true, nsfwVerifiedAt: true },
    });

    // Both fields must be set for the "already verified" early return;
    // an inconsistent row (verified=true with null timestamp — the invalid
    // state-machine state per 03-database.md) falls through to the re-verify
    // path below, which writes a fresh timestamp and self-heals.
    if (existingUser?.nsfwVerified === true && existingUser.nsfwVerifiedAt !== null) {
      return sendCustomSuccess(
        res,
        {
          nsfwVerified: true,
          nsfwVerifiedAt: existingUser.nsfwVerifiedAt.toISOString(),
          alreadyVerified: true,
        },
        StatusCodes.OK
      );
    }

    const now = new Date();
    await prisma.user.update({
      where: { id: userId },
      data: {
        nsfwVerified: true,
        nsfwVerifiedAt: now,
      },
    });

    logger.info({ discordUserId }, 'User successfully verified');

    sendCustomSuccess(
      res,
      {
        nsfwVerified: true,
        nsfwVerifiedAt: now.toISOString(),
        alreadyVerified: false,
      },
      StatusCodes.OK
    );
  });
};

export function createNsfwRoutes(deps: RouteDeps): Router {
  const router = Router();
  router.get(
    '/',
    requireUserAuth(),
    requireProvisionedUser(deps.prisma),
    handleGetNsfwStatus(deps)
  );
  router.post(
    '/verify',
    requireUserAuth(),
    requireProvisionedUser(deps.prisma),
    handleVerifyNsfw(deps)
  );
  return router;
}
