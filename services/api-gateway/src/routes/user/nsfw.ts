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
import { sendCustomSuccess } from '../../utils/responseHelpers.js';
import type { AuthenticatedRequest } from '../../types.js';

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
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const discordUserId = req.userId;

      logger.info({ discordUserId }, '[NSFW] Verifying user via NSFW channel interaction');

      // Ensure user exists via centralized UserService. Shell creation — no
      // username context on HTTP routes, persona backfilled on first Discord
      // interaction. See UserService.getOrCreateUserShell for rationale.
      //
      // Historical note: the prior implementation used the `resolveUserIdOrSendError`
      // helper, which returned `200 { nsfwVerified: false }` as an advisory for bot
      // user IDs rather than creating a record. That carve-out was defensive-only
      // (HTTP routes aren't reachable by bots — they authenticate via Discord
      // interactions, which happen through bot-client's UserContextResolver path
      // that rejects bots upstream). The ban on direct prisma.user.create calls
      // (eslint.config.js) enforces that all user provisioning goes through
      // UserService, so the simpler shell-creation path here is safe.
      const userId = await userService.getOrCreateUserShell(discordUserId);

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
