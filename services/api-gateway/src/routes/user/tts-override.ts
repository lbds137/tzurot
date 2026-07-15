/**
 * User TTS Override Routes
 * Set/reset TTS config overrides for personalities, plus user global default.
 *
 * Endpoints:
 * - GET    /user/tts-override              - List all user's TTS overrides
 * - PUT    /user/tts-override              - Set override for a personality
 * - GET    /user/tts-override/default      - Get user's global default TTS config
 * - PUT    /user/tts-override/default      - Set user's global default TTS config
 * - DELETE /user/tts-override/default      - Clear user's global default TTS config
 * - DELETE /user/tts-override/:personalityId - Remove override (MUST be after /default)
 *
 * Mirrors `routes/user/model-override.ts` exactly — same shape, same
 * idempotency contract — but acts on `UserPersonalityConfig.ttsConfigId`
 * and `User.defaultTtsConfigId` instead of the LLM equivalents.
 */

import { Router, type Response, type RequestHandler } from 'express';
import { StatusCodes } from 'http-status-codes';
import { ADMIN_SETTINGS_SINGLETON_ID } from '@tzurot/common-types/schemas/api/adminSettings';
import {
  type TtsOverrideSummary,
  type UserDefaultTtsConfig,
  SetTtsOverrideSchema,
  SetTtsDefaultConfigSchema,
} from '@tzurot/common-types/schemas/api/tts-override';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import { generateUserPersonalityConfigUuid } from '@tzurot/common-types/utils/deterministicUuid';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { requireUserAuth, requireProvisionedUser } from '../../services/AuthMiddleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import {
  tryInvalidateCache,
  findPersonalityOrSendNotFound,
} from '../../utils/configOverrideHelpers.js';
import { resolveProvisionedUserId } from '../../utils/resolveProvisionedUserId.js';
import { sendError, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import { sendZodError } from '../../utils/zodHelpers.js';
import { getParam } from '../../utils/requestParams.js';
import type { ProvisionedRequest } from '../../types.js';
import type { RouteDeps } from '../routeDeps.js';
import { pruneEmptyPersonalityConfig } from './pruneEmptyPersonalityConfig.js';

const logger = createLogger('user-tts-override');

/**
 * Verify that the given TTS config exists and the user can access it
 * (global or owned). Returns the config if accessible, null otherwise.
 */
async function verifyTtsConfigAccess(
  prisma: PrismaClient,
  configId: string,
  userId: string
): Promise<{ id: string; name: string } | null> {
  return prisma.ttsConfig.findFirst({
    where: {
      id: configId,
      OR: [{ isGlobal: true }, { ownerId: userId }],
    },
    select: { id: true, name: true },
  });
}

/** GET /api/user/tts-override — list all user TTS overrides */
export const handleListTtsOverrides = (deps: RouteDeps): RequestHandler => {
  const { prisma } = deps;
  return asyncHandler(async (req: ProvisionedRequest, res: Response) => {
    const discordUserId = req.userId;
    const userId = resolveProvisionedUserId(req);

    const overrides = await prisma.userPersonalityConfig.findMany({
      where: {
        userId,
        ttsConfigId: { not: null },
      },
      select: {
        personalityId: true,
        personality: { select: { name: true } },
        ttsConfigId: true,
        ttsConfig: { select: { name: true } },
      },
      take: 100,
    });

    const result: TtsOverrideSummary[] = overrides.map(o => ({
      personalityId: o.personalityId,
      personalityName: o.personality.name,
      configId: o.ttsConfigId,
      configName: o.ttsConfig?.name ?? null,
    }));

    logger.info({ discordUserId, count: result.length }, 'Listed TTS overrides');
    sendCustomSuccess(res, { overrides: result }, StatusCodes.OK);
  });
};

/** PUT /api/user/tts-override — set TTS override for a personality */
export const handleSetTtsOverride = (deps: RouteDeps): RequestHandler => {
  const { prisma, ttsConfigCacheInvalidation } = deps;
  return asyncHandler(async (req: ProvisionedRequest, res: Response) => {
    const discordUserId = req.userId;

    const parseResult = SetTtsOverrideSchema.safeParse(req.body);
    if (!parseResult.success) {
      return sendZodError(res, parseResult.error);
    }
    const { personalityId, configId } = parseResult.data;

    const userId = resolveProvisionedUserId(req);

    const personality = await findPersonalityOrSendNotFound(res, prisma, personalityId);
    if (personality === null) {
      return;
    }

    const ttsConfig = await verifyTtsConfigAccess(prisma, configId, userId);
    if (ttsConfig === null) {
      return sendError(res, ErrorResponses.notFound('TtsConfig'));
    }

    const override = await prisma.userPersonalityConfig.upsert({
      where: {
        userId_personalityId: { userId, personalityId },
      },
      create: {
        id: generateUserPersonalityConfigUuid(userId, personalityId),
        userId,
        personalityId,
        ttsConfigId: configId,
      },
      update: {
        ttsConfigId: configId,
      },
      select: {
        personalityId: true,
        personality: { select: { name: true } },
        ttsConfigId: true,
        ttsConfig: { select: { name: true } },
      },
    });

    const result: TtsOverrideSummary = {
      personalityId: override.personalityId,
      personalityName: override.personality.name,
      configId: override.ttsConfigId,
      configName: override.ttsConfig?.name ?? null,
    };

    logger.info(
      {
        discordUserId,
        personalityId,
        personalityName: personality.name,
        configId,
        configName: ttsConfig.name,
      },
      'Set TTS override'
    );

    await tryInvalidateCache(
      ttsConfigCacheInvalidation?.invalidateUserTtsConfig.bind(
        ttsConfigCacheInvalidation,
        discordUserId
      ),
      { discordUserId }
    );

    sendCustomSuccess(res, { override: result }, StatusCodes.OK);
  });
};

/** GET /api/user/tts-override/default — get user's global default TTS config */
export const handleGetTtsDefaultConfig = (deps: RouteDeps): RequestHandler => {
  const { prisma } = deps;
  return asyncHandler(async (req: ProvisionedRequest, res: Response) => {
    const discordUserId = req.userId;
    const userId = resolveProvisionedUserId(req);

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        defaultTtsConfigId: true,
        defaultTtsConfig: { select: { name: true } },
      },
    });

    const result: UserDefaultTtsConfig = {
      configId: user?.defaultTtsConfigId ?? null,
      configName: user?.defaultTtsConfig?.name ?? null,
    };

    logger.info({ discordUserId, configId: result.configId }, 'Got default TTS config');
    sendCustomSuccess(res, { default: result }, StatusCodes.OK);
  });
};

/** PUT /api/user/tts-override/default — set user's global default TTS config */
export const handleSetTtsDefaultConfig = (deps: RouteDeps): RequestHandler => {
  const { prisma, ttsConfigCacheInvalidation } = deps;
  return asyncHandler(async (req: ProvisionedRequest, res: Response) => {
    const discordUserId = req.userId;

    const parseResult = SetTtsDefaultConfigSchema.safeParse(req.body);
    if (!parseResult.success) {
      return sendZodError(res, parseResult.error);
    }
    const { configId } = parseResult.data;
    const userId = resolveProvisionedUserId(req);

    const ttsConfig = await verifyTtsConfigAccess(prisma, configId, userId);
    if (ttsConfig === null) {
      return sendError(res, ErrorResponses.notFound('TtsConfig'));
    }

    await prisma.user.update({
      where: { id: userId },
      data: { defaultTtsConfigId: configId },
    });

    const result: UserDefaultTtsConfig = {
      configId: ttsConfig.id,
      configName: ttsConfig.name,
    };

    logger.info({ discordUserId, configId, configName: ttsConfig.name }, 'Set default TTS config');

    await tryInvalidateCache(
      ttsConfigCacheInvalidation?.invalidateUserTtsConfig.bind(
        ttsConfigCacheInvalidation,
        discordUserId
      ),
      { discordUserId }
    );

    sendCustomSuccess(res, { default: result }, StatusCodes.OK);
  });
};

/** DELETE /api/user/tts-override/default — clear user's global default TTS config */
export const handleClearTtsDefaultConfig = (deps: RouteDeps): RequestHandler => {
  const { prisma, ttsConfigCacheInvalidation } = deps;
  return asyncHandler(async (req: ProvisionedRequest, res: Response) => {
    const discordUserId = req.userId;
    const userId = resolveProvisionedUserId(req);

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { defaultTtsConfigId: true },
    });
    if (user === null) {
      return sendError(res, ErrorResponses.notFound('User'));
    }

    // Look up the system free default the user will fall back to (via the
    // AdminSettings pointer — the flag columns are stale). Per-personality
    // overrides (UserPersonalityConfig.ttsConfigId) and personality-level
    // defaults (PersonalityDefaultTtsConfig) are unaffected; the free
    // default is just the user-global fallback.
    const settings = await prisma.adminSettings.findUnique({
      where: { id: ADMIN_SETTINGS_SINGLETON_ID },
      select: { freeDefaultTtsConfig: { select: { id: true, name: true } } },
    });
    const newEffectiveDefault = settings?.freeDefaultTtsConfig ?? null;

    if (user.defaultTtsConfigId === null) {
      logger.info(
        { discordUserId, hadDefault: false },
        'Clear called but no default TTS was set (idempotent success)'
      );
      return sendCustomSuccess(
        res,
        { deleted: true, wasSet: false, newEffectiveDefault },
        StatusCodes.OK
      );
    }

    await prisma.user.update({
      where: { id: userId },
      data: { defaultTtsConfigId: null },
    });

    logger.info({ discordUserId }, 'Cleared default TTS config');

    await tryInvalidateCache(
      ttsConfigCacheInvalidation?.invalidateUserTtsConfig.bind(
        ttsConfigCacheInvalidation,
        discordUserId
      ),
      { discordUserId }
    );

    sendCustomSuccess(res, { deleted: true, wasSet: true, newEffectiveDefault }, StatusCodes.OK);
  });
};

/** DELETE /api/user/tts-override/:personalityId — remove TTS override for a personality */
export const handleDeleteTtsOverride = (deps: RouteDeps): RequestHandler => {
  const { prisma, ttsConfigCacheInvalidation } = deps;
  return asyncHandler(async (req: ProvisionedRequest, res: Response) => {
    const discordUserId = req.userId;
    const personalityId = getParam(req.params.personalityId);
    const userId = resolveProvisionedUserId(req);

    const override = await prisma.userPersonalityConfig.findFirst({
      where: { userId, personalityId },
      select: { id: true, ttsConfigId: true, personality: { select: { name: true } } },
    });

    if (override?.ttsConfigId === null || override?.ttsConfigId === undefined) {
      logger.info(
        { discordUserId, personalityId, hadOverride: false },
        'Reset called but no TTS override was set (idempotent success)'
      );
      return sendCustomSuccess(res, { deleted: true, wasSet: false }, StatusCodes.OK);
    }

    await prisma.userPersonalityConfig.update({
      where: { id: override.id },
      data: { ttsConfigId: null },
    });
    await pruneEmptyPersonalityConfig(prisma, override.id);

    logger.info(
      { discordUserId, personalityId, personalityName: override.personality.name },
      'Removed TTS override'
    );

    await tryInvalidateCache(
      ttsConfigCacheInvalidation?.invalidateUserTtsConfig.bind(
        ttsConfigCacheInvalidation,
        discordUserId
      ),
      { discordUserId }
    );

    sendCustomSuccess(res, { deleted: true, wasSet: true }, StatusCodes.OK);
  });
};

export function createTtsOverrideRoutes(deps: RouteDeps): Router {
  const router = Router();
  const requireProvisioned = requireProvisionedUser(deps.prisma);

  router.get('/', requireUserAuth(), requireProvisioned, handleListTtsOverrides(deps));
  router.put('/', requireUserAuth(), requireProvisioned, handleSetTtsOverride(deps));
  // /default routes MUST come before /:personalityId to avoid the parameter shadowing them
  router.get('/default', requireUserAuth(), requireProvisioned, handleGetTtsDefaultConfig(deps));
  router.put('/default', requireUserAuth(), requireProvisioned, handleSetTtsDefaultConfig(deps));
  router.delete(
    '/default',
    requireUserAuth(),
    requireProvisioned,
    handleClearTtsDefaultConfig(deps)
  );
  router.delete(
    '/:personalityId',
    requireUserAuth(),
    requireProvisioned,
    handleDeleteTtsOverride(deps)
  );

  return router;
}
