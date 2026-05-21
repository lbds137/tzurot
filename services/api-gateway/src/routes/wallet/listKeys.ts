/**
 * GET /wallet/list
 * List configured API key providers for a user
 *
 * Security:
 * - Never returns actual API keys
 * - Only returns metadata (provider, isActive, dates)
 */

import { Router, type Response } from 'express';
import {
  createLogger,
  ListWalletKeysResponseSchema,
  type PrismaClient,
} from '@tzurot/common-types';
import { requireUserAuth, requireProvisionedUser } from '../../services/AuthMiddleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { resolveProvisionedUserId } from '../../utils/resolveProvisionedUserId.js';
import { sendCustomSuccess } from '../../utils/responseHelpers.js';
import type { ProvisionedRequest } from '../../types.js';

const logger = createLogger('wallet-list-keys');

export function createListKeysRoute(prisma: PrismaClient): Router {
  const router = Router();

  router.get(
    '/',
    requireUserAuth(),
    requireProvisionedUser(prisma),
    asyncHandler(async (req: ProvisionedRequest, res: Response) => {
      const discordUserId = req.userId;

      const userId = resolveProvisionedUserId(req);

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
        take: 100, // User-scoped ceiling; provider count is bounded by a small handful
      });

      logger.info({ discordUserId, keyCount: keys.length }, 'Listed API keys');

      // Validate the response shape against the canonical schema before
      // sending. The handler hand-constructs the payload from a Prisma
      // select(); without this parse, a future refactor that drops a
      // required field (`timestamp`, per-key `createdAt`, etc.) would
      // silently break bot-client consumers using `ListWalletKeysResponse`
      // without typecheck or test catching it.
      const payload = ListWalletKeysResponseSchema.parse({
        keys: keys.map(key => ({
          provider: key.provider,
          isActive: key.isActive,
          createdAt: key.createdAt.toISOString(),
          lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
        })),
        timestamp: new Date().toISOString(),
      });
      sendCustomSuccess(res, payload);
    })
  );

  return router;
}
