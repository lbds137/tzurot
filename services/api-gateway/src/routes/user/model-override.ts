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
import { ADMIN_SETTINGS_SINGLETON_ID } from '@tzurot/common-types/schemas/api/adminSettings';
import {
  type ModelOverrideSummary,
  type UserDefaultConfig,
  SetModelOverrideSchema,
  SetDefaultConfigSchema,
} from '@tzurot/common-types/schemas/api/model-override';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import { generateUserPersonalityConfigUuid } from '@tzurot/common-types/utils/deterministicUuid';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { requireUserAuth, requireProvisionedUser } from '../../services/AuthMiddleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import {
  parseConfigKindQuery,
  parseConfigKindQueryAllowAll,
} from '../../utils/configRouteHelpers.js';
import { ensureVisionCapableModel } from '../../utils/llmConfigValidation.js';
import { ModelCapabilityService } from '../../services/ModelCapabilityService.js';
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
 * Returns the config (incl. its `model`) if accessible, null otherwise. The slot a
 * config occupies (chat vs vision) is the caller's request, NOT a property of the
 * config — so the set handlers pick the FK column from `?kind=`. `model` is returned
 * so the vision slot can be capability-gated (the model must support image input).
 */
async function verifyConfigAccess(
  prisma: PrismaClient,
  configId: string,
  userId: string
): Promise<{ id: string; name: string; model: string } | null> {
  return prisma.llmConfig.findFirst({
    where: {
      id: configId,
      OR: [{ isGlobal: true }, { ownerId: userId }],
    },
    select: { id: true, name: true, model: true },
  });
}

/** GET /api/user/model-override — list all user model overrides */
export const handleListModelOverrides = (deps: RouteDeps): RequestHandler => {
  const { prisma, modelCache } = deps;
  const capabilities = new ModelCapabilityService(modelCache);
  return asyncHandler(async (req: ProvisionedRequest, res: Response) => {
    const discordUserId = req.userId;
    const userId = resolveProvisionedUserId(req);

    // Browse passes `?kind=all` to list BOTH kinds in one call (one summary row
    // per non-null FK); the dashboard passes an explicit text|vision.
    const kind = parseConfigKindQueryAllowAll(res, req.query);
    if (kind === null) {
      return;
    }
    const allKinds = kind === 'all';
    const isVision = kind === 'vision';

    // Select BOTH FK pairs (fixed shape — a conditional select would yield a
    // union return type), then emit the matching kind(s) below.
    const overrides = await prisma.userPersonalityConfig.findMany({
      where: {
        userId,
        ...(allKinds
          ? { OR: [{ llmConfigId: { not: null } }, { visionConfigId: { not: null } }] }
          : isVision
            ? { visionConfigId: { not: null } }
            : { llmConfigId: { not: null } }),
      },
      select: {
        personalityId: true,
        personality: { select: { name: true } },
        llmConfigId: true,
        // `model` feeds the capability-driven supportsVision badge (below).
        llmConfig: { select: { name: true, model: true } },
        visionConfigId: true,
        visionConfig: { select: { name: true, model: true } },
      },
      // Bounds personality CONFIG rows, not output rows: for `kind=all` a
      // personality with both FKs expands to two summaries below, so the
      // response can be up to 2× this (≤200). Fine for the browse page size.
      take: 100,
    });

    // A character can have BOTH a text and a vision override; for `all`, emit a
    // row per non-null FK (kind-tagged) so browse can badge + clear each.
    const emitText = allKinds || !isVision; // kind === 'text' or kind === 'all'
    const emitVision = allKinds || isVision; // kind === 'vision' or kind === 'all'
    const result: ModelOverrideSummary[] = [];
    for (const o of overrides) {
      if (emitText && o.llmConfigId !== null) {
        result.push({
          personalityId: o.personalityId,
          personalityName: o.personality.name,
          configId: o.llmConfigId,
          configName: o.llmConfig?.name ?? null,
          kind: 'text',
          supportsVision: await capabilities.supportsVision(o.llmConfig?.model ?? ''),
        });
      }
      if (emitVision && o.visionConfigId !== null) {
        result.push({
          personalityId: o.personalityId,
          personalityName: o.personality.name,
          configId: o.visionConfigId,
          configName: o.visionConfig?.name ?? null,
          kind: 'vision',
          supportsVision: await capabilities.supportsVision(o.visionConfig?.model ?? ''),
        });
      }
    }

    logger.info({ discordUserId, count: result.length, kind }, 'Listed overrides');
    sendCustomSuccess(res, { overrides: result }, StatusCodes.OK);
  });
};

/** PUT /api/user/model-override — set model override for a personality */
export const handleSetModelOverride = (deps: RouteDeps): RequestHandler => {
  const { prisma, modelCache } = deps;
  const capabilities = new ModelCapabilityService(modelCache);
  return asyncHandler(async (req: ProvisionedRequest, res: Response) => {
    const discordUserId = req.userId;

    // The slot (chat vs vision) is the request's choice, not a config property;
    // `?kind=` defaults to text. The vision slot is capability-gated below.
    const kind = parseConfigKindQuery(res, req.query);
    if (kind === null) {
      return;
    }

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

    // The requested slot decides which FK column the override writes — vision sets
    // `visionConfigId`, text `llmConfigId`. Both can coexist on the same (user,
    // personality) row. The vision slot is capability-gated: its model must be
    // confirmed vision-capable (unknown/unresolvable capability → 400, fail
    // closed). With no model cache wired (local dev) an OpenRouter-only model
    // can't be resolved and 400s here; prod always has the cache.
    const isVision = kind === 'vision';
    if (isVision && !(await ensureVisionCapableModel(res, modelCache, llmConfig.model))) {
      return;
    }
    const fkData = isVision ? { visionConfigId: configId } : { llmConfigId: configId };

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
        ...fkData,
      },
      update: fkData,
      select: {
        personalityId: true,
        personality: { select: { name: true } },
        llmConfigId: true,
        // `model` feeds the capability-driven supportsVision badge (below).
        llmConfig: { select: { name: true, model: true } },
        visionConfigId: true,
        visionConfig: { select: { name: true, model: true } },
      },
    });

    const result: ModelOverrideSummary = {
      personalityId: override.personalityId,
      personalityName: override.personality.name,
      configId: isVision ? override.visionConfigId : override.llmConfigId,
      configName: isVision
        ? (override.visionConfig?.name ?? null)
        : (override.llmConfig?.name ?? null),
      kind: isVision ? 'vision' : 'text',
      // Re-resolves the vision slot's capability that ensureVisionCapableModel
      // already checked on the write-gate — harmless while resolution is a warm
      // in-memory cache hit; revisit if it ever grows a network round-trip.
      supportsVision: await capabilities.supportsVision(
        (isVision ? override.visionConfig?.model : override.llmConfig?.model) ?? ''
      ),
    };

    logger.info(
      {
        discordUserId,
        personalityId,
        personalityName: personality.name,
        configId,
        configName: llmConfig.name,
        kind: isVision ? 'vision' : 'text',
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

    const kind = parseConfigKindQuery(res, req.query);
    if (kind === null) {
      return;
    }
    const isVision = kind === 'vision';

    // Select both FK pairs (fixed shape — a conditional select would yield a
    // union return type), then pick the requested kind.
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        defaultLlmConfigId: true,
        defaultLlmConfig: { select: { name: true } },
        defaultVisionConfigId: true,
        defaultVisionConfig: { select: { name: true } },
      },
    });

    const result: UserDefaultConfig = isVision
      ? {
          configId: user?.defaultVisionConfigId ?? null,
          configName: user?.defaultVisionConfig?.name ?? null,
        }
      : {
          configId: user?.defaultLlmConfigId ?? null,
          configName: user?.defaultLlmConfig?.name ?? null,
        };

    logger.info({ discordUserId, configId: result.configId, kind }, 'Got default config');
    sendCustomSuccess(res, { default: result }, StatusCodes.OK);
  });
};

/** PUT /api/user/model-override/default — set user's global default LLM config */
export const handleSetDefaultModelConfig = (deps: RouteDeps): RequestHandler => {
  const { prisma, modelCache, llmConfigCacheInvalidation } = deps;
  return asyncHandler(async (req: ProvisionedRequest, res: Response) => {
    const discordUserId = req.userId;

    // The slot (chat vs vision) is the request's choice, not a config property;
    // `?kind=` defaults to text. The vision slot is capability-gated below.
    const kind = parseConfigKindQuery(res, req.query);
    if (kind === null) {
      return;
    }

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

    // The requested slot decides which default the write targets — vision sets
    // `defaultVisionConfigId`, text `defaultLlmConfigId`; they coexist
    // independently. The vision slot is capability-gated: its model must be
    // confirmed vision-capable (unknown/unresolvable capability → 400, fail
    // closed). With no model cache wired (local dev) an OpenRouter-only model
    // can't be resolved and 400s here; prod always has the cache.
    const isVision = kind === 'vision';
    if (isVision && !(await ensureVisionCapableModel(res, modelCache, llmConfig.model))) {
      return;
    }
    await prisma.user.update({
      where: { id: userId },
      data: isVision ? { defaultVisionConfigId: configId } : { defaultLlmConfigId: configId },
    });

    const result: UserDefaultConfig = {
      configId: llmConfig.id,
      configName: llmConfig.name,
    };

    logger.info(
      { discordUserId, configId, configName: llmConfig.name, kind: isVision ? 'vision' : 'text' },
      'Set default config'
    );

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

    // `all` (the bot-client default when no slot is chosen) clears BOTH slots;
    // an explicit text|vision clears just that one.
    const kind = parseConfigKindQueryAllowAll(res, req.query);
    if (kind === null) {
      return;
    }
    const clearText = kind === 'text' || kind === 'all';
    const clearVision = kind === 'vision' || kind === 'all';

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { defaultLlmConfigId: true, defaultVisionConfigId: true },
    });

    if (user === null) {
      return sendError(res, ErrorResponses.notFound('User'));
    }
    const hadText = clearText && user.defaultLlmConfigId !== null;
    const hadVision = clearVision && user.defaultVisionConfigId !== null;
    const wasSet = hadText || hadVision;

    // Look up the system free default(s) the user will fall back to — ONE PER
    // CLEARED SLOT, so an `all` clear names both the chat AND vision fallback
    // (clearing both slots but reporting only chat under-informs the user).
    // Read the AdminSettings free-default POINTERS, not the `isFreeDefault` boolean
    // — setAsFreeDefault writes only the pointers, so the boolean is stale (would
    // show a wrong/missing fallback name after the global free default is changed).
    // Per-personality overrides and personality-level defaults are unaffected.
    const settings = await prisma.adminSettings.findUnique({
      where: { id: ADMIN_SETTINGS_SINGLETON_ID },
      select: { freeDefaultLlmConfigId: true, freeDefaultVisionConfigId: true },
    });
    const resolveFreeDefault = async (
      pointerId: string | null
    ): Promise<{ id: string; name: string } | null> => {
      if (pointerId === null) {
        return null;
      }
      return prisma.llmConfig.findUnique({
        where: { id: pointerId },
        select: { id: true, name: true },
      });
    };
    const newEffectiveDefaults = {
      ...(clearText
        ? { text: await resolveFreeDefault(settings?.freeDefaultLlmConfigId ?? null) }
        : {}),
      ...(clearVision
        ? { vision: await resolveFreeDefault(settings?.freeDefaultVisionConfigId ?? null) }
        : {}),
    };

    if (!wasSet) {
      logger.info(
        { discordUserId, kind, hadDefault: false },
        'Clear called but no default was set (idempotent success)'
      );
      return sendCustomSuccess(
        res,
        { deleted: true, wasSet: false, newEffectiveDefaults },
        StatusCodes.OK
      );
    }

    await prisma.user.update({
      where: { id: userId },
      data: {
        ...(clearText ? { defaultLlmConfigId: null } : {}),
        ...(clearVision ? { defaultVisionConfigId: null } : {}),
      },
    });

    logger.info({ discordUserId, kind }, 'Cleared default config');

    await tryInvalidateCache(
      llmConfigCacheInvalidation?.invalidateUserLlmConfig.bind(
        llmConfigCacheInvalidation,
        discordUserId
      ),
      { discordUserId }
    );

    sendCustomSuccess(res, { deleted: true, wasSet: true, newEffectiveDefaults }, StatusCodes.OK);
  });
};

/** DELETE /api/user/model-override/:personalityId — remove model override for a personality */
export const handleDeleteModelOverride = (deps: RouteDeps): RequestHandler => {
  const { prisma } = deps;
  return asyncHandler(async (req: ProvisionedRequest, res: Response) => {
    const discordUserId = req.userId;
    const personalityId = getParam(req.params.personalityId);
    const userId = resolveProvisionedUserId(req);

    // `all` (the bot-client default when no slot is chosen) clears BOTH slots;
    // an explicit text|vision clears just that one.
    const kind = parseConfigKindQueryAllowAll(res, req.query);
    if (kind === null) {
      return;
    }
    const clearText = kind === 'text' || kind === 'all';
    const clearVision = kind === 'vision' || kind === 'all';

    const override = await prisma.userPersonalityConfig.findFirst({
      where: {
        userId,
        personalityId,
      },
      select: {
        id: true,
        llmConfigId: true,
        visionConfigId: true,
        personality: { select: { name: true } },
      },
    });
    // `findFirst` returns the row or null (never undefined), and the selected FK
    // columns are `string | null` — so a null row OR a null FK means "not set".
    const hadText = clearText && (override?.llmConfigId ?? null) !== null;
    const hadVision = clearVision && (override?.visionConfigId ?? null) !== null;
    const wasSet = hadText || hadVision;

    if (override === null || !wasSet) {
      logger.info(
        { discordUserId, personalityId, kind, hadOverride: false },
        'Reset called but no override was set (idempotent success)'
      );
      return sendCustomSuccess(res, { deleted: true, wasSet: false }, StatusCodes.OK);
    }

    await prisma.userPersonalityConfig.update({
      where: { id: override.id },
      data: {
        ...(clearText ? { llmConfigId: null } : {}),
        ...(clearVision ? { visionConfigId: null } : {}),
      },
    });

    logger.info(
      { discordUserId, personalityId, personalityName: override.personality.name, kind },
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
