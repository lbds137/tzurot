/**
 * User NSFW Verification Routes
 * GET /user/nsfw - Get NSFW verification status
 * POST /user/nsfw/verify - Mark user as NSFW verified (called when user interacts in NSFW channel)
 */

import { Router, type Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { createLogger, UserService, type PrismaClient } from '@tzurot/common-types';
import { requireUserAuth, requireProvisionedUser } from '../../services/AuthMiddleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { resolveProvisionedUserId } from '../../utils/resolveProvisionedUserId.js';
import { sendCustomSuccess } from '../../utils/responseHelpers.js';
import type { AuthenticatedRequest, ProvisionedRequest } from '../../types.js';

const logger = createLogger('user-nsfw');

export function createNsfwRoutes(prisma: PrismaClient): Router {
  const router = Router();
  const userService = new UserService(prisma);

  /**
   * GET /user/nsfw
   * Get current user's NSFW verification status
   */
  router.get(
    '/',
    requireUserAuth(),
    requireProvisionedUser(prisma),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const discordUserId = req.userId;

      const user = await prisma.user.findFirst({
        where: { discordId: discordUserId },
        select: { nsfwVerified: true, nsfwVerifiedAt: true },
      });

      if (user === null) {
        // User doesn't exist yet, not verified
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
    })
  );

  /**
   * POST /user/nsfw/verify
   * Mark user as NSFW verified
   * Called when user interacts with the bot in an age-restricted (NSFW) Discord channel
   */
  router.post(
    '/verify',
    requireUserAuth(),
    requireProvisionedUser(prisma),
    asyncHandler(async (req: ProvisionedRequest, res: Response) => {
      const discordUserId = req.userId;

      logger.info({ discordUserId }, '[NSFW] Verifying user via NSFW channel interaction');

      // Prefer the provisionedUserId attached by requireProvisionedUser; fall
      // back to the shell path on shadow-mode fallthrough. Once the middleware
      // is tightened to 400 on missing provisioning, the fallback disappears.
      const userId = await resolveProvisionedUserId(req, userService, discordUserId);

      // Check if already verified
      const existingUser = await prisma.user.findUnique({
        where: { id: userId },
        select: { nsfwVerified: true, nsfwVerifiedAt: true },
      });

      if (existingUser?.nsfwVerified === true) {
        // Already verified, return success with existing timestamp
        return sendCustomSuccess(
          res,
          {
            nsfwVerified: true,
            nsfwVerifiedAt: existingUser.nsfwVerifiedAt?.toISOString() ?? null,
            alreadyVerified: true,
          },
          StatusCodes.OK
        );
      }

      // Update the NSFW verification status
      const now = new Date();
      await prisma.user.update({
        where: { id: userId },
        data: {
          nsfwVerified: true,
          nsfwVerifiedAt: now,
        },
      });

      logger.info({ discordUserId }, '[NSFW] User successfully verified');

      sendCustomSuccess(
        res,
        {
          nsfwVerified: true,
          nsfwVerifiedAt: now.toISOString(),
          alreadyVerified: false,
        },
        StatusCodes.OK
      );
    })
  );

  return router;
}
