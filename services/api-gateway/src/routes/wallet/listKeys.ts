/**
 * GET /wallet/list
 * List configured API key providers for a user
 *
 * Security:
 * - Never returns actual API keys
 * - Only returns metadata (provider, isActive, dates)
 */

import { Router, type Response } from 'express';
import { createLogger, UserService, type PrismaClient } from '@tzurot/common-types';
import { requireUserAuth, requireProvisionedUser } from '../../services/AuthMiddleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { resolveProvisionedUserId } from '../../utils/resolveProvisionedUserId.js';
import { sendCustomSuccess } from '../../utils/responseHelpers.js';
import type { ProvisionedRequest } from '../../types.js';

const logger = createLogger('wallet-list-keys');

export function createListKeysRoute(prisma: PrismaClient): Router {
  const router = Router();
  const userService = new UserService(prisma);

  router.get(
    '/',
    requireUserAuth(),
    requireProvisionedUser(prisma),
    asyncHandler(async (req: ProvisionedRequest, res: Response) => {
      const discordUserId = req.userId;

      const userId = await resolveProvisionedUserId(req, userService);

      // Get all API keys for this user (without the actual key data)
      const keys = await prisma.userApiKey.findMany({
        where: { userId },
        select: {
          provider: true,
          isActive: true,
          createdAt: true,
          lastUsedAt: true,
        },
        orderBy: { createdAt: 'desc' },
      });

      logger.info({ discordUserId, keyCount: keys.length }, 'Listed API keys');

      sendCustomSuccess(res, {
        keys: keys.map(key => ({
          provider: key.provider,
          isActive: key.isActive,
          createdAt: key.createdAt.toISOString(),
          lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
        })),
        timestamp: new Date().toISOString(),
      });
    })
  );

  return router;
}
