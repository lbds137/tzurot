/**
 * User Memory Routes
 * LTM (Long-Term Memory) management endpoints
 *
 * GET /user/memory/stats - Get memory statistics for a personality
 * GET /user/memory/list - Paginated list of memories for browsing
 * POST /user/memory/search - Semantic search of memories
 * POST /user/memory/delete/preview - Preview batch delete; issues PreviewToken
 * POST /user/memory/delete - Execute batch delete using PreviewToken
 * POST /user/memory/purge/token - Validate confirmation phrase; issues PurgeToken
 * POST /user/memory/purge - Execute purge using PurgeToken
 * GET /user/memory/:id - Get a single memory
 * PATCH /user/memory/:id - Update memory content
 * DELETE /user/memory/:id - Delete a single memory
 * PUT /user/memory/:id/lock - Set memory lock state explicitly (idempotent on retry)
 *
 * Memory-mode sub-routes (incognito at /user/memory/incognito, fresh at
 * /user/memory/fresh): status/enable/disable each, plus incognito's forget.
 */

import { Router, type RequestHandler, type Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { RouteDeps } from '../routeDeps.js';
import { requireUserAuth, requireProvisionedUser } from '../../services/AuthMiddleware.js';
import { MemoryModeSessionManager } from '../../services/MemoryModeSessionManager.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendError, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import type { ProvisionedRequest } from '../../types.js';
import { handleSearch } from './memorySearch.js';
import { handleList } from './memoryList.js';
import {
  handleGetMemory,
  handleUpdateMemory,
  handleSetMemoryLock,
  handleDeleteMemory,
} from './memorySingle.js';
import {
  handleBatchDelete,
  handleBatchDeletePreview,
  handleIssuePurgeToken,
  handlePurge,
} from './memoryBatch.js';
import { createIncognitoRoutes } from './memoryIncognito.js';
import { createFreshRoutes } from './memoryFresh.js';
import { resolveProvisionedUserId } from '../../utils/resolveProvisionedUserId.js';
import { getDefaultPersonaId, getPersonalityById } from './memoryHelpers.js';

const logger = createLogger('user-memory');

/** Handler for GET /user/memory/stats */

export const handleGetStats = (deps: RouteDeps): RequestHandler => {
  const { prisma } = deps;
  return asyncHandler(async (req: ProvisionedRequest, res: Response) => {
    const discordUserId = req.userId;
    const { personalityId } = req.query as { personalityId?: string };

    if (personalityId === undefined || personalityId === '') {
      sendError(res, ErrorResponses.validationError('personalityId query parameter is required'));
      return;
    }

    const userId = resolveProvisionedUserId(req);

    const personality = await getPersonalityById(prisma, personalityId, res);
    if (!personality) {
      return;
    }

    const config = await prisma.userPersonalityConfig.findUnique({
      where: { userId_personalityId: { userId, personalityId } },
      select: { personaId: true },
    });

    // Fresh mode is a Redis session (specific-or-global); without Redis the
    // honest answer for a stats display is "not active".
    const freshModeEnabled =
      deps.redis !== undefined
        ? await new MemoryModeSessionManager(deps.redis, 'fresh').isActive(
            discordUserId,
            personalityId
          )
        : false;

    const personaId = config?.personaId ?? (await getDefaultPersonaId(prisma, userId));

    if (personaId === null || personaId === undefined) {
      sendCustomSuccess(
        res,
        {
          personalityId,
          personalityName: personality.name,
          personaId: null,
          totalCount: 0,
          lockedCount: 0,
          oldestMemory: null,
          newestMemory: null,
          freshModeEnabled,
        },
        StatusCodes.OK
      );
      return;
    }

    const [totalCount, lockedCount, oldestMemory, newestMemory] = await Promise.all([
      prisma.memory.count({ where: { personaId, personalityId, visibility: 'normal' } }),
      prisma.memory.count({
        where: { personaId, personalityId, visibility: 'normal', isLocked: true },
      }),
      prisma.memory.findFirst({
        where: { personaId, personalityId, visibility: 'normal' },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
      prisma.memory.findFirst({
        where: { personaId, personalityId, visibility: 'normal' },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
    ]);

    logger.debug(
      { discordUserId, personalityId, personaId: personaId.substring(0, 8), totalCount },
      'Stats retrieved'
    );

    sendCustomSuccess(
      res,
      {
        personalityId,
        personalityName: personality.name,
        personaId,
        totalCount,
        lockedCount,
        oldestMemory: oldestMemory?.createdAt?.toISOString() ?? null,
        newestMemory: newestMemory?.createdAt?.toISOString() ?? null,
        freshModeEnabled,
      },
      StatusCodes.OK
    );
  });
};

/**
 * Mount all /user/memory/* routes onto a fresh router. Each handler is the
 * (deps: RouteDeps) => RequestHandler shape that codegen emits — once the
 * generated mounts.ts is wired up, the codegen will register these routes
 * identically and this factory becomes the legacy path to delete.
 *
 * Registration order matters: literal paths (`/stats`, `/list`, `/search`,
 * `/delete*`, `/purge*`) must come before `/:id` so they don't get
 * shadowed by the parameterised route.
 */
export function createMemoryRoutes(deps: RouteDeps): Router {
  const router = Router();
  const { prisma, redis } = deps;

  // Memory-mode routes (require Redis)
  if (redis !== undefined) {
    router.use('/incognito', createIncognitoRoutes(prisma, redis));
    router.use('/fresh', createFreshRoutes(prisma, redis));
  }

  const requireProvisioned = requireProvisionedUser(prisma);
  router.get('/stats', requireUserAuth(), requireProvisioned, handleGetStats(deps));
  router.get('/list', requireUserAuth(), requireProvisioned, handleList(deps));
  router.post('/search', requireUserAuth(), requireProvisioned, handleSearch(deps));
  router.post(
    '/delete/preview',
    requireUserAuth(),
    requireProvisioned,
    handleBatchDeletePreview(deps)
  );
  router.post('/delete', requireUserAuth(), requireProvisioned, handleBatchDelete(deps));
  router.post('/purge/token', requireUserAuth(), requireProvisioned, handleIssuePurgeToken(deps));
  router.post('/purge', requireUserAuth(), requireProvisioned, handlePurge(deps));
  router.get('/:id', requireUserAuth(), requireProvisioned, handleGetMemory(deps));
  router.patch('/:id', requireUserAuth(), requireProvisioned, handleUpdateMemory(deps));
  router.delete('/:id', requireUserAuth(), requireProvisioned, handleDeleteMemory(deps));
  router.put('/:id/lock', requireUserAuth(), requireProvisioned, handleSetMemoryLock(deps));

  return router;
}
