/**
 * User Memory Routes
 * LTM (Long-Term Memory) management endpoints
 *
 * This module owns only the stats handler; its siblings (memoryList,
 * memorySearch, memorySingle, memoryBatch, memoryIncognito, memoryFresh)
 * own the rest of the /user/memory/* surface. The generated mounts.ts
 * registers every handler export directly — there is no local router
 * factory.
 */

import { type RequestHandler, type Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { RouteDeps } from '../routeDeps.js';
import { MemoryModeSessionManager } from '../../services/MemoryModeSessionManager.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendError, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import type { ProvisionedRequest } from '../../types.js';
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
