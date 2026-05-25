/**
 * User Model Override Routes
 * Set/reset LLM config overrides for personalities
 *
 * Endpoints:
 * - GET /user/model-override - List all user's model overrides
 * - PUT /user/model-override - Set override for a personality
 * - GET /user/model-override/default - Get user's global default config
 * - PUT /user/model-override/default - Set user's global default config
 * - DELETE /user/model-override/default - Clear user's global default config
 * - DELETE /user/model-override/:personalityId - Remove override (MUST be after /default routes)
 */

import { Router, type Response, type RequestHandler } from 'express';
import { StatusCodes } from 'http-status-codes';
import {
  createLogger,
  generateUserPersonalityConfigUuid,
  type PrismaClient,
  type ModelOverrideSummary,
  type UserDefaultConfig,
  SetModelOverrideSchema,
  SetDefaultConfigSchema,
} from '@tzurot/common-types';
import { requireUserAuth, requireProvisionedUser } from '../../services/AuthMiddleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { tryInvalidateCache } from '../../utils/configOverrideHelpers.js';
import { resolveProvisionedUserId } from '../../utils/resolveProvisionedUserId.js';
import { sendError, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import { sendZodError } from '../../utils/zodHelpers.js';
import { getParam } from '../../utils/requestParams.js';
import type { ProvisionedRequest } from '../../types.js';
import type { RouteDeps } from '../routeDeps.js';

const logger = createLogger('user-model-override');

/**
 * Verify that the given LLM config exists and the user can access it (global or owned).
 * Returns the config if accessible, null otherwise.
 */
async function verifyConfigAccess(
  prisma: PrismaClient,
  configId: string,
  userId: string
): Promise<{ id: string; name: string } | null> {
  return prisma.llmConfig.findFirst({
    where: {
      id: configId,
      OR: [{ isGlobal: true }, { ownerId: userId }],
    },
    select: { id: true, name: true },
  });
}

/** GET /api/user/model-override — list all user model overrides */
export const handleListModelOverrides = (deps: RouteDeps): RequestHandler => {
  const { prisma } = deps;
  return asyncHandler(async (req: ProvisionedRequest, res: Response) => {
    const discordUserId = req.userId;
    const userId = resolveProvisionedUserId(req);

    const overrides = await prisma.userPersonalityConfig.findMany({
      where: {
        userId,
        llmConfigId: { not: null },
      },
      select: {
        personalityId: true,
        personality: { select: { name: true } },
        llmConfigId: true,
        llmConfig: { select: { name: true } },
      },
      take: 100,
    });

    const result: ModelOverrideSummary[] = overrides.map(o => ({
      personalityId: o.personalityId,
      personalityName: o.personality.name,
      configId: o.llmConfigId,
      configName: o.llmConfig?.name ?? null,
    }));

    logger.info({ discordUserId, count: result.length }, 'Listed overrides');
    sendCustomSuccess(res, { overrides: result }, StatusCodes.OK);
  });
};

/** PUT /api/user/model-override — set model override for a personality */
export const handleSetModelOverride = (deps: RouteDeps): RequestHandler => {
  const { prisma } = deps;
  return asyncHandler(async (req: ProvisionedRequest, res: Response) => {
    const discordUserId = req.userId;

    const parseResult = SetModelOverrideSchema.safeParse(req.body);
    if (!parseResult.success) {
      return sendZodError(res, parseResult.error);
    }

    const { personalityId, configId } = parseResult.data;
    const userId = resolveProvisionedUserId(req);

    const personality = await prisma.personality.findFirst({
      where: { id: personalityId },
      select: { id: true, name: true },
    });

    if (personality === null) {
      return sendError(res, ErrorResponses.notFound('Personality'));
    }

    const llmConfig = await verifyConfigAccess(prisma, configId, userId);
    if (llmConfig === null) {
      return sendError(res, ErrorResponses.notFound('Config'));
    }

    const override = await prisma.userPersonalityConfig.upsert({
      where: {
        userId_personalityId: {
          userId,
          personalityId,
        },
      },
      create: {
        id: generateUserPersonalityConfigUuid(userId, personalityId),
        userId,
        personalityId,
        llmConfigId: configId,
      },
      update: {
        llmConfigId: configId,
      },
      select: {
        personalityId: true,
        personality: { select: { name: true } },
        llmConfigId: true,
        llmConfig: { select: { name: true } },
      },
    });

    const result: ModelOverrideSummary = {
      personalityId: override.personalityId,
      personalityName: override.personality.name,
      configId: override.llmConfigId,
      configName: override.llmConfig?.name ?? null,
    };

    logger.info(
      {
        discordUserId,
        personalityId,
        personalityName: personality.name,
        configId,
        configName: llmConfig.name,
      },
      'Set override'
    );

    sendCustomSuccess(res, { override: result }, StatusCodes.OK);
  });
};

/** GET /api/user/model-override/default — read user's global default LLM config */
export const handleGetDefaultModelConfig = (deps: RouteDeps): RequestHandler => {
  const { prisma } = deps;
  return asyncHandler(async (req: ProvisionedRequest, res: Response) => {
    const discordUserId = req.userId;
    const userId = resolveProvisionedUserId(req);

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        defaultLlmConfigId: true,
        defaultLlmConfig: { select: { name: true } },
      },
    });

    const result: UserDefaultConfig = {
      configId: user?.defaultLlmConfigId ?? null,
      configName: user?.defaultLlmConfig?.name ?? null,
    };

    logger.info({ discordUserId, configId: result.configId }, 'Got default config');
    sendCustomSuccess(res, { default: result }, StatusCodes.OK);
  });
};

/** PUT /api/user/model-override/default — set user's global default LLM config */
export const handleSetDefaultModelConfig = (deps: RouteDeps): RequestHandler => {
  const { prisma, llmConfigCacheInvalidation } = deps;
  return asyncHandler(async (req: ProvisionedRequest, res: Response) => {
    const discordUserId = req.userId;

    const parseResult = SetDefaultConfigSchema.safeParse(req.body);
    if (!parseResult.success) {
      return sendZodError(res, parseResult.error);
    }

    const { configId } = parseResult.data;
    const userId = resolveProvisionedUserId(req);

    const llmConfig = await verifyConfigAccess(prisma, configId, userId);
    if (llmConfig === null) {
      return sendError(res, ErrorResponses.notFound('Config'));
    }

    await prisma.user.update({
      where: { id: userId },
      data: { defaultLlmConfigId: configId },
    });

    const result: UserDefaultConfig = {
      configId: llmConfig.id,
      configName: llmConfig.name,
    };

    logger.info({ discordUserId, configId, configName: llmConfig.name }, 'Set default config');

    await tryInvalidateCache(
      llmConfigCacheInvalidation?.invalidateUserLlmConfig.bind(
        llmConfigCacheInvalidation,
        discordUserId
      ),
      { discordUserId }
    );

    sendCustomSuccess(res, { default: result }, StatusCodes.OK);
  });
};

/** DELETE /api/user/model-override/default — clear user's global default LLM config */
export const handleClearDefaultModelConfig = (deps: RouteDeps): RequestHandler => {
  const { prisma, llmConfigCacheInvalidation } = deps;
  return asyncHandler(async (req: ProvisionedRequest, res: Response) => {
    const discordUserId = req.userId;
    const userId = resolveProvisionedUserId(req);

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { defaultLlmConfigId: true },
    });

    if (user === null) {
      return sendError(res, ErrorResponses.notFound('User'));
    }

    // Look up the system free default the user will fall back to. Per-
    // personality overrides (UserPersonalityConfig.llmConfigId) and
    // personality-level defaults (PersonalityDefaultLlmConfig) are
    // unaffected; the free default is just the user-global fallback.
    const newEffectiveDefault = await prisma.llmConfig.findFirst({
      where: { isFreeDefault: true },
      select: { id: true, name: true },
    });

    if (user.defaultLlmConfigId === null) {
      logger.info(
        { discordUserId, hadDefault: false },
        'Clear called but no default was set (idempotent success)'
      );
      return sendCustomSuccess(
        res,
        { deleted: true, wasSet: false, newEffectiveDefault },
        StatusCodes.OK
      );
    }

    await prisma.user.update({
      where: { id: userId },
      data: { defaultLlmConfigId: null },
    });

    logger.info({ discordUserId }, 'Cleared default config');

    await tryInvalidateCache(
      llmConfigCacheInvalidation?.invalidateUserLlmConfig.bind(
        llmConfigCacheInvalidation,
        discordUserId
      ),
      { discordUserId }
    );

    sendCustomSuccess(res, { deleted: true, wasSet: true, newEffectiveDefault }, StatusCodes.OK);
  });
};

/** DELETE /api/user/model-override/:personalityId — remove model override for a personality */
export const handleDeleteModelOverride = (deps: RouteDeps): RequestHandler => {
  const { prisma } = deps;
  return asyncHandler(async (req: ProvisionedRequest, res: Response) => {
    const discordUserId = req.userId;
    const personalityId = getParam(req.params.personalityId);
    const userId = resolveProvisionedUserId(req);

    const override = await prisma.userPersonalityConfig.findFirst({
      where: {
        userId,
        personalityId,
      },
      select: { id: true, llmConfigId: true, personality: { select: { name: true } } },
    });

    if (override?.llmConfigId === null || override?.llmConfigId === undefined) {
      logger.info(
        { discordUserId, personalityId, hadOverride: false },
        'Reset called but no override was set (idempotent success)'
      );
      return sendCustomSuccess(res, { deleted: true, wasSet: false }, StatusCodes.OK);
    }

    await prisma.userPersonalityConfig.update({
      where: { id: override.id },
      data: { llmConfigId: null },
    });

    logger.info(
      { discordUserId, personalityId, personalityName: override.personality.name },
      'Removed override'
    );

    sendCustomSuccess(res, { deleted: true }, StatusCodes.OK);
  });
};

export function createModelOverrideRoutes(deps: RouteDeps): Router {
  const router = Router();
  const requireProvisioned = requireProvisionedUser(deps.prisma);

  router.get('/', requireUserAuth(), requireProvisioned, handleListModelOverrides(deps));
  router.put('/', requireUserAuth(), requireProvisioned, handleSetModelOverride(deps));
  // /default routes MUST come before /:personalityId to avoid the parameter shadowing them
  router.get('/default', requireUserAuth(), requireProvisioned, handleGetDefaultModelConfig(deps));
  router.put('/default', requireUserAuth(), requireProvisioned, handleSetDefaultModelConfig(deps));
  router.delete(
    '/default',
    requireUserAuth(),
    requireProvisioned,
    handleClearDefaultModelConfig(deps)
  );
  router.delete(
    '/:personalityId',
    requireUserAuth(),
    requireProvisioned,
    handleDeleteModelOverride(deps)
  );

  return router;
}
