/**
 * GET /user/personality/:slug
 * Get a single personality by slug (if visible to user)
 */

import { type Response, type RequestHandler } from 'express';
import { StatusCodes } from 'http-status-codes';
import {
  createLogger,
  type PrismaClient,
  isBotOwner,
  PERSONALITY_DETAIL_SELECT,
} from '@tzurot/common-types';
import { requireUserAuth } from '../../../services/AuthMiddleware.js';
import { asyncHandler } from '../../../utils/asyncHandler.js';
import { sendCustomSuccess, sendError } from '../../../utils/responseHelpers.js';
import { ErrorResponses } from '../../../utils/errorResponses.js';
import type { AuthenticatedRequest } from '../../../types.js';
import { getParam } from '../../../utils/requestParams.js';
import { canUserEditPersonality } from './helpers.js';
import { formatPersonalityResponse } from './formatters.js';

const logger = createLogger('user-personality-get');

// --- Helper Functions ---

async function checkUserAccess(
  prisma: PrismaClient,
  userId: string | undefined,
  personality: { id: string; isPublic: boolean; ownerId: string },
  discordUserId: string
): Promise<boolean> {
  if (isBotOwner(discordUserId)) {
    return true;
  }
  if (personality.isPublic) {
    return true;
  }
  if (userId !== undefined && personality.ownerId === userId) {
    return true;
  }

  if (userId !== undefined) {
    const ownerEntry = await prisma.personalityOwner.findUnique({
      where: { personalityId_userId: { personalityId: personality.id, userId } },
    });
    if (ownerEntry !== null) {
      return true;
    }
  }

  return false;
}

// --- Handler Factory ---

function createHandler(prisma: PrismaClient) {
  return async (req: AuthenticatedRequest, res: Response) => {
    const discordUserId = req.userId;
    const slug = getParam(req.params.slug);

    const user = await prisma.user.findFirst({
      where: { discordId: discordUserId },
      select: { id: true },
    });

    const personality = await prisma.personality.findUnique({
      where: { slug },
      select: PERSONALITY_DETAIL_SELECT,
    });

    if (personality === null) {
      return sendError(res, ErrorResponses.notFound('Personality'));
    }

    const hasAccess = await checkUserAccess(prisma, user?.id, personality, discordUserId);
    if (!hasAccess) {
      return sendError(
        res,
        ErrorResponses.unauthorized('You do not have access to this personality')
      );
    }

    const canEdit =
      user !== null &&
      (await canUserEditPersonality(prisma, user.id, personality.id, discordUserId));

    logger.info({ discordUserId, slug, canEdit }, '[Personality] Retrieved personality');

    sendCustomSuccess(
      res,
      { personality: formatPersonalityResponse(personality), canEdit },
      StatusCodes.OK
    );
  };
}

// --- Route Factory ---

export function createGetHandler(prisma: PrismaClient): RequestHandler[] {
  return [requireUserAuth(), asyncHandler(createHandler(prisma))];
}
