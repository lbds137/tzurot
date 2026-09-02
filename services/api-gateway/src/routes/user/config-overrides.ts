/**
 * User Config Overrides Routes
 * CRUD for user-level and per-personality config cascade overrides
 *
 * Endpoints:
 * - GET /api/user/config-overrides/resolve-defaults - Resolve admin → user-default cascade
 * - GET /api/user/config-overrides/resolve/:personalityId - Resolve cascade overrides
 * - PATCH /api/user/config-overrides/:personalityId - Update per-personality overrides
 * - DELETE /api/user/config-overrides/:personalityId - Clear per-personality overrides
 * - GET /api/user/config-overrides/resolve-channel/:channelId - Resolve channel-scoped cascade
 * - GET /api/user/config-overrides/defaults - Get user's global defaults
 * - PATCH /api/user/config-overrides/defaults - Update user's global defaults
 * - DELETE /api/user/config-overrides/defaults - Clear user's global defaults
 */

import { type Response, type RequestHandler } from 'express';
import { StatusCodes } from 'http-status-codes';
import { z } from 'zod';
import { DISCORD_SNOWFLAKE } from '@tzurot/common-types/constants/discord';
import { ADMIN_SETTINGS_SINGLETON_ID } from '@tzurot/common-types/schemas/api/adminSettings';
import {
  HARDCODED_CONFIG_DEFAULTS,
  ConfigOverridesSchema,
  type ConfigOverrideSource,
} from '@tzurot/common-types/schemas/api/configOverrides';
import { Prisma } from '@tzurot/common-types/services/prisma';
import { generateUserPersonalityConfigUuid } from '@tzurot/common-types/utils/deterministicUuid';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { asyncHandler } from '../../utils/asyncHandler.js';
import {
  tryInvalidateCache,
  mergeAndValidateOverrides,
  getValidatedPersonalityId,
  UUID_PATTERN,
} from '../../utils/configOverrideHelpers.js';
import { resolveProvisionedUserId } from '../../utils/resolveProvisionedUserId.js';
import { sendError, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import type { AuthenticatedRequest, ProvisionedRequest } from '../../types.js';
import { type RouteDeps } from '../routeDeps.js';
import { pruneEmptyPersonalityConfig } from './pruneEmptyPersonalityConfig.js';

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

const INVALID_CHANNEL_ID_MESSAGE = 'Invalid channelId format';
const INVALID_PERSONALITY_ID_MESSAGE = 'Invalid personalityId format';

/** Query schema for resolve endpoint */
const resolveQuerySchema = z.object({
  channelId: z.string().regex(DISCORD_SNOWFLAKE.PATTERN, INVALID_CHANNEL_ID_MESSAGE).optional(),
});

/** Path params schema for the resolve-channel endpoint */
const channelParamsSchema = z.object({
  channelId: z.string().regex(DISCORD_SNOWFLAKE.PATTERN, INVALID_CHANNEL_ID_MESSAGE),
});

/** Query schema for the resolve-channel endpoint */
const resolveChannelQuerySchema = z.object({
  personalityId: z.string().regex(UUID_PATTERN, INVALID_PERSONALITY_ID_MESSAGE).optional(),
});

/** GET /api/user/config-overrides/resolve-defaults — admin → user-default cascade */
export const handleResolveUserDefaults = (deps: RouteDeps): RequestHandler => {
  const { prisma } = deps;
  return asyncHandler(async (req: ProvisionedRequest, res: Response) => {
    const userId = resolveProvisionedUserId(req);

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

    const adminDefaults = parseConfigTier(adminSettings?.configDefaults);
    const userDefaults = parseConfigTier(user?.configDefaults);

    // Merge: hardcoded → admin → user-default
    const resolved: Record<string, unknown> = { ...HARDCODED_CONFIG_DEFAULTS };
    const sources: Record<string, ConfigOverrideSource> = {};
    // Per-field parent value: what the field resolved to one tier down from
    // whichever tier ends up supplying the effective value.
    const parentValues: Record<string, unknown> = { ...HARDCODED_CONFIG_DEFAULTS };

    for (const key of Object.keys(HARDCODED_CONFIG_DEFAULTS)) {
      sources[key] = 'hardcoded';
    }

    if (adminDefaults !== null) {
      for (const [key, value] of Object.entries(adminDefaults)) {
        if (value !== undefined) {
          parentValues[key] = resolved[key];
          resolved[key] = value;
          sources[key] = 'admin';
        }
      }
    }

    if (userDefaults !== null) {
      for (const [key, value] of Object.entries(userDefaults)) {
        if (value !== undefined) {
          parentValues[key] = resolved[key];
          resolved[key] = value;
          sources[key] = 'user-default';
        }
      }
    }

    // 'sources', 'parentValues', and 'userOverrides' are reserved metadata
    // keys in this flat response. Collision with a future ConfigOverrides
    // field name is caught at compile time by the `_ReservedKeysDoNotCollide`
    // assertion in packages/common-types/src/schemas/api/configOverrides.ts.
    sendCustomSuccess(
      res,
      { ...resolved, sources, parentValues, userOverrides: userDefaults },
      StatusCodes.OK
    );
  });
};

/** GET /api/user/config-overrides/defaults — user's raw global config defaults */
export const handleGetUserDefaults = (deps: RouteDeps): RequestHandler => {
  const { prisma } = deps;
  return asyncHandler(async (req: ProvisionedRequest, res: Response) => {
    const userId = resolveProvisionedUserId(req);

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { configDefaults: true },
    });

    sendCustomSuccess(
      res,
      { configDefaults: (user?.configDefaults as Record<string, unknown> | null) ?? null },
      StatusCodes.OK
    );
  });
};

/** PATCH /api/user/config-overrides/defaults — merge update user's global defaults */
export const handleUpdateUserDefaults = (deps: RouteDeps): RequestHandler => {
  const { prisma, cascadeInvalidation } = deps;
  return asyncHandler(async (req: ProvisionedRequest, res: Response) => {
    const userId = resolveProvisionedUserId(req);

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { configDefaults: true },
    });

    const { merged, prismaValue } = mergeAndValidateOverrides(user?.configDefaults, req.body, res);
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
  });
};

/** DELETE /api/user/config-overrides/defaults — clear user's global defaults */
export const handleClearUserDefaults = (deps: RouteDeps): RequestHandler => {
  const { prisma, cascadeInvalidation } = deps;
  return asyncHandler(async (req: ProvisionedRequest, res: Response) => {
    const userId = resolveProvisionedUserId(req);

    await prisma.user.update({
      where: { id: userId },
      data: { configDefaults: Prisma.JsonNull },
    });

    await tryInvalidateCache(
      cascadeInvalidation?.invalidateUser.bind(cascadeInvalidation, req.userId),
      { discordUserId: req.userId }
    );

    sendCustomSuccess(res, { success: true }, StatusCodes.OK);
  });
};

/** GET /api/user/config-overrides/resolve/:personalityId — full cascade resolution */
export const handleResolveCascade = (deps: RouteDeps): RequestHandler => {
  const cascadeResolver = deps.cascadeResolver;
  return asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const personalityId = getValidatedPersonalityId(req, res);
    if (personalityId === null) {
      return;
    }
    const queryResult = resolveQuerySchema.safeParse(req.query);
    if (!queryResult.success) {
      sendError(res, ErrorResponses.validationError(INVALID_CHANNEL_ID_MESSAGE));
      return;
    }
    const resolved = await cascadeResolver.resolveOverrides(
      req.userId,
      personalityId,
      queryResult.data.channelId
    );
    sendCustomSuccess(res, resolved, StatusCodes.OK);
  });
};

/**
 * GET /api/user/config-overrides/resolve-channel/:channelId — channel-scoped
 * cascade resolution (hardcoded → admin → personality → channel).
 *
 * The channel settings dashboard resolves through this endpoint for every
 * viewer, never the full user-tier resolve: the resolution deliberately
 * excludes the VIEWING moderator's own user-default/user-personality tiers,
 * so two moderators looking at the same channel see identical Current/Parent
 * values regardless of their personal overrides.
 */
export const handleResolveChannelCascade = (deps: RouteDeps): RequestHandler => {
  const cascadeResolver = deps.cascadeResolver;
  return asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const paramsResult = channelParamsSchema.safeParse(req.params);
    if (!paramsResult.success) {
      sendError(res, ErrorResponses.validationError(INVALID_CHANNEL_ID_MESSAGE));
      return;
    }
    const queryResult = resolveChannelQuerySchema.safeParse(req.query);
    if (!queryResult.success) {
      sendError(res, ErrorResponses.validationError(INVALID_PERSONALITY_ID_MESSAGE));
      return;
    }
    // userId is intentionally omitted (undefined) — see JSDoc above.
    const resolved = await cascadeResolver.resolveOverrides(
      undefined,
      queryResult.data.personalityId,
      paramsResult.data.channelId
    );
    sendCustomSuccess(res, resolved, StatusCodes.OK);
  });
};

/** PATCH /api/user/config-overrides/:personalityId — merge update per-personality overrides */
export const handleUpdatePersonalityOverrides = (deps: RouteDeps): RequestHandler => {
  const { prisma, cascadeInvalidation } = deps;
  return asyncHandler(async (req: ProvisionedRequest, res: Response) => {
    const personalityId = getValidatedPersonalityId(req, res);
    if (personalityId === null) {
      return;
    }

    const userId = resolveProvisionedUserId(req);

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
    // A merge-to-empty PATCH clears the only slice this route sets (and the
    // create branch can mint a fresh all-null row) — prune so it doesn't
    // leave, or manufacture, a dead anchor.
    await pruneEmptyPersonalityConfig(prisma, upcId);

    await tryInvalidateCache(
      cascadeInvalidation?.invalidateUser.bind(cascadeInvalidation, req.userId),
      { discordUserId: req.userId }
    );

    sendCustomSuccess(res, { configOverrides: merged }, StatusCodes.OK);
  });
};

/** DELETE /api/user/config-overrides/:personalityId — clear per-personality overrides */
export const handleClearPersonalityOverrides = (deps: RouteDeps): RequestHandler => {
  const { prisma, cascadeInvalidation } = deps;
  return asyncHandler(async (req: ProvisionedRequest, res: Response) => {
    const personalityId = getValidatedPersonalityId(req, res);
    if (personalityId === null) {
      return;
    }

    const userId = resolveProvisionedUserId(req);

    const upcId = generateUserPersonalityConfigUuid(userId, personalityId);

    const existing = await prisma.userPersonalityConfig.findUnique({
      where: { id: upcId },
    });

    if (existing !== null) {
      await prisma.userPersonalityConfig.update({
        where: { id: upcId },
        data: { configOverrides: Prisma.JsonNull },
      });
      await pruneEmptyPersonalityConfig(prisma, upcId);
    }

    await tryInvalidateCache(
      cascadeInvalidation?.invalidateUser.bind(cascadeInvalidation, req.userId),
      { discordUserId: req.userId }
    );

    sendCustomSuccess(res, { success: true }, StatusCodes.OK);
  });
};
