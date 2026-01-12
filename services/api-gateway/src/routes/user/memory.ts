/**
 * User Memory Routes
 * LTM (Long-Term Memory) management endpoints
 *
 * GET /user/memory/stats - Get memory statistics for a personality
 * GET /user/memory/list - Paginated list of memories for browsing
 * GET /user/memory/focus - Get focus mode status
 * POST /user/memory/focus - Enable/disable focus mode
 * POST /user/memory/search - Semantic search of memories
 * GET /user/memory/delete/preview - Preview batch delete without executing
 * POST /user/memory/delete - Batch delete memories with filters
 * POST /user/memory/purge - Purge all memories for a personality (typed confirmation required)
 * GET /user/memory/:id - Get a single memory
 * PATCH /user/memory/:id - Update memory content
 * DELETE /user/memory/:id - Delete a single memory
 * POST /user/memory/:id/lock - Toggle memory lock status
 */

import { Router, type Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import {
  createLogger,
  type PrismaClient,
  generateUserPersonalityConfigUuid,
} from '@tzurot/common-types';
import { requireUserAuth } from '../../services/AuthMiddleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendError, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import type { AuthenticatedRequest } from '../../types.js';
import { handleSearch } from './memorySearch.js';
import { handleList } from './memoryList.js';
import {
  handleGetMemory,
  handleUpdateMemory,
  handleToggleLock,
  handleDeleteMemory,
} from './memorySingle.js';
import { handleBatchDelete, handleBatchDeletePreview, handlePurge } from './memoryBatch.js';

const logger = createLogger('user-memory');

interface FocusModeRequest {
  personalityId: string;
  enabled: boolean;
}

/**
 * Get user's default persona ID
 */
async function getDefaultPersonaId(prisma: PrismaClient, userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { defaultPersonaId: true },
  });
  return user?.defaultPersonaId ?? null;
}

/**
 * Validate and get user from Discord ID
 */
async function getUserByDiscordId(
  prisma: PrismaClient,
  discordUserId: string,
  res: Response
): Promise<{ id: string } | null> {
  const user = await prisma.user.findUnique({
    where: { discordId: discordUserId },
    select: { id: true },
  });

  if (!user) {
    sendError(res, ErrorResponses.notFound('User not found'));
    return null;
  }

  return user;
}

/**
 * Validate and get personality by ID
 */
async function getPersonalityById(
  prisma: PrismaClient,
  personalityId: string,
  res: Response
): Promise<{ id: string; name: string } | null> {
  const personality = await prisma.personality.findUnique({
    where: { id: personalityId },
    select: { id: true, name: true },
  });

  if (!personality) {
    sendError(res, ErrorResponses.notFound('Personality not found'));
    return null;
  }

  return personality;
}

/**
 * Handler for GET /user/memory/stats
 */
async function handleGetStats(
  prisma: PrismaClient,
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const discordUserId = req.userId;
  const { personalityId } = req.query as { personalityId?: string };

  if (personalityId === undefined || personalityId === '') {
    sendError(res, ErrorResponses.validationError('personalityId query parameter is required'));
    return;
  }

  const user = await getUserByDiscordId(prisma, discordUserId, res);
  if (!user) {
    return;
  }

  const personality = await getPersonalityById(prisma, personalityId, res);
  if (!personality) {
    return;
  }

  const config = await prisma.userPersonalityConfig.findUnique({
    where: { userId_personalityId: { userId: user.id, personalityId } },
    select: { personaId: true, focusModeEnabled: true },
  });

  const personaId = config?.personaId ?? (await getDefaultPersonaId(prisma, user.id));

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
    '[Memory] Stats retrieved'
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
      focusModeEnabled: config?.focusModeEnabled ?? false,
    },
    StatusCodes.OK
  );
}

/**
 * Handler for GET /user/memory/focus
 */
async function handleGetFocus(
  prisma: PrismaClient,
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const discordUserId = req.userId;
  const { personalityId } = req.query as { personalityId?: string };

  if (personalityId === undefined || personalityId === '') {
    sendError(res, ErrorResponses.validationError('personalityId query parameter is required'));
    return;
  }

  const user = await getUserByDiscordId(prisma, discordUserId, res);
  if (!user) {
    return;
  }

  const config = await prisma.userPersonalityConfig.findUnique({
    where: { userId_personalityId: { userId: user.id, personalityId } },
    select: { focusModeEnabled: true },
  });

  sendCustomSuccess(
    res,
    {
      personalityId,
      focusModeEnabled: config?.focusModeEnabled ?? false,
    },
    StatusCodes.OK
  );
}

/**
 * Handler for POST /user/memory/focus
 */
async function handleSetFocus(
  prisma: PrismaClient,
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const discordUserId = req.userId;
  const { personalityId, enabled } = req.body as FocusModeRequest;

  if (personalityId === undefined || personalityId === '') {
    sendError(res, ErrorResponses.validationError('personalityId is required'));
    return;
  }
  if (typeof enabled !== 'boolean') {
    sendError(res, ErrorResponses.validationError('enabled must be a boolean'));
    return;
  }

  const user = await getUserByDiscordId(prisma, discordUserId, res);
  if (!user) {
    return;
  }

  const personality = await getPersonalityById(prisma, personalityId, res);
  if (!personality) {
    return;
  }

  await prisma.userPersonalityConfig.upsert({
    where: { userId_personalityId: { userId: user.id, personalityId } },
    update: { focusModeEnabled: enabled },
    create: {
      id: generateUserPersonalityConfigUuid(user.id, personalityId),
      userId: user.id,
      personalityId,
      focusModeEnabled: enabled,
    },
  });

  logger.info(
    { discordUserId, personalityId, enabled },
    `[Memory] Focus mode ${enabled ? 'enabled' : 'disabled'}`
  );

  sendCustomSuccess(
    res,
    {
      personalityId,
      personalityName: personality.name,
      focusModeEnabled: enabled,
      message: enabled
        ? 'Focus mode enabled. Long-term memories will not be retrieved during conversations.'
        : 'Focus mode disabled. Long-term memories will be retrieved during conversations.',
    },
    StatusCodes.OK
  );
}

// eslint-disable-next-line max-lines-per-function -- Route factory with many endpoint definitions
export function createMemoryRoutes(prisma: PrismaClient): Router {
  const router = Router();

  router.get(
    '/stats',
    requireUserAuth(),
    asyncHandler((req: AuthenticatedRequest, res: Response) => handleGetStats(prisma, req, res))
  );

  router.get(
    '/list',
    requireUserAuth(),
    asyncHandler((req: AuthenticatedRequest, res: Response) =>
      handleList(
        prisma,
        (id, r) => getUserByDiscordId(prisma, id, r),
        getDefaultPersonaId,
        req,
        res
      )
    )
  );

  router.get(
    '/focus',
    requireUserAuth(),
    asyncHandler((req: AuthenticatedRequest, res: Response) => handleGetFocus(prisma, req, res))
  );

  router.post(
    '/focus',
    requireUserAuth(),
    asyncHandler((req: AuthenticatedRequest, res: Response) => handleSetFocus(prisma, req, res))
  );

  router.post(
    '/search',
    requireUserAuth(),
    asyncHandler((req: AuthenticatedRequest, res: Response) =>
      handleSearch(
        prisma,
        (id, r) => getUserByDiscordId(prisma, id, r),
        getDefaultPersonaId,
        req,
        res
      )
    )
  );

  // Batch operations - must come before /:id routes
  router.get(
    '/delete/preview',
    requireUserAuth(),
    asyncHandler((req: AuthenticatedRequest, res: Response) =>
      handleBatchDeletePreview(
        prisma,
        (id, r) => getUserByDiscordId(prisma, id, r),
        getDefaultPersonaId,
        req,
        res
      )
    )
  );

  router.post(
    '/delete',
    requireUserAuth(),
    asyncHandler((req: AuthenticatedRequest, res: Response) =>
      handleBatchDelete(
        prisma,
        (id, r) => getUserByDiscordId(prisma, id, r),
        getDefaultPersonaId,
        req,
        res
      )
    )
  );

  router.post(
    '/purge',
    requireUserAuth(),
    asyncHandler((req: AuthenticatedRequest, res: Response) =>
      handlePurge(
        prisma,
        (id, r) => getUserByDiscordId(prisma, id, r),
        getDefaultPersonaId,
        req,
        res
      )
    )
  );

  // Single memory operations - must come after specific routes like /stats, /list, /search, /delete, /purge
  router.get(
    '/:id',
    requireUserAuth(),
    asyncHandler((req: AuthenticatedRequest, res: Response) =>
      handleGetMemory(
        prisma,
        (id, r) => getUserByDiscordId(prisma, id, r),
        getDefaultPersonaId,
        req,
        res
      )
    )
  );

  router.patch(
    '/:id',
    requireUserAuth(),
    asyncHandler((req: AuthenticatedRequest, res: Response) =>
      handleUpdateMemory(
        prisma,
        (id, r) => getUserByDiscordId(prisma, id, r),
        getDefaultPersonaId,
        req,
        res
      )
    )
  );

  router.delete(
    '/:id',
    requireUserAuth(),
    asyncHandler((req: AuthenticatedRequest, res: Response) =>
      handleDeleteMemory(
        prisma,
        (id, r) => getUserByDiscordId(prisma, id, r),
        getDefaultPersonaId,
        req,
        res
      )
    )
  );

  router.post(
    '/:id/lock',
    requireUserAuth(),
    asyncHandler((req: AuthenticatedRequest, res: Response) =>
      handleToggleLock(
        prisma,
        (id, r) => getUserByDiscordId(prisma, id, r),
        getDefaultPersonaId,
        req,
        res
      )
    )
  );

  return router;
}
