/**
 * User Memory Incognito Routes
 * Incognito mode management - temporarily disable memory writing
 *
 * GET /user/memory/incognito - Get current incognito status (optional
 *   `personalityId` query filters to sessions that apply to that character)
 * POST /user/memory/incognito - Enable incognito mode
 * DELETE /user/memory/incognito - Disable incognito mode
 * POST /user/memory/incognito/forget - Retroactively delete recent memories
 *
 * Status/enable/disable are the shared memory-mode handlers (see
 * memoryModeHandlers.ts — fresh mode uses the same machinery); `forget` is
 * write-side-specific and lives here.
 */

import { Router, type Response, type RequestHandler } from 'express';
import { StatusCodes } from 'http-status-codes';
import type { Redis } from 'ioredis';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import { IncognitoForgetRequestSchema } from '@tzurot/common-types/types/memory-modes';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { requireUserAuth, requireProvisionedUser } from '../../services/AuthMiddleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendError, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import type { ProvisionedRequest } from '../../types.js';
import { resolveProvisionedUserId } from '../../utils/resolveProvisionedUserId.js';
import { getDefaultPersonaId } from './memoryHelpers.js';
import { createMemoryModeHandlers, type MemoryModeDeps } from './memoryModeHandlers.js';

const logger = createLogger('user-memory-incognito');

const incognitoHandlers = createMemoryModeHandlers('incognito', {
  alreadyActive: name =>
    `Incognito mode is already active for ${name}. Disable it first to change duration.`,
  enabled: (name, durationLabel) =>
    `👻 Incognito mode enabled for ${name} (${durationLabel}). New memories will NOT be saved.`,
  notActive: name => `Incognito mode was not active for ${name}.`,
  disabled: name => `👻 Incognito mode disabled for ${name}. Memories will now be saved normally.`,
});

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

/** GET /api/user/memory/incognito */
export const handleGetIncognitoStatus = incognitoHandlers.handleStatus;

/** POST /api/user/memory/incognito */
export const handleEnableIncognito = incognitoHandlers.handleEnable;

/** DELETE /api/user/memory/incognito */
export const handleDisableIncognito = incognitoHandlers.handleDisable;

/** POST /api/user/memory/incognito/forget */
export const handleIncognitoForget = (deps: MemoryModeDeps): RequestHandler =>
  asyncHandler((req: ProvisionedRequest, res: Response) => handleForget(deps.prisma, req, res));

/**
 * Legacy aggregator-style factory — preserved for the existing top-level
 * user-router wiring. The generated mounts.ts uses the named handler exports
 * above directly.
 */
export function createIncognitoRoutes(prisma: PrismaClient, redis: Redis): Router {
  const router = Router();
  const deps: MemoryModeDeps = { prisma, redis };

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
