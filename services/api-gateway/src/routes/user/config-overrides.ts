/**
 * User Config Overrides Routes
 * CRUD for user-level and per-personality config cascade overrides
 *
 * Endpoints:
 * - GET /user/config-overrides/resolve/:personalityId - Resolve cascade overrides
 * - PATCH /user/config-overrides/:personalityId - Update per-personality overrides
 * - DELETE /user/config-overrides/:personalityId - Clear per-personality overrides
 * - GET /user/config-overrides/defaults - Get user's global defaults
 * - PATCH /user/config-overrides/defaults - Update user's global defaults
 * - DELETE /user/config-overrides/defaults - Clear user's global defaults
 */

import { Router, type Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import {
  createLogger,
  UserService,
  ConfigCascadeResolver,
  ConfigOverridesSchema,
  Prisma,
  generateUserPersonalityConfigUuid,
  type PrismaClient,
  type ConfigCascadeCacheInvalidationService,
} from '@tzurot/common-types';
import { requireUserAuth } from '../../services/AuthMiddleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendError, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import { getRequiredParam } from '../../utils/requestParams.js';
import type { AuthenticatedRequest } from '../../types.js';

const logger = createLogger('user-config-overrides');

const BOT_USER_ERROR = 'Cannot create user for bot';
const CASCADE_INVALIDATION_WARN = 'Failed to publish cascade invalidation';

/**
 * Merge partial config overrides into existing JSONB.
 * Validates input, merges with existing, strips null/undefined fields.
 */
function mergeConfigOverrides(
  existing: unknown,
  input: Record<string, unknown>
): Record<string, unknown> | null | 'invalid' {
  const parseResult = ConfigOverridesSchema.partial().safeParse(input);
  if (!parseResult.success) {
    return 'invalid';
  }

  const existingObj =
    existing !== null && typeof existing === 'object' && !Array.isArray(existing)
      ? (existing as Record<string, unknown>)
      : {};
  const merged: Record<string, unknown> = { ...existingObj, ...parseResult.data };

  // Remove undefined/null fields to keep JSONB clean
  for (const key of Object.keys(merged)) {
    if (merged[key] === undefined || merged[key] === null) {
      delete merged[key];
    }
  }

  return Object.keys(merged).length > 0 ? merged : null;
}

// eslint-disable-next-line max-lines-per-function -- Route factory with 6 endpoints following model-override.ts pattern
export function createConfigOverrideRoutes(
  prisma: PrismaClient,
  cascadeInvalidation?: ConfigCascadeCacheInvalidationService
): Router {
  const router = Router();
  const userService = new UserService(prisma);
  const cascadeResolver = new ConfigCascadeResolver(prisma, { enableCleanup: false });

  // All routes require authentication
  router.use(requireUserAuth);

  /**
   * GET /user/config-overrides/defaults
   * Get user's global config defaults (User.configDefaults)
   */
  router.get(
    '/defaults',
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const userId = await userService.getOrCreateUser(req.userId, req.userId);
      if (userId === null) {
        return sendError(res, ErrorResponses.validationError(BOT_USER_ERROR));
      }

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { configDefaults: true },
      });

      sendCustomSuccess(
        res,
        { configDefaults: (user?.configDefaults as Record<string, unknown> | null) ?? null },
        StatusCodes.OK
      );
    })
  );

  /**
   * PATCH /user/config-overrides/defaults
   * Update user's global config defaults (merge semantics)
   * Body: Partial<ConfigOverrides> | null (null to clear)
   */
  router.patch(
    '/defaults',
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const userId = await userService.getOrCreateUser(req.userId, req.userId);
      if (userId === null) {
        return sendError(res, ErrorResponses.validationError(BOT_USER_ERROR));
      }

      const input = req.body as Record<string, unknown> | null;

      if (input === null) {
        await prisma.user.update({
          where: { id: userId },
          data: { configDefaults: Prisma.JsonNull },
        });

        if (cascadeInvalidation !== undefined) {
          try {
            await cascadeInvalidation.invalidateUser(req.userId);
          } catch (error) {
            logger.warn({ err: error }, CASCADE_INVALIDATION_WARN);
          }
        }

        sendCustomSuccess(res, { configDefaults: null }, StatusCodes.OK);
        return;
      }

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { configDefaults: true },
      });

      const merged = mergeConfigOverrides(user?.configDefaults, input);
      if (merged === 'invalid') {
        sendError(res, ErrorResponses.validationError('Invalid config format'));
        return;
      }

      await prisma.user.update({
        where: { id: userId },
        data: {
          configDefaults: merged === null ? Prisma.JsonNull : (merged as Prisma.InputJsonValue),
        },
      });

      if (cascadeInvalidation !== undefined) {
        try {
          await cascadeInvalidation.invalidateUser(req.userId);
        } catch (error) {
          logger.warn({ err: error }, CASCADE_INVALIDATION_WARN);
        }
      }

      sendCustomSuccess(res, { configDefaults: merged }, StatusCodes.OK);
    })
  );

  /**
   * DELETE /user/config-overrides/defaults
   * Clear user's global config defaults
   */
  router.delete(
    '/defaults',
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const userId = await userService.getOrCreateUser(req.userId, req.userId);
      if (userId === null) {
        return sendError(res, ErrorResponses.validationError(BOT_USER_ERROR));
      }

      await prisma.user.update({
        where: { id: userId },
        data: { configDefaults: Prisma.JsonNull },
      });

      if (cascadeInvalidation !== undefined) {
        try {
          await cascadeInvalidation.invalidateUser(req.userId);
        } catch (error) {
          logger.warn({ err: error }, CASCADE_INVALIDATION_WARN);
        }
      }

      sendCustomSuccess(res, { success: true }, StatusCodes.OK);
    })
  );

  /**
   * GET /user/config-overrides/resolve/:personalityId
   * Resolve cascade overrides for a user+personality combination.
   * Returns fully resolved values with per-field source tracking.
   */
  router.get(
    '/resolve/:personalityId',
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const personalityId = getRequiredParam(req.params.personalityId, 'personalityId');
      const resolved = await cascadeResolver.resolveOverrides(req.userId, personalityId);
      sendCustomSuccess(res, resolved, StatusCodes.OK);
    })
  );

  /**
   * PATCH /user/config-overrides/:personalityId
   * Update per-personality config overrides (merge semantics)
   * Body: Partial<ConfigOverrides> | null (null to clear)
   */
  router.patch(
    '/:personalityId',
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const personalityId = getRequiredParam(req.params.personalityId, 'personalityId');
      const userId = await userService.getOrCreateUser(req.userId, req.userId);
      if (userId === null) {
        return sendError(res, ErrorResponses.validationError(BOT_USER_ERROR));
      }

      const input = req.body as Record<string, unknown> | null;

      // Upsert UserPersonalityConfig with deterministic UUID
      const upcId = generateUserPersonalityConfigUuid(userId, personalityId);

      const existing = await prisma.userPersonalityConfig.findUnique({
        where: { id: upcId },
        select: { configOverrides: true },
      });

      if (input === null) {
        // Clear overrides
        if (existing !== null) {
          await prisma.userPersonalityConfig.update({
            where: { id: upcId },
            data: { configOverrides: Prisma.JsonNull },
          });
        }

        if (cascadeInvalidation !== undefined) {
          try {
            await cascadeInvalidation.invalidateUser(req.userId);
          } catch (error) {
            logger.warn({ err: error }, CASCADE_INVALIDATION_WARN);
          }
        }

        sendCustomSuccess(res, { configOverrides: null }, StatusCodes.OK);
        return;
      }

      const merged = mergeConfigOverrides(existing?.configOverrides, input);
      if (merged === 'invalid') {
        sendError(res, ErrorResponses.validationError('Invalid config format'));
        return;
      }

      await prisma.userPersonalityConfig.upsert({
        where: { id: upcId },
        create: {
          id: upcId,
          userId,
          personalityId,
          configOverrides: merged === null ? Prisma.JsonNull : (merged as Prisma.InputJsonValue),
        },
        update: {
          configOverrides: merged === null ? Prisma.JsonNull : (merged as Prisma.InputJsonValue),
        },
      });

      if (cascadeInvalidation !== undefined) {
        try {
          await cascadeInvalidation.invalidateUser(req.userId);
        } catch (error) {
          logger.warn({ err: error }, CASCADE_INVALIDATION_WARN);
        }
      }

      sendCustomSuccess(res, { configOverrides: merged }, StatusCodes.OK);
    })
  );

  /**
   * DELETE /user/config-overrides/:personalityId
   * Clear per-personality config overrides
   */
  router.delete(
    '/:personalityId',
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const personalityId = getRequiredParam(req.params.personalityId, 'personalityId');
      const userId = await userService.getOrCreateUser(req.userId, req.userId);
      if (userId === null) {
        return sendError(res, ErrorResponses.validationError(BOT_USER_ERROR));
      }

      const upcId = generateUserPersonalityConfigUuid(userId, personalityId);

      const existing = await prisma.userPersonalityConfig.findUnique({
        where: { id: upcId },
      });

      if (existing !== null) {
        await prisma.userPersonalityConfig.update({
          where: { id: upcId },
          data: { configOverrides: Prisma.JsonNull },
        });
      }

      if (cascadeInvalidation !== undefined) {
        try {
          await cascadeInvalidation.invalidateUser(req.userId);
        } catch (error) {
          logger.warn({ err: error }, CASCADE_INVALIDATION_WARN);
        }
      }

      sendCustomSuccess(res, { success: true }, StatusCodes.OK);
    })
  );

  return router;
}
