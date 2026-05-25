/**
 * PATCH /user/personality/:slug/visibility
 * Toggle visibility of an owned personality
 */

import { type Response, type RequestHandler } from 'express';
import { StatusCodes } from 'http-status-codes';
import { createLogger, SetVisibilitySchema } from '@tzurot/common-types';
import { requireUserAuth, requireProvisionedUser } from '../../../services/AuthMiddleware.js';
import { asyncHandler } from '../../../utils/asyncHandler.js';
import { sendCustomSuccess, sendError } from '../../../utils/responseHelpers.js';
import { ErrorResponses } from '../../../utils/errorResponses.js';
import { sendZodError } from '../../../utils/zodHelpers.js';
import type { ProvisionedRequest } from '../../../types.js';
import { getParam } from '../../../utils/requestParams.js';
import { resolvePersonalityForEdit } from './helpers.js';
import type { RouteDeps } from '../../routeDeps.js';

const logger = createLogger('user-personality-visibility');

/**
 * PATCH /api/user/personality/:slug/visibility — toggle visibility.
 */
export const handleSetPersonalityVisibility = (deps: RouteDeps): RequestHandler => {
  const { prisma } = deps;
  return asyncHandler(async (req: ProvisionedRequest, res: Response) => {
    const discordUserId = req.userId;
    const slug = getParam(req.params.slug);
    if (slug === undefined || slug === '') {
      return sendError(res, ErrorResponses.validationError('slug is required'));
    }

    const parseResult = SetVisibilitySchema.safeParse(req.body);
    if (!parseResult.success) {
      return sendZodError(res, parseResult.error);
    }

    const { isPublic } = parseResult.data;

    const resolved = await resolvePersonalityForEdit<{
      id: string;
      ownerId: string;
      isPublic: boolean;
    }>({
      prisma,
      req,
      slug,
      res,
      options: {
        select: { id: true, ownerId: true, isPublic: true },
        action: 'change visibility of',
      },
    });
    if (resolved === null) {
      return;
    }
    const { personality } = resolved;

    // Update visibility
    const updated = await prisma.personality.update({
      where: { id: personality.id },
      data: { isPublic },
      select: { id: true, slug: true, isPublic: true },
    });

    logger.info(
      { discordUserId, slug, oldValue: personality.isPublic, newValue: isPublic },
      'Changed personality visibility'
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
};

export function createVisibilityHandler(deps: RouteDeps): RequestHandler[] {
  return [
    requireUserAuth(),
    requireProvisionedUser(deps.prisma),
    handleSetPersonalityVisibility(deps),
  ];
}
