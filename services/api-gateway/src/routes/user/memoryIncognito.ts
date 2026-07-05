/**
 * User Memory Incognito Routes
 * Incognito mode management - temporarily disable memory writing
 *
 * GET /user/memory/incognito - Get current incognito status
 * POST /user/memory/incognito - Enable incognito mode
 * DELETE /user/memory/incognito - Disable incognito mode
 * POST /user/memory/incognito/forget - Retroactively delete recent memories
 */

import { Router, type Response, type RequestHandler } from 'express';
import { StatusCodes } from 'http-status-codes';
import type { Redis } from 'ioredis';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import {
  getDurationLabel,
  EnableIncognitoRequestSchema,
  DisableIncognitoRequestSchema,
  IncognitoForgetRequestSchema,
} from '@tzurot/common-types/types/incognito';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { requireUserAuth, requireProvisionedUser } from '../../services/AuthMiddleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendError, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import type { AuthenticatedRequest, ProvisionedRequest } from '../../types.js';
import { IncognitoSessionManager } from '../../services/IncognitoSessionManager.js';
import { resolveProvisionedUserId } from '../../utils/resolveProvisionedUserId.js';
import { getDefaultPersonaId } from './memoryHelpers.js';
import type { RouteDeps } from '../routeDeps.js';

/** Incognito handlers touch only prisma + redis. */
type IncognitoDeps = Pick<RouteDeps, 'prisma' | 'redis'>;

const logger = createLogger('user-memory-incognito');

/**
 * Get personality name by ID
 */
async function getPersonalityName(
  prisma: PrismaClient,
  personalityId: string
): Promise<string | null> {
  if (personalityId === 'all') {
    return 'all personalities';
  }

  const personality = await prisma.personality.findUnique({
    where: { id: personalityId },
    select: { name: true },
  });

  return personality?.name ?? null;
}

/**
 * Handler for GET /user/memory/incognito
 * Get current incognito status for the user
 */
async function handleGetStatus(
  manager: IncognitoSessionManager,
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const discordUserId = req.userId;

  const status = await manager.getStatus(discordUserId);

  // Add time remaining to each session
  const sessionsWithTime = status.sessions.map(session => ({
    ...session,
    timeRemaining: manager.getTimeRemaining(session),
  }));

  logger.debug(
    { discordUserId, active: status.active, sessionCount: status.sessions.length },
    'Status checked'
  );

  sendCustomSuccess(
    res,
    {
      active: status.active,
      sessions: sessionsWithTime,
    },
    StatusCodes.OK
  );
}

/**
 * Handler for POST /user/memory/incognito
 * Enable incognito mode
 */
async function handleEnable(
  prisma: PrismaClient,
  manager: IncognitoSessionManager,
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const discordUserId = req.userId;
  const parseResult = EnableIncognitoRequestSchema.safeParse(req.body);

  if (!parseResult.success) {
    sendError(res, ErrorResponses.validationError(parseResult.error.message));
    return;
  }

  const { personalityId, duration } = parseResult.data;

  // Validate personality exists (unless 'all')
  if (personalityId !== 'all') {
    const personality = await prisma.personality.findUnique({
      where: { id: personalityId },
      select: { id: true },
    });

    if (!personality) {
      sendError(res, ErrorResponses.notFound('Personality'));
      return;
    }
  }

  // Check if already active for this personality
  const existingSession = await manager.getSession(discordUserId, personalityId);
  if (existingSession !== null) {
    const personalityName = await getPersonalityName(prisma, personalityId);
    sendCustomSuccess(
      res,
      {
        session: existingSession,
        timeRemaining: manager.getTimeRemaining(existingSession),
        wasAlreadyActive: true,
        // eslint-disable-next-line sonarjs/no-duplicate-string -- Status message template shared between already-active and newly-enabled responses
        message: `Incognito mode is already active for ${personalityName ?? 'this personality'}. Disable it first to change duration.`,
      },
      StatusCodes.OK
    );
    return;
  }

  const session = await manager.enable(discordUserId, personalityId, duration);
  const personalityName = await getPersonalityName(prisma, personalityId);

  logger.info({ discordUserId, personalityId, duration }, 'Mode enabled');

  sendCustomSuccess(
    res,
    {
      session,
      timeRemaining: manager.getTimeRemaining(session),
      wasAlreadyActive: false,
      message: `👻 Incognito mode enabled for ${personalityName ?? 'this personality'} (${getDurationLabel(duration)}). New memories will NOT be saved.`,
    },
    StatusCodes.CREATED
  );
}

/**
 * Handler for DELETE /user/memory/incognito
 * Disable incognito mode
 */
async function handleDisable(
  prisma: PrismaClient,
  manager: IncognitoSessionManager,
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const discordUserId = req.userId;
  const parseResult = DisableIncognitoRequestSchema.safeParse(req.body);

  if (!parseResult.success) {
    sendError(res, ErrorResponses.validationError(parseResult.error.message));
    return;
  }

  const { personalityId } = parseResult.data;

  const wasActive = await manager.disable(discordUserId, personalityId);
  const personalityName = await getPersonalityName(prisma, personalityId);

  if (!wasActive) {
    sendCustomSuccess(
      res,
      {
        disabled: false,
        message: `Incognito mode was not active for ${personalityName ?? 'this personality'}.`,
      },
      StatusCodes.OK
    );
    return;
  }

  logger.info({ discordUserId, personalityId }, 'Mode disabled');

  sendCustomSuccess(
    res,
    {
      disabled: true,
      message: `👻 Incognito mode disabled for ${personalityName ?? 'this personality'}. Memories will now be saved normally.`,
    },
    StatusCodes.OK
  );
}

/**
 * Handler for POST /user/memory/incognito/forget
 * Retroactively delete recent memories
 */
async function handleForget(
  prisma: PrismaClient,
  req: ProvisionedRequest,
  res: Response
): Promise<void> {
  const discordUserId = req.userId;
  const parseResult = IncognitoForgetRequestSchema.safeParse(req.body);

  if (!parseResult.success) {
    sendError(res, ErrorResponses.validationError(parseResult.error.message));
    return;
  }

  const { personalityId, timeframe } = parseResult.data;

  const userId = resolveProvisionedUserId(req);

  // Get persona ID for the user
  const personaId = await getDefaultPersonaId(prisma, userId);
  if (personaId === null) {
    sendCustomSuccess(
      res,
      {
        deletedCount: 0,
        personalities: [],
        message: 'No persona found - no memories to delete.',
      },
      StatusCodes.OK
    );
    return;
  }

  // Calculate cutoff time based on timeframe
  const timeframeMs: Record<string, number> = {
    '5m': 5 * 60 * 1000,
    '15m': 15 * 60 * 1000,
    '1h': 60 * 60 * 1000,
  };

  const cutoff = new Date(Date.now() - timeframeMs[timeframe]);

  // Build where clause
  interface WhereClause {
    personaId: string;
    createdAt: { gte: Date };
    isLocked: boolean;
    visibility: string;
    personalityId?: string;
  }

  const whereClause: WhereClause = {
    personaId,
    createdAt: { gte: cutoff },
    isLocked: false, // Don't delete locked memories
    // Only live memories: without this, already-soft-deleted rows are
    // re-counted and the reported "forgot N memories" total is inflated.
    visibility: 'normal',
  };

  if (personalityId !== 'all') {
    whereClause.personalityId = personalityId;
  }

  // Get affected personality names before deleting (bounded to avoid memory issues)
  const affectedMemories = await prisma.memory.findMany({
    where: whereClause,
    select: {
      personalityId: true,
      personality: { select: { name: true } },
    },
    distinct: ['personalityId'],
    take: 50, // A user won't have memories for more than 50 personalities in a short window
  });

  const personalityNames = affectedMemories.map(m => m.personality.name);

  // Delete memories
  const deleteResult = await prisma.memory.deleteMany({
    where: whereClause,
  });

  logger.info(
    {
      discordUserId,
      personalityId,
      timeframe,
      deletedCount: deleteResult.count,
      cutoff: cutoff.toISOString(),
    },
    'Retroactive forget executed'
  );

  sendCustomSuccess(
    res,
    {
      deletedCount: deleteResult.count,
      personalities: personalityNames,
      message:
        deleteResult.count > 0
          ? `🗑️ Deleted ${deleteResult.count} memories from the last ${timeframe}.`
          : `No memories found in the last ${timeframe} to delete.`,
    },
    StatusCodes.OK
  );
}

// ===== Handler factories ===================================================
//
// `IncognitoSessionManager` is a thin wrapper around the Redis client with no
// per-construction state, so each request creates a fresh manager — cheap and
// keeps the 503 guard for missing-redis inside the request scope where we can
// send a response. If profiling ever shows this is a hot path, hoist the
// `new IncognitoSessionManager(...)` into the factory body behind a redis-
// present guard.

function requireRedis(deps: IncognitoDeps, res: Response): Redis | null {
  if (deps.redis === undefined) {
    sendError(
      res,
      ErrorResponses.serviceUnavailable('Redis required for incognito mode is not configured')
    );
    return null;
  }
  return deps.redis;
}

/** GET /api/user/memory/incognito */
export const handleGetIncognitoStatus = (deps: IncognitoDeps): RequestHandler =>
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const redis = requireRedis(deps, res);
    if (redis === null) {
      return;
    }
    const manager = new IncognitoSessionManager(redis);
    await handleGetStatus(manager, req, res);
  });

/** POST /api/user/memory/incognito */
export const handleEnableIncognito = (deps: IncognitoDeps): RequestHandler =>
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const redis = requireRedis(deps, res);
    if (redis === null) {
      return;
    }
    const manager = new IncognitoSessionManager(redis);
    await handleEnable(deps.prisma, manager, req, res);
  });

/** DELETE /api/user/memory/incognito */
export const handleDisableIncognito = (deps: IncognitoDeps): RequestHandler =>
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const redis = requireRedis(deps, res);
    if (redis === null) {
      return;
    }
    const manager = new IncognitoSessionManager(redis);
    await handleDisable(deps.prisma, manager, req, res);
  });

/** POST /api/user/memory/incognito/forget */
export const handleIncognitoForget = (deps: IncognitoDeps): RequestHandler =>
  asyncHandler((req: ProvisionedRequest, res: Response) => handleForget(deps.prisma, req, res));

/**
 * Legacy aggregator-style factory — preserved for the existing top-level
 * user-router wiring. The generated mounts.ts uses the named handler exports
 * above directly.
 */
export function createIncognitoRoutes(prisma: PrismaClient, redis: Redis): Router {
  const router = Router();
  const deps: IncognitoDeps = { prisma, redis };

  router.get(
    '/',
    requireUserAuth(),
    requireProvisionedUser(prisma),
    handleGetIncognitoStatus(deps)
  );
  router.post('/', requireUserAuth(), requireProvisionedUser(prisma), handleEnableIncognito(deps));
  router.delete(
    '/',
    requireUserAuth(),
    requireProvisionedUser(prisma),
    handleDisableIncognito(deps)
  );
  router.post(
    '/forget',
    requireUserAuth(),
    requireProvisionedUser(prisma),
    handleIncognitoForget(deps)
  );

  return router;
}

// Export manager for use by other services (e.g., ai-worker checking status)
