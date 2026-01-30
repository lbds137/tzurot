/**
 * User Memory Incognito Routes
 * Incognito mode management - temporarily disable memory writing
 *
 * GET /user/memory/incognito - Get current incognito status
 * POST /user/memory/incognito - Enable incognito mode
 * DELETE /user/memory/incognito - Disable incognito mode
 * POST /user/memory/incognito/forget - Retroactively delete recent memories
 */

import { Router, type Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import type { Redis } from 'ioredis';
import {
  createLogger,
  getDurationLabel,
  type PrismaClient,
  EnableIncognitoRequestSchema,
  DisableIncognitoRequestSchema,
  IncognitoForgetRequestSchema,
} from '@tzurot/common-types';
import { requireUserAuth } from '../../services/AuthMiddleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendError, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import type { AuthenticatedRequest } from '../../types.js';
import { IncognitoSessionManager } from '../../services/IncognitoSessionManager.js';

const logger = createLogger('user-memory-incognito');

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
    '[Incognito] Status checked'
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
      sendError(res, ErrorResponses.notFound('Personality not found'));
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
        message: `Incognito mode is already active for ${personalityName ?? 'this personality'}. Disable it first to change duration.`,
      },
      StatusCodes.OK
    );
    return;
  }

  const session = await manager.enable(discordUserId, personalityId, duration);
  const personalityName = await getPersonalityName(prisma, personalityId);

  logger.info({ discordUserId, personalityId, duration }, '[Incognito] Mode enabled');

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

  logger.info({ discordUserId, personalityId }, '[Incognito] Mode disabled');

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
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const discordUserId = req.userId;
  const parseResult = IncognitoForgetRequestSchema.safeParse(req.body);

  if (!parseResult.success) {
    sendError(res, ErrorResponses.validationError(parseResult.error.message));
    return;
  }

  const { personalityId, timeframe } = parseResult.data;

  const user = await getUserByDiscordId(prisma, discordUserId, res);
  if (!user) {
    return;
  }

  // Get persona ID for the user
  const personaId = await getDefaultPersonaId(prisma, user.id);
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
    personalityId?: string;
  }

  const whereClause: WhereClause = {
    personaId,
    createdAt: { gte: cutoff },
    isLocked: false, // Don't delete locked memories
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
    '[Incognito] Retroactive forget executed'
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

/**
 * Create incognito routes with injected dependencies
 */
export function createIncognitoRoutes(prisma: PrismaClient, redis: Redis): Router {
  const router = Router();
  const manager = new IncognitoSessionManager(redis);

  // GET /user/memory/incognito - Get status
  router.get(
    '/',
    requireUserAuth(),
    asyncHandler((req: AuthenticatedRequest, res: Response) => handleGetStatus(manager, req, res))
  );

  // POST /user/memory/incognito - Enable
  router.post(
    '/',
    requireUserAuth(),
    asyncHandler((req: AuthenticatedRequest, res: Response) =>
      handleEnable(prisma, manager, req, res)
    )
  );

  // DELETE /user/memory/incognito - Disable
  router.delete(
    '/',
    requireUserAuth(),
    asyncHandler((req: AuthenticatedRequest, res: Response) =>
      handleDisable(prisma, manager, req, res)
    )
  );

  // POST /user/memory/incognito/forget - Retroactive delete
  router.post(
    '/forget',
    requireUserAuth(),
    asyncHandler((req: AuthenticatedRequest, res: Response) => handleForget(prisma, req, res))
  );

  return router;
}

// Export manager for use by other services (e.g., ai-worker checking status)
export { IncognitoSessionManager };
