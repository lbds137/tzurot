/**
 * GET /wallet/list
 * List configured API key providers for a user
 *
 * Security:
 * - Never returns actual API keys
 * - Only returns metadata (provider, isActive, dates)
 */

import { Router, type Response } from 'express';
import { createLogger, type PrismaClient } from '@tzurot/common-types';
import { requireUserAuth } from '../../services/AuthMiddleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendCustomSuccess } from '../../utils/responseHelpers.js';
import type { AuthenticatedRequest } from '../../types.js';

const logger = createLogger('wallet-list-keys');

export function createListKeysRoute(prisma: PrismaClient): Router {
  const router = Router();

  router.get(
    '/',
    requireUserAuth(),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const discordUserId = req.userId;

      // Find user by Discord ID
      const user = await prisma.user.findFirst({
        where: { discordId: discordUserId },
        select: { id: true },
      });

      if (!user) {
        // User doesn't exist yet - they have no keys
        logger.info({ discordUserId }, '[Wallet] User not found, returning empty list');
        sendCustomSuccess(res, {
          keys: [],
          timestamp: new Date().toISOString(),
        });
        return;
      }

      // Get all API keys for this user (without the actual key data)
      const keys = await prisma.userApiKey.findMany({
        where: { userId: user.id },
        select: {
          provider: true,
          isActive: true,
          createdAt: true,
          lastUsedAt: true,
        },
        orderBy: { createdAt: 'desc' },
      });

      logger.info({ discordUserId, keyCount: keys.length }, '[Wallet] Listed API keys');

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
