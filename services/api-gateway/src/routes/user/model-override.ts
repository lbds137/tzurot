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
  toConfigKind,
  type ConfigKind,
  type PrismaClient,
  type ModelOverrideSummary,
  type UserDefaultConfig,
  SetModelOverrideSchema,
  SetDefaultConfigSchema,
} from '@tzurot/common-types';
import { requireUserAuth, requireProvisionedUser } from '../../services/AuthMiddleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import {
  parseConfigKindQuery,
  parseConfigKindQueryAllowAll,
} from '../../utils/configRouteHelpers.js';
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
 * Returns the config (incl. its `kind`) if accessible, null otherwise. The set
 * handlers branch on `kind` — a config's kind is intrinsic to its id, so the
 * write targets the matching FK column (text vs vision).
 */
async function verifyConfigAccess(
  prisma: PrismaClient,
  configId: string,
  userId: string
): Promise<{ id: string; name: string; kind: ConfigKind } | null> {
  const row = await prisma.llmConfig.findFirst({
    where: {
      id: configId,
      OR: [{ isGlobal: true }, { ownerId: userId }],
    },
    select: { id: true, name: true, kind: true },
  });
  // Narrow the raw DB string to ConfigKind at the boundary (toConfigKind floors
  // an unexpected value to text + logs), so callers get an exhaustive-checkable kind.
  return row === null ? null : { ...row, kind: toConfigKind(row.kind) };
}

/** GET /api/user/model-override — list all user model overrides */
export const handleListModelOverrides = (deps: RouteDeps): RequestHandler => {
  const { prisma } = deps;
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
        llmConfig: { select: { name: true } },
        visionConfigId: true,
        visionConfig: { select: { name: true } },
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
        });
      }
      if (emitVision && o.visionConfigId !== null) {
        result.push({
          personalityId: o.personalityId,
          personalityName: o.personality.name,
          configId: o.visionConfigId,
          configName: o.visionConfig?.name ?? null,
          kind: 'vision',
        });
      }
    }

    logger.info({ discordUserId, count: result.length, kind }, 'Listed overrides');
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

    // The config's kind decides which FK column the override writes — a vision
    // config sets `visionConfigId`, a text config `llmConfigId`. Both can coexist
    // on the same (user, personality) row.
    const isVision = llmConfig.kind === 'vision';
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
        llmConfig: { select: { name: true } },
        visionConfigId: true,
        visionConfig: { select: { name: true } },
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

    // A vision config sets the user's vision default (`defaultVisionConfigId`);
    // a text config the text default. The two defaults coexist independently.
    const isVision = llmConfig.kind === 'vision';
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

    const kind = parseConfigKindQuery(res, req.query);
    if (kind === null) {
      return;
    }
    const isVision = kind === 'vision';

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { defaultLlmConfigId: true, defaultVisionConfigId: true },
    });

    if (user === null) {
      return sendError(res, ErrorResponses.notFound('User'));
    }
    const currentDefault = isVision ? user.defaultVisionConfigId : user.defaultLlmConfigId;

    // Look up the system free default of the SAME kind the user will fall back
    // to. Per-personality overrides and personality-level defaults are
    // unaffected; the free default is just the user-global fallback.
    const newEffectiveDefault = await prisma.llmConfig.findFirst({
      where: { isFreeDefault: true, kind },
      select: { id: true, name: true },
    });

    if (currentDefault === null) {
      logger.info(
        { discordUserId, kind, hadDefault: false },
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
      data: isVision ? { defaultVisionConfigId: null } : { defaultLlmConfigId: null },
    });

    logger.info({ discordUserId, kind }, 'Cleared default config');

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

    const kind = parseConfigKindQuery(res, req.query);
    if (kind === null) {
      return;
    }
    const isVision = kind === 'vision';

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
    const currentOverride = isVision ? override?.visionConfigId : override?.llmConfigId;

    if (override === null || currentOverride === null) {
      logger.info(
        { discordUserId, personalityId, kind, hadOverride: false },
        'Reset called but no override was set (idempotent success)'
      );
      return sendCustomSuccess(res, { deleted: true, wasSet: false }, StatusCodes.OK);
    }

    await prisma.userPersonalityConfig.update({
      where: { id: override.id },
      data: isVision ? { visionConfigId: null } : { llmConfigId: null },
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
