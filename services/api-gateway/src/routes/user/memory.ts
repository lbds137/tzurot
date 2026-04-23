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
 *
 * Incognito mode (sub-routes mounted at /user/memory/incognito):
 * GET /user/memory/incognito - Get incognito status
 * POST /user/memory/incognito - Enable incognito mode
 * DELETE /user/memory/incognito - Disable incognito mode
 * POST /user/memory/incognito/forget - Retroactively delete recent memories
 */

import { Router, type Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import type { Redis } from 'ioredis';
import {
  createLogger,
  Prisma,
  UserService,
  type PrismaClient,
  generateUserPersonalityConfigUuid,
  FocusModeSchema,
} from '@tzurot/common-types';
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
  handleToggleLock,
  handleDeleteMemory,
} from './memorySingle.js';
import { handleBatchDelete, handleBatchDeletePreview, handlePurge } from './memoryBatch.js';
import { createIncognitoRoutes } from './memoryIncognito.js';
import { getProvisionedUserId, getDefaultPersonaId, getPersonalityById } from './memoryHelpers.js';

const logger = createLogger('user-memory');

/**
 * Handler for GET /user/memory/stats
 */
async function handleGetStats(
  prisma: PrismaClient,
  userService: UserService,
  req: ProvisionedRequest,
  res: Response
): Promise<void> {
  const discordUserId = req.userId;
  const { personalityId } = req.query as { personalityId?: string };

  if (personalityId === undefined || personalityId === '') {
    sendError(res, ErrorResponses.validationError('personalityId query parameter is required'));
    return;
  }

  const user = await getProvisionedUserId(req, userService, res);
  if (!user) {
    return;
  }

  const personality = await getPersonalityById(prisma, personalityId, res);
  if (!personality) {
    return;
  }

  const config = await prisma.userPersonalityConfig.findUnique({
    where: { userId_personalityId: { userId: user.id, personalityId } },
    select: { personaId: true, configOverrides: true },
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
}

/**
 * Handler for GET /user/memory/focus
 */
async function handleGetFocus(
  prisma: PrismaClient,
  userService: UserService,
  req: ProvisionedRequest,
  res: Response
): Promise<void> {
  const { personalityId } = req.query as { personalityId?: string };

  if (personalityId === undefined || personalityId === '') {
    sendError(res, ErrorResponses.validationError('personalityId query parameter is required'));
    return;
  }

  const user = await getProvisionedUserId(req, userService, res);
  if (!user) {
    return;
  }

  const config = await prisma.userPersonalityConfig.findUnique({
    where: { userId_personalityId: { userId: user.id, personalityId } },
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
}

/**
 * Handler for POST /user/memory/focus
 */
async function handleSetFocus(
  prisma: PrismaClient,
  userService: UserService,
  req: ProvisionedRequest,
  res: Response
): Promise<void> {
  const discordUserId = req.userId;

  const parseResult = FocusModeSchema.safeParse(req.body);
  if (!parseResult.success) {
    sendZodError(res, parseResult.error);
    return;
  }

  const { personalityId, enabled } = parseResult.data;

  const user = await getProvisionedUserId(req, userService, res);
  if (!user) {
    return;
  }

  const personality = await getPersonalityById(prisma, personalityId, res);
  if (!personality) {
    return;
  }

  // Read existing configOverrides to merge focusModeEnabled into JSONB
  const upcId = generateUserPersonalityConfigUuid(user.id, personalityId);
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

  // Merge focusModeEnabled into JSONB (dual-write: column + JSONB)
  // Strip false to keep JSONB clean (false is the default)
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
    where: { userId_personalityId: { userId: user.id, personalityId } },
    update: { configOverrides: configOverridesValue },
    create: {
      id: upcId,
      userId: user.id,
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
}

/**
 * Handler signature common to every memory route: takes prisma + userService +
 * the provisioned request, returns a promise. Defined locally to avoid
 * exporting the shape.
 */
type MemoryHandler = (
  prisma: PrismaClient,
  userService: UserService,
  req: ProvisionedRequest,
  res: Response
) => Promise<void>;

interface RegisterRouteParams {
  router: Router;
  prisma: PrismaClient;
  userService: UserService;
  method: 'get' | 'post' | 'patch' | 'delete';
  path: string;
  handler: MemoryHandler;
}

function registerMemoryRoute(params: RegisterRouteParams): void {
  const { router, prisma, userService, method, path, handler } = params;
  router[method](
    path,
    requireUserAuth(),
    requireProvisionedUser(prisma),
    asyncHandler((req: ProvisionedRequest, res: Response) => handler(prisma, userService, req, res))
  );
}

export function createMemoryRoutes(prisma: PrismaClient, redis?: Redis): Router {
  const router = Router();
  const userService = new UserService(prisma);

  // Incognito mode routes (requires Redis)
  if (redis !== undefined) {
    router.use('/incognito', createIncognitoRoutes(prisma, redis));
  }

  const routes: {
    method: RegisterRouteParams['method'];
    path: string;
    handler: MemoryHandler;
  }[] = [
    { method: 'get', path: '/stats', handler: handleGetStats },
    { method: 'get', path: '/list', handler: handleList },
    { method: 'get', path: '/focus', handler: handleGetFocus },
    { method: 'post', path: '/focus', handler: handleSetFocus },
    { method: 'post', path: '/search', handler: handleSearch },
    // Batch operations — must come before /:id routes
    { method: 'get', path: '/delete/preview', handler: handleBatchDeletePreview },
    { method: 'post', path: '/delete', handler: handleBatchDelete },
    { method: 'post', path: '/purge', handler: handlePurge },
    // Single memory operations — must come after specific routes
    { method: 'get', path: '/:id', handler: handleGetMemory },
    { method: 'patch', path: '/:id', handler: handleUpdateMemory },
    { method: 'delete', path: '/:id', handler: handleDeleteMemory },
    { method: 'post', path: '/:id/lock', handler: handleToggleLock },
  ];

  for (const route of routes) {
    registerMemoryRoute({
      router,
      prisma,
      userService,
      method: route.method,
      path: route.path,
      handler: route.handler,
    });
  }

  return router;
}
