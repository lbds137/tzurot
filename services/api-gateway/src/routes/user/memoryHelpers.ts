/**
 * Shared helper functions for memory routes
 *
 * Extracted from memory.ts and memoryIncognito.ts to break circular dependency:
 * memory.ts imports handler modules (memorySingle, memorySearch, etc.) which previously
 * received getUserByDiscordId/getDefaultPersonaId as parameters. Moving these to a
 * standalone module lets handlers import them directly, eliminating the parameter passing.
 */

import type { Response } from 'express';
import {
  type PrismaClient,
  type UserService,
  Duration,
  DurationParseError,
} from '@tzurot/common-types';
import { sendError } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import { resolveProvisionedUserId } from '../../utils/resolveProvisionedUserId.js';
import type { ProvisionedRequest } from '../../types.js';

/**
 * Resolve the provisioned user's internal UUID for the current request,
 * mirroring the legacy `getUserByDiscordId` signature so existing memory
 * handlers only need to thread `req`/`userService` instead of
 * `(prisma, discordUserId)`. The `res` parameter is retained so callers
 * can keep their early-return shape; in practice the resolver will
 * either return the provisioned UUID or create a shell user, so this
 * function effectively never returns null. The null path is preserved
 * as a defensive guard for the rare case where shell creation fails
 * and propagates as a thrown error handled upstream — see
 * `resolveProvisionedUserId` for details.
 */
export async function getProvisionedUserId(
  req: ProvisionedRequest,
  userService: UserService,
  res: Response
): Promise<{ id: string } | null> {
  try {
    const id = await resolveProvisionedUserId(req, userService);
    return { id };
  } catch {
    sendError(res, ErrorResponses.notFound('User'));
    return null;
  }
}

/**
 * Get user's default persona ID.
 * Returns null if user not found or no default persona set.
 */
export async function getDefaultPersonaId(
  prisma: PrismaClient,
  userId: string
): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { defaultPersonaId: true },
  });
  return user?.defaultPersonaId ?? null;
}

/**
 * Validate and get personality by ID.
 * Sends 404 error response and returns null if personality not found.
 */
export async function getPersonalityById(
  prisma: PrismaClient,
  personalityId: string,
  res: Response
): Promise<{ id: string; name: string } | null> {
  const personality = await prisma.personality.findUnique({
    where: { id: personalityId },
    select: { id: true, name: true },
  });

  if (!personality) {
    sendError(res, ErrorResponses.notFound('Personality'));
    return null;
  }

  return personality;
}

/**
 * Parse a timeframe string (e.g. "1h", "7d") into a date filter.
 * Returns the cutoff date filter or an error message.
 */
export function parseTimeframeFilter(timeframe: string | undefined): {
  filter: { gte: Date } | null;
  error?: string;
} {
  if (timeframe === undefined || timeframe === '') {
    return { filter: null };
  }

  try {
    const duration = Duration.parse(timeframe);
    if (!duration.isEnabled) {
      return { filter: null, error: 'Timeframe cannot be disabled' };
    }
    const cutoffDate = duration.getCutoffDate();
    if (cutoffDate !== null) {
      return { filter: { gte: cutoffDate } };
    }
    // getCutoffDate() returns null only for durations that don't map to a
    // concrete time span (e.g., "0s"). Treat as "no filter" — not an error.
    return { filter: null };
  } catch (error) {
    if (error instanceof DurationParseError) {
      return {
        filter: null,
        error: 'Invalid timeframe format. Use: 1h, 24h, 7d, 30d, etc.',
      };
    }
    throw error;
  }
}
