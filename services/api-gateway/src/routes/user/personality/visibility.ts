/**
 * PATCH /user/personality/:slug/visibility
 * Toggle visibility of an owned personality
 */

import { type Response, type RequestHandler } from 'express';
import { StatusCodes } from 'http-status-codes';
import { createLogger, type PrismaClient, SetVisibilitySchema } from '@tzurot/common-types';
import { requireUserAuth } from '../../../services/AuthMiddleware.js';
import { asyncHandler } from '../../../utils/asyncHandler.js';
import { sendCustomSuccess, sendError } from '../../../utils/responseHelpers.js';
import { ErrorResponses } from '../../../utils/errorResponses.js';
import { sendZodError } from '../../../utils/zodHelpers.js';
import type { AuthenticatedRequest } from '../../../types.js';
import { getParam } from '../../../utils/requestParams.js';
import { findInternalUser, canUserEditPersonality } from './helpers.js';

const logger = createLogger('user-personality-visibility');

/**
 * Create handler for PATCH /user/personality/:slug/visibility
 * Toggle visibility of an owned personality
 */
export function createVisibilityHandler(prisma: PrismaClient): RequestHandler[] {
  const handler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const discordUserId = req.userId;
    const slug = getParam(req.params.slug);

    const parseResult = SetVisibilitySchema.safeParse(req.body);
    if (!parseResult.success) {
      return sendZodError(res, parseResult.error);
    }

    const { isPublic } = parseResult.data;

    const user = await findInternalUser(prisma, discordUserId);
    if (user === null) {
      return sendError(res, ErrorResponses.unauthorized('User not found'));
    }

    const personality = await prisma.personality.findUnique({
      where: { slug },
      select: { id: true, ownerId: true, isPublic: true },
    });

    if (personality === null) {
      return sendError(res, ErrorResponses.notFound('Personality not found'));
    }

    const canEdit = await canUserEditPersonality(prisma, user.id, personality.id, discordUserId);
    if (!canEdit) {
      return sendError(
        res,
        ErrorResponses.unauthorized('You do not have permission to change visibility')
      );
    }

    // Update visibility
    const updated = await prisma.personality.update({
      where: { id: personality.id },
      data: { isPublic },
      select: { id: true, slug: true, isPublic: true },
    });

    logger.info(
      { discordUserId, slug, oldValue: personality.isPublic, newValue: isPublic },
      '[User] Changed personality visibility'
    );

    sendCustomSuccess(
      res,
      {
        success: true,
        personality: {
          id: updated.id,
          slug: updated.slug,
          isPublic: updated.isPublic,
        },
      },
      StatusCodes.OK
    );
  });

  return [requireUserAuth(), handler];
}
