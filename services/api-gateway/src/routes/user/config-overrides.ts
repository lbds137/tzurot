/**
 * User Config Overrides Routes
 * CRUD for user-level and per-personality config cascade overrides
 *
 * Endpoints:
 * - GET /user/config-overrides/resolve-defaults - Resolve admin → user-default cascade
 * - GET /user/config-overrides/resolve/:personalityId - Resolve cascade overrides
 * - PATCH /user/config-overrides/:personalityId - Update per-personality overrides
 * - DELETE /user/config-overrides/:personalityId - Clear per-personality overrides
 * - GET /user/config-overrides/defaults - Get user's global defaults
 * - PATCH /user/config-overrides/defaults - Update user's global defaults
 * - DELETE /user/config-overrides/defaults - Clear user's global defaults
 */

import { Router, type Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { z } from 'zod';
import {
  createLogger,
  UserService,
  ConfigCascadeResolver,
  Prisma,
  generateUserPersonalityConfigUuid,
  DISCORD_SNOWFLAKE,
  HARDCODED_CONFIG_DEFAULTS,
  ADMIN_SETTINGS_SINGLETON_ID,
  ConfigOverridesSchema,
  type PrismaClient,
  type ConfigCascadeCacheInvalidationService,
  type ConfigOverrideSource,
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

const logger = createLogger('user-config-overrides');

/** Parse and validate a config tier's JSONB value. Returns null if absent or invalid. */
function parseConfigTier(raw: unknown): Record<string, unknown> | null {
  if (raw === null || raw === undefined || typeof raw !== 'object') {
    return null;
  }
  const result = ConfigOverridesSchema.partial().safeParse(raw);
  if (!result.success) {
    logger.warn({ errors: result.error.issues }, 'Config tier JSONB failed validation');
    return null;
  }
  return result.data;
}

/** Query schema for resolve endpoint */
const resolveQuerySchema = z.object({
  channelId: z.string().regex(DISCORD_SNOWFLAKE.PATTERN, 'Invalid channelId format').optional(),
});

// eslint-disable-next-line max-lines-per-function -- Route factory with 7 endpoints following model-override.ts pattern
export function createConfigOverrideRoutes(
  prisma: PrismaClient,
  cascadeInvalidation?: ConfigCascadeCacheInvalidationService
): Router {
  const router = Router();
  const userService = new UserService(prisma);
  const cascadeResolver = new ConfigCascadeResolver(prisma, { enableCleanup: false });

  // All routes require authentication
  router.use(requireUserAuth());
  router.use(requireProvisionedUser(prisma));

  /**
   * GET /user/config-overrides/resolve-defaults
   * Resolve admin → user-default cascade (no personality/channel context).
   * Returns resolved values with per-field source tracking and raw user overrides.
   */
  router.get(
    '/resolve-defaults',
    asyncHandler(async (req: ProvisionedRequest, res: Response) => {
      const userId = await resolveProvisionedUserId(req, userService);

      // Load admin and user tiers in parallel
      const [adminSettings, user] = await Promise.all([
        prisma.adminSettings.findUnique({
          where: { id: ADMIN_SETTINGS_SINGLETON_ID },
          select: { configDefaults: true },
        }),
        prisma.user.findUnique({
          where: { id: userId },
          select: { configDefaults: true },
        }),
      ]);

      // Parse and validate each tier
      const adminDefaults = parseConfigTier(adminSettings?.configDefaults);
      const userDefaults = parseConfigTier(user?.configDefaults);

      // Merge: hardcoded → admin → user-default
      const resolved: Record<string, unknown> = { ...HARDCODED_CONFIG_DEFAULTS };
      const sources: Record<string, ConfigOverrideSource> = {};

      for (const key of Object.keys(HARDCODED_CONFIG_DEFAULTS)) {
        sources[key] = 'hardcoded';
      }

      if (adminDefaults !== null) {
        for (const [key, value] of Object.entries(adminDefaults)) {
          if (value !== undefined) {
            resolved[key] = value;
            sources[key] = 'admin';
          }
        }
      }

      if (userDefaults !== null) {
        for (const [key, value] of Object.entries(userDefaults)) {
          if (value !== undefined) {
            resolved[key] = value;
            sources[key] = 'user-default';
          }
        }
      }

      // Note: 'sources' and 'userOverrides' are reserved metadata keys in this flat response.
      // Config field names (from ConfigOverridesSchema) must not collide with them.
      sendCustomSuccess(res, { ...resolved, sources, userOverrides: userDefaults }, StatusCodes.OK);
    })
  );

  /**
   * GET /user/config-overrides/defaults
   * Get user's global config defaults (User.configDefaults)
   */
  router.get(
    '/defaults',
    asyncHandler(async (req: ProvisionedRequest, res: Response) => {
      const userId = await resolveProvisionedUserId(req, userService);

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
   * Body: Partial<ConfigOverrides>
   */
  router.patch(
    '/defaults',
    asyncHandler(async (req: ProvisionedRequest, res: Response) => {
      const userId = await resolveProvisionedUserId(req, userService);

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { configDefaults: true },
      });

      const { merged, prismaValue } = mergeAndValidateOverrides(
        user?.configDefaults,
        req.body,
        res
      );
      if (merged === undefined) {
        return;
      }

      await prisma.user.update({
        where: { id: userId },
        data: { configDefaults: prismaValue },
      });

      await tryInvalidateCache(
        cascadeInvalidation?.invalidateUser.bind(cascadeInvalidation, req.userId),
        { discordUserId: req.userId }
      );

      sendCustomSuccess(res, { configDefaults: merged }, StatusCodes.OK);
    })
  );

  /**
   * DELETE /user/config-overrides/defaults
   * Clear user's global config defaults
   */
  router.delete(
    '/defaults',
    asyncHandler(async (req: ProvisionedRequest, res: Response) => {
      const userId = await resolveProvisionedUserId(req, userService);

      await prisma.user.update({
        where: { id: userId },
        data: { configDefaults: Prisma.JsonNull },
      });

      await tryInvalidateCache(
        cascadeInvalidation?.invalidateUser.bind(cascadeInvalidation, req.userId),
        { discordUserId: req.userId }
      );

      sendCustomSuccess(res, { success: true }, StatusCodes.OK);
    })
  );

  /**
   * GET /user/config-overrides/resolve/:personalityId?channelId=xxx
   * Resolve cascade overrides for a user+personality+channel combination.
   * Returns fully resolved values with per-field source tracking.
   */
  router.get(
    '/resolve/:personalityId',
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const personalityId = getRequiredParam(req.params.personalityId, 'personalityId');
      const queryResult = resolveQuerySchema.safeParse(req.query);
      if (!queryResult.success) {
        sendError(res, ErrorResponses.validationError('Invalid channelId format'));
        return;
      }
      const resolved = await cascadeResolver.resolveOverrides(
        req.userId,
        personalityId,
        queryResult.data.channelId
      );
      sendCustomSuccess(res, resolved, StatusCodes.OK);
    })
  );

  /**
   * PATCH /user/config-overrides/:personalityId
   * Update per-personality config overrides (merge semantics)
   * Body: Partial<ConfigOverrides>
   */
  router.patch(
    '/:personalityId',
    asyncHandler(async (req: ProvisionedRequest, res: Response) => {
      const personalityId = getRequiredParam(req.params.personalityId, 'personalityId');

      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(personalityId)) {
        return sendError(res, ErrorResponses.validationError('Invalid personalityId format'));
      }

      const userId = await resolveProvisionedUserId(req, userService);

      // Upsert UserPersonalityConfig with deterministic UUID
      const upcId = generateUserPersonalityConfigUuid(userId, personalityId);

      const existing = await prisma.userPersonalityConfig.findUnique({
        where: { id: upcId },
        select: { configOverrides: true },
      });

      const { merged, prismaValue } = mergeAndValidateOverrides(
        existing?.configOverrides,
        req.body,
        res
      );
      if (merged === undefined) {
        return;
      }

      await prisma.userPersonalityConfig.upsert({
        where: { id: upcId },
        create: {
          id: upcId,
          userId,
          personalityId,
          configOverrides: prismaValue,
        },
        update: {
          configOverrides: prismaValue,
        },
      });

      await tryInvalidateCache(
        cascadeInvalidation?.invalidateUser.bind(cascadeInvalidation, req.userId),
        { discordUserId: req.userId }
      );

      sendCustomSuccess(res, { configOverrides: merged }, StatusCodes.OK);
    })
  );

  /**
   * DELETE /user/config-overrides/:personalityId
   * Clear per-personality config overrides
   */
  router.delete(
    '/:personalityId',
    asyncHandler(async (req: ProvisionedRequest, res: Response) => {
      const personalityId = getRequiredParam(req.params.personalityId, 'personalityId');

      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(personalityId)) {
        return sendError(res, ErrorResponses.validationError('Invalid personalityId format'));
      }

      const userId = await resolveProvisionedUserId(req, userService);

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

      await tryInvalidateCache(
        cascadeInvalidation?.invalidateUser.bind(cascadeInvalidation, req.userId),
        { discordUserId: req.userId }
      );

      sendCustomSuccess(res, { success: true }, StatusCodes.OK);
    })
  );

  return router;
}
