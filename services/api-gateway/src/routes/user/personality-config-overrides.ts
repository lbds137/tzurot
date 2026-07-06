/**
 * Personality Config Overrides Routes
 *
 * Endpoints for personality-level config cascade overrides (creator-only):
 * - GET /resolve-personality/:personalityId - Resolve hardcoded → admin → personality cascade
 * - PATCH /personality/:personalityId - Update Personality.configDefaults
 *
 * These are mounted under /user/config-overrides/ alongside the user-level endpoints.
 */

import { Router, type Response, type RequestHandler } from 'express';
import { StatusCodes } from 'http-status-codes';
import { requireUserAuth, requireProvisionedUser } from '../../services/AuthMiddleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import {
  tryInvalidateCache,
  mergeAndValidateOverrides,
  getValidatedPersonalityId,
} from '../../utils/configOverrideHelpers.js';
import { resolveProvisionedUserId } from '../../utils/resolveProvisionedUserId.js';
import { sendError, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import type { AuthenticatedRequest, ProvisionedRequest } from '../../types.js';
import { requireDep, type RouteDeps } from '../routeDeps.js';

/**
 * GET /api/user/config-overrides/resolve-personality/:personalityId — resolve 3-tier cascade.
 *
 * Intentionally no creator-check: the resolved 3-tier cascade is non-sensitive
 * (same data any user would experience). Only writes (PATCH) are creator-gated.
 */
export const handleResolvePersonalityCascade = (deps: RouteDeps): RequestHandler => {
  const cascadeResolver = requireDep(deps.cascadeResolver, 'cascadeResolver');
  return asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const personalityId = getValidatedPersonalityId(req, res);
    if (personalityId === null) {
      return;
    }

    // Pass undefined for userId and channelId to skip user/channel tiers
    const resolved = await cascadeResolver.resolveOverrides(undefined, personalityId, undefined);
    sendCustomSuccess(res, resolved, StatusCodes.OK);
  });
};

/**
 * PATCH /api/user/config-overrides/personality/:personalityId — update personality
 * config defaults. Auth: requesting user must be the personality creator.
 */
export const handleUpdatePersonalityConfigDefaults = (deps: RouteDeps): RequestHandler => {
  const { prisma, cascadeInvalidation } = deps;
  return asyncHandler(async (req: ProvisionedRequest, res: Response) => {
    const personalityId = getValidatedPersonalityId(req, res);
    if (personalityId === null) {
      return;
    }

    const userId = resolveProvisionedUserId(req);

    const personality = await prisma.personality.findUnique({
      where: { id: personalityId },
      select: { ownerId: true, configDefaults: true },
    });
    if (personality === null) {
      return sendError(res, ErrorResponses.notFound('Personality'));
    }
    if (personality.ownerId !== userId) {
      return sendError(
        res,
        ErrorResponses.forbidden('Only the personality creator can edit defaults')
      );
    }

    const { merged, prismaValue } = mergeAndValidateOverrides(
      personality.configDefaults,
      req.body,
      res
    );
    if (merged === undefined) {
      return;
    }

    await prisma.personality.update({
      where: { id: personalityId },
      data: { configDefaults: prismaValue },
    });

    await tryInvalidateCache(
      cascadeInvalidation?.invalidatePersonality.bind(cascadeInvalidation, personalityId),
      { personalityId }
    );

    sendCustomSuccess(res, { configDefaults: merged }, StatusCodes.OK);
  });
};

export function createPersonalityConfigOverrideRoutes(deps: RouteDeps): Router {
  const router = Router();
  router.use(requireUserAuth());
  router.use(requireProvisionedUser(deps.prisma));

  router.get('/resolve-personality/:personalityId', handleResolvePersonalityCascade(deps));
  router.patch('/personality/:personalityId', handleUpdatePersonalityConfigDefaults(deps));

  return router;
}
