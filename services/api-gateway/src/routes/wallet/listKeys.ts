/**
 * GET /wallet/list
 * List configured API key providers for a user
 *
 * Security:
 * - Never returns actual API keys
 * - Only returns metadata (provider, isActive, dates)
 */

import { Router, type Response, type RequestHandler } from 'express';
import { ListWalletKeysResponseSchema } from '@tzurot/common-types/schemas/api/wallet';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { requireUserAuth, requireProvisionedUser } from '../../services/AuthMiddleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { resolveProvisionedUserId } from '../../utils/resolveProvisionedUserId.js';
import { sendCustomSuccess } from '../../utils/responseHelpers.js';
import type { ProvisionedRequest } from '../../types.js';
import type { RouteDeps } from '../routeDeps.js';

const logger = createLogger('wallet-list-keys');

/** GET /api/user/wallet — list configured API-key provider metadata. */
export const handleListWalletKeys = (deps: RouteDeps): RequestHandler => {
  const { prisma } = deps;
  return asyncHandler(async (req: ProvisionedRequest, res: Response) => {
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
  });
};

export function createListKeysRoute(prisma: PrismaClient): Router {
  const router = Router();
  router.get(
    '/',
    requireUserAuth(),
    requireProvisionedUser(prisma),
    handleListWalletKeys({ prisma })
  );
  return router;
}
