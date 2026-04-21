/**
 * Personality Config Overrides Routes
 *
 * Endpoints for personality-level config cascade overrides (creator-only):
 * - GET /resolve-personality/:personalityId - Resolve hardcoded → admin → personality cascade
 * - PATCH /personality/:personalityId - Update Personality.configDefaults
 *
 * These are mounted under /user/config-overrides/ alongside the user-level endpoints.
 */

import { Router, type Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import {
  UserService,
  ConfigCascadeResolver,
  type PrismaClient,
  type ConfigCascadeCacheInvalidationService,
} from '@tzurot/common-types';
import { requireUserAuth, requireProvisionedUser } from '../../services/AuthMiddleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import {
  tryInvalidateCache,
  mergeAndValidateOverrides,
} from '../../utils/configOverrideHelpers.js';
import { resolveProvisionedUserId } from '../../utils/resolveProvisionedUserId.js';
import { sendError, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import { getRequiredParam } from '../../utils/requestParams.js';
import type { AuthenticatedRequest, ProvisionedRequest } from '../../types.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createPersonalityConfigOverrideRoutes(
  prisma: PrismaClient,
  cascadeInvalidation?: ConfigCascadeCacheInvalidationService
): Router {
  const router = Router();
  const userService = new UserService(prisma);
  const cascadeResolver = new ConfigCascadeResolver(prisma, { enableCleanup: false });

  router.use(requireUserAuth());
  router.use(requireProvisionedUser(prisma));

  /**
   * GET /resolve-personality/:personalityId
   * Resolve 3-tier cascade: hardcoded → admin → personality.
   * Used by personality creator dashboards to see what their defaults resolve to.
   *
   * Intentionally no creator-check: the resolved 3-tier cascade is non-sensitive
   * (same data any user would experience). Only writes (PATCH) are creator-gated.
   */
  router.get(
    '/resolve-personality/:personalityId',
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const personalityId = getRequiredParam(req.params.personalityId, 'personalityId');

      if (!UUID_PATTERN.test(personalityId)) {
        return sendError(res, ErrorResponses.validationError('Invalid personalityId format'));
      }

      // Pass undefined for userId and channelId to skip user/channel tiers
      const resolved = await cascadeResolver.resolveOverrides(undefined, personalityId, undefined);
      sendCustomSuccess(res, resolved, StatusCodes.OK);
    })
  );

  /**
   * PATCH /personality/:personalityId
   * Update personality-level config defaults (Personality.configDefaults).
   * Auth: Must be personality creator (ownerId matches requesting user).
   */
  router.patch(
    '/personality/:personalityId',
    asyncHandler(async (req: ProvisionedRequest, res: Response) => {
      const personalityId = getRequiredParam(req.params.personalityId, 'personalityId');

      if (!UUID_PATTERN.test(personalityId)) {
        return sendError(res, ErrorResponses.validationError('Invalid personalityId format'));
      }

      const userId = await resolveProvisionedUserId(req, userService, req.userId);

      // Verify creator ownership
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
    })
  );

  return router;
}
