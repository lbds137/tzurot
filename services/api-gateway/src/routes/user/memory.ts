/**
 * User Memory Routes
 * LTM (Long-Term Memory) management endpoints
 *
 * GET /user/memory/stats - Get memory statistics for a personality
 * GET /user/memory/list - Paginated list of memories for browsing
 * GET /user/memory/focus - Get focus mode status
 * POST /user/memory/focus - Enable/disable focus mode
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
 * Incognito mode (sub-routes mounted at /user/memory/incognito):
 * GET /user/memory/incognito - Get incognito status
 * POST /user/memory/incognito - Enable incognito mode
 * DELETE /user/memory/incognito - Disable incognito mode
 * POST /user/memory/incognito/forget - Retroactively delete recent memories
 */

import { Router, type RequestHandler, type Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { FocusModeSchema } from '@tzurot/common-types/schemas/api/memory';
import { Prisma } from '@tzurot/common-types/services/prisma';
import { generateUserPersonalityConfigUuid } from '@tzurot/common-types/utils/deterministicUuid';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { RouteDeps } from '../routeDeps.js';
import { requireUserAuth, requireProvisionedUser } from '../../services/AuthMiddleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendError, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import { sendZodError } from '../../utils/zodHelpers.js';
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
      select: { personaId: true, configOverrides: true },
    });

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
          focusModeEnabled: false,
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
        focusModeEnabled:
          (config?.configOverrides as Record<string, unknown> | null)?.focusModeEnabled === true,
      },
      StatusCodes.OK
    );
  });
};

/** Handler for GET /user/memory/focus */
export const handleGetFocus = (deps: RouteDeps): RequestHandler => {
  const { prisma } = deps;
  return asyncHandler(async (req: ProvisionedRequest, res: Response) => {
    const { personalityId } = req.query as { personalityId?: string };

    if (personalityId === undefined || personalityId === '') {
      sendError(res, ErrorResponses.validationError('personalityId query parameter is required'));
      return;
    }

    const userId = resolveProvisionedUserId(req);

    const config = await prisma.userPersonalityConfig.findUnique({
      where: { userId_personalityId: { userId, personalityId } },
      select: { configOverrides: true },
    });

    sendCustomSuccess(
      res,
      {
        personalityId,
        focusModeEnabled:
          (config?.configOverrides as Record<string, unknown> | null)?.focusModeEnabled === true,
      },
      StatusCodes.OK
    );
  });
};

/** Handler for POST /user/memory/focus */

export const handleSetFocus = (deps: RouteDeps): RequestHandler => {
  const { prisma } = deps;
  return asyncHandler(async (req: ProvisionedRequest, res: Response) => {
    const discordUserId = req.userId;

    const parseResult = FocusModeSchema.safeParse(req.body);
    if (!parseResult.success) {
      sendZodError(res, parseResult.error);
      return;
    }

    const { personalityId, enabled } = parseResult.data;

    const userId = resolveProvisionedUserId(req);

    const personality = await getPersonalityById(prisma, personalityId, res);
    if (!personality) {
      return;
    }

    // Read existing configOverrides to merge focusModeEnabled into JSONB
    const upcId = generateUserPersonalityConfigUuid(userId, personalityId);
    const existing = await prisma.userPersonalityConfig.findUnique({
      where: { id: upcId },
      select: { configOverrides: true },
    });

    const existingOverrides =
      existing?.configOverrides !== null &&
      existing?.configOverrides !== undefined &&
      typeof existing.configOverrides === 'object' &&
      !Array.isArray(existing.configOverrides)
        ? (existing.configOverrides as Record<string, unknown>)
        : {};

    // Merge focusModeEnabled into JSONB (dual-write: column + JSONB).
    // Strip false to keep JSONB clean (false is the default).
    const mergedOverrides: Record<string, unknown> = { ...existingOverrides };
    if (enabled) {
      mergedOverrides.focusModeEnabled = true;
    } else {
      delete mergedOverrides.focusModeEnabled;
    }
    const configOverridesValue =
      Object.keys(mergedOverrides).length > 0
        ? (mergedOverrides as Prisma.InputJsonValue)
        : Prisma.JsonNull;

    await prisma.userPersonalityConfig.upsert({
      where: { userId_personalityId: { userId, personalityId } },
      update: { configOverrides: configOverridesValue },
      create: {
        id: upcId,
        userId,
        personalityId,
        configOverrides: configOverridesValue,
      },
    });

    logger.info(
      { discordUserId, personalityId, enabled },
      `Focus mode ${enabled ? 'enabled' : 'disabled'}`
    );

    sendCustomSuccess(
      res,
      {
        personalityId,
        personalityName: personality.name,
        focusModeEnabled: enabled,
        message: enabled
          ? `Focus mode enabled for ${personality.name}. Memory retrieval is now paused — the AI will only use the current conversation context.`
          : `Focus mode disabled for ${personality.name}. Memory retrieval is active — the AI will use past memories during conversations.`,
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
 * `/delete*`, `/purge*`, `/focus`) must come before `/:id` so they don't get
 * shadowed by the parameterised route.
 */
export function createMemoryRoutes(deps: RouteDeps): Router {
  const router = Router();
  const { prisma, redis } = deps;

  // Incognito mode routes (requires Redis)
  if (redis !== undefined) {
    router.use('/incognito', createIncognitoRoutes(prisma, redis));
  }

  const requireProvisioned = requireProvisionedUser(prisma);
  router.get('/stats', requireUserAuth(), requireProvisioned, handleGetStats(deps));
  router.get('/focus', requireUserAuth(), requireProvisioned, handleGetFocus(deps));
  router.post('/focus', requireUserAuth(), requireProvisioned, handleSetFocus(deps));
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
