/**
 * Batch Memory Operations
 * Handles bulk deletion and purge operations for memories
 *
 * POST /user/memory/delete - Batch delete with filters (skips locked)
 * POST /user/memory/purge - Purge all memories for personality (skips locked)
 */

import type { Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { createLogger, type PrismaClient, Prisma } from '@tzurot/common-types';
import { sendError, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import type { AuthenticatedRequest } from '../../types.js';

const logger = createLogger('memory-batch');

/**
 * Parse timeframe string to milliseconds
 * Supports: 1h, 24h, 7d, 30d, 1y
 */
function parseTimeframe(timeframe: string): number | null {
  const match = /^(\d+)(h|d|y)$/.exec(timeframe);
  if (!match) {
    return null;
  }

  const value = parseInt(match[1], 10);
  const unit = match[2];

  switch (unit) {
    case 'h':
      return value * 60 * 60 * 1000;
    case 'd':
      return value * 24 * 60 * 60 * 1000;
    case 'y':
      return value * 365 * 24 * 60 * 60 * 1000;
    default:
      return null;
  }
}

interface BatchDeleteRequest {
  personalityId: string;
  personaId?: string;
  timeframe?: string; // e.g., "7d", "30d", "1y"
}

interface PurgeRequest {
  personalityId: string;
  confirmationPhrase?: string;
}

type GetUserByDiscordId = (discordUserId: string, res: Response) => Promise<{ id: string } | null>;

type GetDefaultPersonaId = (prisma: PrismaClient, userId: string) => Promise<string | null>;

/**
 * Handler for POST /user/memory/delete
 * Batch delete memories with filters (skips locked memories)
 */
// eslint-disable-next-line max-lines-per-function -- Procedural handler with sequential validation steps
export async function handleBatchDelete(
  prisma: PrismaClient,
  getUserByDiscordId: GetUserByDiscordId,
  getDefaultPersonaId: GetDefaultPersonaId,
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const discordUserId = req.userId;
  const {
    personalityId,
    personaId: requestedPersonaId,
    timeframe,
  } = req.body as BatchDeleteRequest;

  // Validate required fields
  if (!personalityId) {
    sendError(res, ErrorResponses.validationError('personalityId is required'));
    return;
  }

  // Get user
  const user = await getUserByDiscordId(discordUserId, res);
  if (!user) {
    return;
  }

  // Validate personality exists
  const personality = await prisma.personality.findUnique({
    where: { id: personalityId },
    select: { id: true, name: true },
  });

  if (!personality) {
    sendError(res, ErrorResponses.notFound('Personality not found'));
    return;
  }

  // Determine persona ID
  let personaId = requestedPersonaId;
  if (personaId === undefined || personaId === '') {
    const defaultPersonaId = await getDefaultPersonaId(prisma, user.id);
    if (defaultPersonaId === null) {
      sendError(res, ErrorResponses.validationError('No persona found. Create one first.'));
      return;
    }
    personaId = defaultPersonaId;
  }

  // Verify persona belongs to user
  const persona = await prisma.persona.findUnique({
    where: { id: personaId },
    select: { id: true, ownerId: true },
  });

  if (persona?.ownerId !== user.id) {
    sendError(res, ErrorResponses.forbidden('Persona not found or does not belong to you'));
    return;
  }

  // Build where clause for batch delete
  const where: Prisma.MemoryWhereInput = {
    personaId,
    personalityId,
    visibility: 'normal', // Only delete normal (visible) memories
    isLocked: false, // Skip locked memories
  };

  // Add timeframe filter if provided
  if (timeframe !== undefined && timeframe !== '') {
    const timeframeMs = parseTimeframe(timeframe);
    if (timeframeMs === null) {
      sendError(
        res,
        ErrorResponses.validationError('Invalid timeframe format. Use: 1h, 24h, 7d, 30d, 1y')
      );
      return;
    }

    const cutoffDate = new Date(Date.now() - timeframeMs);
    where.createdAt = { gte: cutoffDate };
  }

  // Count memories that will be deleted
  const countToDelete = await prisma.memory.count({ where });

  if (countToDelete === 0) {
    sendCustomSuccess(
      res,
      {
        deletedCount: 0,
        skippedLocked: 0,
        message: 'No memories found matching the criteria',
      },
      StatusCodes.OK
    );
    return;
  }

  // Count locked memories that would have matched (for informational purposes)
  const lockedCount = await prisma.memory.count({
    where: {
      ...where,
      isLocked: true,
      visibility: 'normal',
    },
  });

  // Perform soft delete
  const result = await prisma.memory.updateMany({
    where,
    data: {
      visibility: 'deleted',
      updatedAt: new Date(),
    },
  });

  logger.warn(
    {
      discordUserId,
      personalityId,
      personalityName: personality.name,
      personaId: personaId.substring(0, 8),
      timeframe: timeframe ?? 'all',
      deletedCount: result.count,
      skippedLocked: lockedCount,
    },
    '[Memory] Batch delete completed'
  );

  sendCustomSuccess(
    res,
    {
      deletedCount: result.count,
      skippedLocked: lockedCount,
      personalityId,
      personalityName: personality.name,
      message:
        lockedCount > 0
          ? `Deleted ${result.count} memories. ${lockedCount} locked memories were skipped.`
          : `Deleted ${result.count} memories.`,
    },
    StatusCodes.OK
  );
}

/**
 * Handler for POST /user/memory/purge
 * Purge all memories for a personality (skips locked memories)
 * Requires typed confirmation phrase
 */
export async function handlePurge(
  prisma: PrismaClient,
  getUserByDiscordId: GetUserByDiscordId,
  getDefaultPersonaId: GetDefaultPersonaId,
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const discordUserId = req.userId;
  const { personalityId, confirmationPhrase } = req.body as PurgeRequest;

  // Validate required fields
  if (!personalityId) {
    sendError(res, ErrorResponses.validationError('personalityId is required'));
    return;
  }

  // Get user
  const user = await getUserByDiscordId(discordUserId, res);
  if (!user) {
    return;
  }

  // Validate personality exists
  const personality = await prisma.personality.findUnique({
    where: { id: personalityId },
    select: { id: true, name: true },
  });

  if (!personality) {
    sendError(res, ErrorResponses.notFound('Personality not found'));
    return;
  }

  // Generate expected confirmation phrase
  const expectedPhrase = `DELETE ${personality.name.toUpperCase()} MEMORIES`;

  // Validate confirmation phrase
  if (confirmationPhrase === undefined || confirmationPhrase !== expectedPhrase) {
    sendError(
      res,
      ErrorResponses.validationError(`Confirmation required. Type exactly: "${expectedPhrase}"`)
    );
    return;
  }

  // Get user's persona
  const defaultPersonaId = await getDefaultPersonaId(prisma, user.id);
  if (defaultPersonaId === null) {
    sendError(res, ErrorResponses.validationError('No persona found. Create one first.'));
    return;
  }

  // Count memories before purge
  const totalCount = await prisma.memory.count({
    where: {
      personaId: defaultPersonaId,
      personalityId,
      visibility: 'normal',
    },
  });

  const lockedCount = await prisma.memory.count({
    where: {
      personaId: defaultPersonaId,
      personalityId,
      visibility: 'normal',
      isLocked: true,
    },
  });

  // Perform soft delete on all non-locked memories
  const result = await prisma.memory.updateMany({
    where: {
      personaId: defaultPersonaId,
      personalityId,
      visibility: 'normal',
      isLocked: false,
    },
    data: {
      visibility: 'deleted',
      updatedAt: new Date(),
    },
  });

  logger.warn(
    {
      discordUserId,
      personalityId,
      personalityName: personality.name,
      personaId: defaultPersonaId.substring(0, 8),
      totalBefore: totalCount,
      deletedCount: result.count,
      lockedPreserved: lockedCount,
    },
    '[Memory] PURGE completed'
  );

  sendCustomSuccess(
    res,
    {
      deletedCount: result.count,
      lockedPreserved: lockedCount,
      personalityId,
      personalityName: personality.name,
      message:
        lockedCount > 0
          ? `Purged ${result.count} memories for ${personality.name}. ${lockedCount} locked (core) memories were preserved.`
          : `Purged all ${result.count} memories for ${personality.name}.`,
    },
    StatusCodes.OK
  );
}

/**
 * Handler for GET /user/memory/delete/preview
 * Preview what would be deleted without actually deleting
 */
export async function handleBatchDeletePreview(
  prisma: PrismaClient,
  getUserByDiscordId: GetUserByDiscordId,
  getDefaultPersonaId: GetDefaultPersonaId,
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const discordUserId = req.userId;
  const {
    personalityId,
    personaId: requestedPersonaId,
    timeframe,
  } = req.query as {
    personalityId?: string;
    personaId?: string;
    timeframe?: string;
  };

  // Validate required fields
  if (personalityId === undefined || personalityId === '') {
    sendError(res, ErrorResponses.validationError('personalityId query parameter is required'));
    return;
  }

  // Get user
  const user = await getUserByDiscordId(discordUserId, res);
  if (!user) {
    return;
  }

  // Validate personality exists
  const personality = await prisma.personality.findUnique({
    where: { id: personalityId },
    select: { id: true, name: true },
  });

  if (!personality) {
    sendError(res, ErrorResponses.notFound('Personality not found'));
    return;
  }

  // Determine persona ID
  let personaId = requestedPersonaId;
  if (personaId === undefined || personaId === '') {
    const defaultPersonaId = await getDefaultPersonaId(prisma, user.id);
    if (defaultPersonaId === null) {
      sendCustomSuccess(
        res,
        {
          wouldDelete: 0,
          lockedWouldSkip: 0,
          message: 'No persona found',
        },
        StatusCodes.OK
      );
      return;
    }
    personaId = defaultPersonaId;
  }

  // Build where clause
  const where: Prisma.MemoryWhereInput = {
    personaId,
    personalityId,
    visibility: 'normal',
    isLocked: false,
  };

  // Add timeframe filter if provided
  if (timeframe !== undefined && timeframe !== '') {
    const timeframeMs = parseTimeframe(timeframe);
    if (timeframeMs === null) {
      sendError(
        res,
        ErrorResponses.validationError('Invalid timeframe format. Use: 1h, 24h, 7d, 30d, 1y')
      );
      return;
    }

    const cutoffDate = new Date(Date.now() - timeframeMs);
    where.createdAt = { gte: cutoffDate };
  }

  // Count memories that would be deleted
  const wouldDelete = await prisma.memory.count({ where });
  const lockedWouldSkip = await prisma.memory.count({
    where: {
      ...where,
      isLocked: true,
    },
  });

  sendCustomSuccess(
    res,
    {
      wouldDelete,
      lockedWouldSkip,
      personalityId,
      personalityName: personality.name,
      timeframe: timeframe ?? 'all',
    },
    StatusCodes.OK
  );
}
