/**
 * Shared handler factories for the two memory-mode route families
 * (/user/memory/incognito and /user/memory/fresh).
 *
 * Both modes are MemoryModeSessionManager sessions with identical
 * status/enable/disable mechanics; only the Redis key prefix (mode) and the
 * user-facing copy differ, so each route file supplies a `MemoryModeRouteCopy`
 * and gets back the three handler factories. Incognito's `forget` action is
 * write-side-specific and stays in memoryIncognito.ts.
 */

import { type Response, type RequestHandler } from 'express';
import { StatusCodes } from 'http-status-codes';
import type { Redis } from 'ioredis';
import { z } from 'zod';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import {
  getDurationLabel,
  EnableMemoryModeRequestSchema,
  DisableMemoryModeRequestSchema,
} from '@tzurot/common-types/types/memory-modes';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendError, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import type { AuthenticatedRequest } from '../../types.js';
import {
  MemoryModeSessionManager,
  type MemoryMode,
} from '../../services/MemoryModeSessionManager.js';
import type { RouteDeps } from '../routeDeps.js';

/** Memory-mode handlers touch only prisma + redis. */
export type MemoryModeDeps = Pick<RouteDeps, 'prisma' | 'redis'>;

const logger = createLogger('user-memory-modes');

/** User-facing copy for one mode's route family. */
export interface MemoryModeRouteCopy {
  alreadyActive: (personalityName: string) => string;
  enabled: (personalityName: string, durationLabel: string) => string;
  notActive: (personalityName: string) => string;
  disabled: (personalityName: string) => string;
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

function requireRedis(deps: MemoryModeDeps, res: Response): Redis | null {
  if (deps.redis === undefined) {
    sendError(
      res,
      ErrorResponses.serviceUnavailable('Redis required for memory modes is not configured')
    );
    return null;
  }
  return deps.redis;
}

const FALLBACK_NAME = 'this personality';

/** Status filter query — optional single personalityId (repeated keys → 400). */
const StatusQuerySchema = z.object({ personalityId: z.string().optional() });

/**
 * `MemoryModeSessionManager` is a thin wrapper around the Redis client with no
 * per-construction state, so each request creates a fresh manager — cheap and
 * keeps the 503 guard for missing-redis inside the request scope where we can
 * send a response.
 */

function buildStatusHandler(mode: MemoryMode): (deps: MemoryModeDeps) => RequestHandler {
  return (deps: MemoryModeDeps): RequestHandler =>
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const redis = requireRedis(deps, res);
      if (redis === null) {
        return;
      }
      const manager = new MemoryModeSessionManager(redis, mode);
      const discordUserId = req.userId;

      // Validate at the boundary: a repeated query key arrives as string[],
      // which should be a clear 400 rather than a silently-empty filter.
      const queryParse = StatusQuerySchema.safeParse(req.query);
      if (!queryParse.success) {
        sendError(res, ErrorResponses.validationError('personalityId must be a single string'));
        return;
      }

      const status = await manager.getStatus(discordUserId);

      // Optional character filter: keep only sessions that APPLY to the
      // given personality — its specific session plus any global 'all'
      // session (a global session affects every character).
      const { personalityId } = queryParse.data;
      const sessions =
        personalityId !== undefined && personalityId !== ''
          ? status.sessions.filter(
              s => s.personalityId === personalityId || s.personalityId === 'all'
            )
          : status.sessions;

      const sessionsWithTime = sessions.map(session => ({
        ...session,
        timeRemaining: manager.getTimeRemaining(session),
      }));

      logger.debug(
        { mode, discordUserId, active: sessions.length > 0, sessionCount: sessions.length },
        'Status checked'
      );

      sendCustomSuccess(
        res,
        {
          active: sessions.length > 0,
          sessions: sessionsWithTime,
        },
        StatusCodes.OK
      );
    });
}

function buildEnableHandler(
  mode: MemoryMode,
  copy: MemoryModeRouteCopy
): (deps: MemoryModeDeps) => RequestHandler {
  return (deps: MemoryModeDeps): RequestHandler =>
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const redis = requireRedis(deps, res);
      if (redis === null) {
        return;
      }
      const manager = new MemoryModeSessionManager(redis, mode);
      const discordUserId = req.userId;

      const parseResult = EnableMemoryModeRequestSchema.safeParse(req.body);
      if (!parseResult.success) {
        sendError(res, ErrorResponses.validationError(parseResult.error.message));
        return;
      }

      const { personalityId, duration } = parseResult.data;

      // Validate personality exists (unless 'all')
      if (personalityId !== 'all') {
        const personality = await deps.prisma.personality.findUnique({
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
        const personalityName = await getPersonalityName(deps.prisma, personalityId);
        sendCustomSuccess(
          res,
          {
            session: existingSession,
            timeRemaining: manager.getTimeRemaining(existingSession),
            wasAlreadyActive: true,
            message: copy.alreadyActive(personalityName ?? FALLBACK_NAME),
          },
          StatusCodes.OK
        );
        return;
      }

      const session = await manager.enable(discordUserId, personalityId, duration);
      const personalityName = await getPersonalityName(deps.prisma, personalityId);

      logger.info({ mode, discordUserId, personalityId, duration }, 'Mode enabled');

      sendCustomSuccess(
        res,
        {
          session,
          timeRemaining: manager.getTimeRemaining(session),
          wasAlreadyActive: false,
          message: copy.enabled(personalityName ?? FALLBACK_NAME, getDurationLabel(duration)),
        },
        StatusCodes.CREATED
      );
    });
}

function buildDisableHandler(
  mode: MemoryMode,
  copy: MemoryModeRouteCopy
): (deps: MemoryModeDeps) => RequestHandler {
  return (deps: MemoryModeDeps): RequestHandler =>
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const redis = requireRedis(deps, res);
      if (redis === null) {
        return;
      }
      const manager = new MemoryModeSessionManager(redis, mode);
      const discordUserId = req.userId;

      const parseResult = DisableMemoryModeRequestSchema.safeParse(req.body);
      if (!parseResult.success) {
        sendError(res, ErrorResponses.validationError(parseResult.error.message));
        return;
      }

      const { personalityId } = parseResult.data;

      const wasActive = await manager.disable(discordUserId, personalityId);
      const personalityName = await getPersonalityName(deps.prisma, personalityId);

      if (!wasActive) {
        sendCustomSuccess(
          res,
          {
            disabled: false,
            message: copy.notActive(personalityName ?? FALLBACK_NAME),
          },
          StatusCodes.OK
        );
        return;
      }

      logger.info({ mode, discordUserId, personalityId }, 'Mode disabled');

      sendCustomSuccess(
        res,
        {
          disabled: true,
          message: copy.disabled(personalityName ?? FALLBACK_NAME),
        },
        StatusCodes.OK
      );
    });
}

/** Build the status/enable/disable handler factories for one mode. */
export function createMemoryModeHandlers(
  mode: MemoryMode,
  copy: MemoryModeRouteCopy
): {
  handleStatus: (deps: MemoryModeDeps) => RequestHandler;
  handleEnable: (deps: MemoryModeDeps) => RequestHandler;
  handleDisable: (deps: MemoryModeDeps) => RequestHandler;
} {
  return {
    handleStatus: buildStatusHandler(mode),
    handleEnable: buildEnableHandler(mode, copy),
    handleDisable: buildDisableHandler(mode, copy),
  };
}
