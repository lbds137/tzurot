/**
 * Private helpers for memoryBatch.ts handlers.
 *
 * Extracted to a sibling file to keep memoryBatch.ts under the max-lines
 * threshold — these helpers are not part of the public API and have exactly
 * one caller each (the corresponding batch handler).
 */

import type { Response } from 'express';
import type { Redis } from 'ioredis';
import { StatusCodes } from 'http-status-codes';
import { Prisma, type PrismaClient } from '@tzurot/common-types/services/prisma';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { RouteDeps } from '../routeDeps.js';
import { sendError, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import { parseTimeframeFilter } from './memoryHelpers.js';

const logger = createLogger('memory-batch-helpers');

/**
 * 503-guard for Redis-dependent batch routes. Returns the Redis client if
 * configured, otherwise sends a 503 and returns null. Mirrors the pattern
 * in memoryIncognito.ts's `requireRedis`.
 */
export function requireRedis(deps: RouteDeps, res: Response): Redis | null {
  if (deps.redis === undefined) {
    sendError(
      res,
      ErrorResponses.serviceUnavailable(
        'Batch memory operations require Redis; service unavailable.'
      )
    );
    return null;
  }
  return deps.redis;
}

/**
 * Resolve and validate the personaId for a batch delete preview.
 * Returns null and sends an error response on failure.
 */
export async function resolvePersonaIdForBatch(
  prisma: PrismaClient,
  userId: string,
  requestedPersonaId: string | undefined,
  res: Response,
  getDefaultPersonaId: (p: PrismaClient, uid: string) => Promise<string | null>
): Promise<string | null> {
  let personaId = requestedPersonaId;
  if (personaId === undefined || personaId === '') {
    const defaultPersonaId = await getDefaultPersonaId(prisma, userId);
    if (defaultPersonaId === null) {
      sendError(res, ErrorResponses.validationError('No persona found. Create one first.'));
      return null;
    }
    personaId = defaultPersonaId;
  }

  const persona = await prisma.persona.findUnique({
    where: { id: personaId },
    select: { id: true, ownerId: true },
  });

  // Intentional 403/404 conflation: a missing persona (`persona` is null) and a
  // persona owned by someone else both return the same `forbidden` response.
  // Distinguishing them would let a caller probe which persona IDs exist
  // (existence enumeration), so we deliberately collapse both into one 403.
  if (persona?.ownerId !== userId) {
    sendError(res, ErrorResponses.forbidden('Persona not found or does not belong to you'));
    return null;
  }

  return personaId;
}

/**
 * Post-consume execute phase for handleBatchDelete. Pulled into its own
 * function so the outer handler stays under the eslint max-lines-per-function
 * threshold. The split is at the natural seam: peek/validate/consume guards
 * the entry; this helper owns timeframe-parse + count + soft-delete + reply.
 */
export interface ExecuteBatchDeleteParams {
  prisma: PrismaClient;
  res: Response;
  discordUserId: string;
  personalityId: string;
  personalityName: string;
  personaId: string;
  timeframe: string | undefined;
}

export async function executeBatchDelete(params: ExecuteBatchDeleteParams): Promise<void> {
  const { prisma, res, discordUserId, personalityId, personalityName, personaId, timeframe } =
    params;

  const where: Prisma.MemoryWhereInput = {
    personaId,
    personalityId,
    visibility: 'normal',
    isLocked: false,
  };

  const timeframeParsed = parseTimeframeFilter(timeframe);
  if (timeframeParsed.error !== undefined) {
    sendError(res, ErrorResponses.validationError(timeframeParsed.error));
    return;
  }
  if (timeframeParsed.filter !== null) {
    where.createdAt = timeframeParsed.filter;
  }

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

  const lockedCount = await prisma.memory.count({
    where: {
      personaId,
      personalityId,
      visibility: 'normal',
      isLocked: true,
      ...(timeframeParsed.filter !== null ? { createdAt: timeframeParsed.filter } : {}),
    },
  });

  const result = await prisma.memory.updateMany({
    where,
    data: { visibility: 'deleted', updatedAt: new Date() },
  });

  logger.warn(
    {
      discordUserId,
      personalityId,
      personalityName,
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
      personalityName,
      message:
        lockedCount > 0
          ? `Deleted ${result.count} memories. ${lockedCount} locked memories were skipped.`
          : `Deleted ${result.count} memories.`,
    },
    StatusCodes.OK
  );
}
