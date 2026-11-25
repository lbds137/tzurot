/**
 * User Model Override Routes
 * Set/reset LLM config overrides for personalities
 *
 * Endpoints:
 * - GET /api/user/model-override - List all user's model overrides
 * - PUT /api/user/model-override - Set override for a personality
 * - GET /api/user/model-override/default - Get user's global default config
 * - PUT /api/user/model-override/default - Set user's global default config
 * - DELETE /api/user/model-override/default - Clear user's global default config
 * - DELETE /api/user/model-override/:personalityId - Remove override (MUST be after /default routes)
 */

import { type Response, type RequestHandler } from 'express';
import { StatusCodes } from 'http-status-codes';
import { hasActiveChatCapableKey, type ModelSlot } from '@tzurot/common-types/constants/ai';
import {
  type ModelOverrideSummary,
  type UserDefaultConfig,
  SetModelOverrideSchema,
  SetDefaultConfigSchema,
} from '@tzurot/common-types/schemas/api/model-override';
import { generateUserPersonalityConfigUuid } from '@tzurot/common-types/utils/deterministicUuid';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { userRoutes } from '@tzurot/clients';
import { withManifestInput } from '../../utils/manifestInput.js';
import {
  parseModelSlotQuery,
  parseModelSlotQueryAllowAll,
  parseModelSlotQueryAllowBoth,
} from '../../utils/configRouteHelpers.js';
import { ensureVisionCapableModel } from '../../utils/llmConfigValidation.js';
import { ModelCapabilityService } from '../../services/ModelCapabilityService.js';
import { tryInvalidateCache } from '../../utils/configOverrideHelpers.js';
import { resolveProvisionedUserId } from '../../utils/resolveProvisionedUserId.js';
import { sendError, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import { sendZodError } from '../../utils/zodHelpers.js';
import {
  OVERRIDE_SUMMARY_SELECT,
  buildOverrideSummary,
  parseClearSlots,
  resolveClearFallbackDefaults,
  verifyConfigAccess,
} from './modelOverrideShared.js';
import type { ProvisionedRequest } from '../../types.js';
import type { RouteDeps } from '../routeDeps.js';
import { requireVisiblePersonality } from './personality/helpers.js';
import { pruneEmptyPersonalityConfig } from './pruneEmptyPersonalityConfig.js';

const logger = createLogger('user-model-override');

/**
 * Maps the requested slot to the FK columns a set writes: `both` pins the text
 * AND vision columns, `vision` only the vision column, `text` only the text one.
 * The column names are parameters because the override row and the user-default
 * row name them differently.
 *
 * Exported for direct unit testing of the column mapping.
 */
export function slotFkData<K extends string>(
  slot: ModelSlot | 'both',
  configId: string,
  columns: { text: K; vision: K }
): Partial<Record<K, string>> {
  // TS widens a computed key of generic type to `{ [x: string]: string }`, which
  // does not assign to the keyed return type; the cast is confined to this helper
  // so every call site's Prisma `data` stays cast-free and column-checked.
  const data =
    slot === 'both'
      ? { [columns.text]: configId, [columns.vision]: configId }
      : { [slot === 'vision' ? columns.vision : columns.text]: configId };
  return data as Partial<Record<K, string>>;
}

/** GET /api/user/model-override — list all user model overrides */
export const handleListModelOverrides = (deps: RouteDeps): RequestHandler => {
  const { prisma, modelCache } = deps;
  const capabilities = new ModelCapabilityService(modelCache);
  return withManifestInput(
    userRoutes.listModelOverrides,
    async (req: ProvisionedRequest, res: Response, { query }) => {
      const discordUserId = req.userId;
      const userId = resolveProvisionedUserId(req);

      // Browse passes `?slot=all` to list BOTH slots in one call (one summary row
      // per non-null FK); the dashboard passes an explicit text|vision.
      const slot = parseModelSlotQueryAllowAll(res, query);
      if (slot === null) {
        return;
      }
      const allSlots = slot === 'all';
      const isVision = slot === 'vision';

      // Select BOTH FK pairs (fixed shape — a conditional select would yield a
      // union return type), then emit the matching slot(s) below.
      const overrides = await prisma.userPersonalityConfig.findMany({
        where: {
          userId,
          ...(allSlots
            ? { OR: [{ llmConfigId: { not: null } }, { visionConfigId: { not: null } }] }
            : isVision
              ? { visionConfigId: { not: null } }
              : { llmConfigId: { not: null } }),
        },
        select: OVERRIDE_SUMMARY_SELECT,
        // Bounds personality CONFIG rows, not output rows: for `slot=all` a
        // personality with both FKs expands to two summaries below, so the
        // response can be up to 2× this (≤200). Fine for the browse page size.
        take: 100,
      });

      // A character can have BOTH a text and a vision override; for `all`, emit a
      // row per non-null FK (slot-tagged) so browse can badge + clear each.
      // Enrichment runs CONCURRENTLY (Promise.all) — OpenRouterModelCache
      // coalesces in-flight fetches, so sequential awaits only added latency.
      const emitText = allSlots || !isVision; // slot === 'text' or slot === 'all'
      const emitVision = allSlots || isVision; // slot === 'vision' or slot === 'all'
      const pending: Promise<ModelOverrideSummary>[] = [];
      for (const o of overrides) {
        if (emitText && o.llmConfigId !== null) {
          pending.push(buildOverrideSummary(o, 'text', capabilities));
        }
        if (emitVision && o.visionConfigId !== null) {
          pending.push(buildOverrideSummary(o, 'vision', capabilities));
        }
      }
      const result = await Promise.all(pending);

      logger.info({ discordUserId, count: result.length, slot }, 'Listed overrides');
      sendCustomSuccess(res, { overrides: result }, StatusCodes.OK);
    }
  );
};

/** PUT /api/user/model-override — set model override for a personality */
export const handleSetModelOverride = (deps: RouteDeps): RequestHandler => {
  const { prisma, modelCache, llmConfigCacheInvalidation } = deps;
  const capabilities = new ModelCapabilityService(modelCache);
  return withManifestInput(
    userRoutes.setModelOverride,
    async (req: ProvisionedRequest, res: Response, { query }) => {
      const discordUserId = req.userId;

      // The slot (chat vs vision, or the `both` request alias pinning both slots
      // in one call) is the request's choice, not a config property; `?slot=`
      // defaults to text. The vision side is capability-gated below.
      const slot = parseModelSlotQueryAllowBoth(res, query);
      if (slot === null) {
        return;
      }

      const parseResult = SetModelOverrideSchema.safeParse(req.body);
      if (!parseResult.success) {
        return sendZodError(res, parseResult.error);
      }

      const { personalityId, configId } = parseResult.data;
      const userId = resolveProvisionedUserId(req);

      const personality = await requireVisiblePersonality(prisma, req, res, {
        id: personalityId,
      });
      if (personality === null) {
        return;
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
      // can't be resolved and 400s here; prod always has the cache. The `both`
      // alias runs the SAME gate FIRST and writes both FK columns in one upsert —
      // a text-only preset refuses the whole request, never half-applies.
      const isVision = slot === 'vision';
      const isBoth = slot === 'both';
      if (
        (isVision || isBoth) &&
        !(await ensureVisionCapableModel(res, modelCache, llmConfig.model, {
          retryWithChatHint: isBoth,
        }))
      ) {
        return;
      }
      const fkData = slotFkData(slot, configId, {
        text: 'llmConfigId',
        vision: 'visionConfigId',
      });

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
        select: OVERRIDE_SUMMARY_SELECT,
      });

      // Re-resolves the vision slot's capability that ensureVisionCapableModel
      // already checked on the write-gate — harmless while resolution is a warm
      // in-memory cache hit; revisit if it ever grows a network round-trip.
      // For `both` the summary is the text one: the config is the same on both
      // slots, so the Chat summary describes the whole pin.
      const result = await buildOverrideSummary(
        override,
        isVision ? 'vision' : 'text',
        capabilities
      );

      logger.info(
        {
          discordUserId,
          personalityId,
          personalityName: personality.name,
          configId,
          configName: llmConfig.name,
          slot,
        },
        'Set override'
      );

      await tryInvalidateCache(
        llmConfigCacheInvalidation?.invalidateUserLlmConfig.bind(
          llmConfigCacheInvalidation,
          discordUserId
        ),
        { discordUserId }
      );

      sendCustomSuccess(res, { override: result }, StatusCodes.OK);
    }
  );
};

/** GET /api/user/model-override/default — read user's global default LLM config */
export const handleGetDefaultModelConfig = (deps: RouteDeps): RequestHandler => {
  const { prisma } = deps;
  return withManifestInput(
    userRoutes.getDefaultModelConfig,
    async (req: ProvisionedRequest, res: Response, { query }) => {
      const discordUserId = req.userId;
      const userId = resolveProvisionedUserId(req);

      const slot = parseModelSlotQuery(res, query);
      if (slot === null) {
        return;
      }
      const isVision = slot === 'vision';

      // Select both FK pairs (fixed shape — a conditional select would yield a
      // union return type), then pick the requested slot.
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

      logger.info({ discordUserId, configId: result.configId, slot }, 'Got default config');
      sendCustomSuccess(res, { default: result }, StatusCodes.OK);
    }
  );
};

/** PUT /api/user/model-override/default — set user's global default LLM config */
export const handleSetDefaultModelConfig = (deps: RouteDeps): RequestHandler => {
  const { prisma, modelCache, llmConfigCacheInvalidation } = deps;
  return withManifestInput(
    userRoutes.setDefaultModelConfig,
    async (req: ProvisionedRequest, res: Response, { query }) => {
      const discordUserId = req.userId;

      // The slot (chat vs vision, or the `both` request alias writing both
      // defaults in one call) is the request's choice, not a config property;
      // `?slot=` defaults to text. The vision side is capability-gated below.
      const slot = parseModelSlotQueryAllowBoth(res, query);
      if (slot === null) {
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
      // can't be resolved and 400s here; prod always has the cache. The `both`
      // alias runs the SAME gate FIRST and writes both defaults in one update —
      // a text-only preset refuses the whole request, never half-applies.
      const isVision = slot === 'vision';
      const isBoth = slot === 'both';
      if (
        (isVision || isBoth) &&
        !(await ensureVisionCapableModel(res, modelCache, llmConfig.model, {
          retryWithChatHint: isBoth,
        }))
      ) {
        return;
      }
      await prisma.user.update({
        where: { id: userId },
        data: slotFkData(slot, configId, {
          text: 'defaultLlmConfigId',
          vision: 'defaultVisionConfigId',
        }),
      });

      const result: UserDefaultConfig = {
        configId: llmConfig.id,
        configName: llmConfig.name,
      };

      logger.info(
        {
          discordUserId,
          configId,
          configName: llmConfig.name,
          slot,
        },
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
    }
  );
};

/** DELETE /api/user/model-override/default — clear user's global default LLM config */
export const handleClearDefaultModelConfig = (deps: RouteDeps): RequestHandler => {
  const { prisma, llmConfigCacheInvalidation } = deps;
  return withManifestInput(
    userRoutes.clearDefaultModelConfig,
    async (req: ProvisionedRequest, res: Response, { query }) => {
      const discordUserId = req.userId;
      const userId = resolveProvisionedUserId(req);

      const slots = parseClearSlots(res, query);
      if (slots === null) {
        return;
      }
      const { slot, clearText, clearVision } = slots;

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          defaultLlmConfigId: true,
          defaultVisionConfigId: true,
          // Tier signal for the fallback naming below: keyed = a wallet with
          // an ACTIVE chat-capable key (OpenRouter or ZaiCoding — the
          // hasActiveChatCapableKey predicate), whose post-clear cascade
          // bottoms out at the GLOBAL default pointers. An ElevenLabs/
          // Mistral-only wallet is a chat-guest: it falls to the free-default
          // floors at generation time (ApiKeyResolver), so the reply must name
          // the free default for them too.
          apiKeys: {
            where: { isActive: true },
            select: { id: true, provider: true, isActive: true },
          },
        },
      });

      if (user === null) {
        return sendError(res, ErrorResponses.notFound('User'));
      }
      const hadText = clearText && user.defaultLlmConfigId !== null;
      const hadVision = clearVision && user.defaultVisionConfigId !== null;
      const wasSet = hadText || hadVision;

      // Look up the default(s) the user will fall back to — ONE PER CLEARED
      // SLOT (an `all` clear names both), with the POINTER FAMILY picked by
      // the caller's tier: keyed → global defaults, guest → free defaults.
      // Per-personality overrides and personality-level defaults sit above
      // whatever this names and are unaffected by the clear.
      const keyed = hasActiveChatCapableKey(user.apiKeys ?? []);
      const newEffectiveDefaults = await resolveClearFallbackDefaults(
        prisma,
        clearText,
        clearVision,
        keyed
      );

      if (!wasSet) {
        logger.info(
          { discordUserId, slot, hadDefault: false },
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

      logger.info({ discordUserId, slot }, 'Cleared default config');

      await tryInvalidateCache(
        llmConfigCacheInvalidation?.invalidateUserLlmConfig.bind(
          llmConfigCacheInvalidation,
          discordUserId
        ),
        { discordUserId }
      );

      sendCustomSuccess(res, { deleted: true, wasSet: true, newEffectiveDefaults }, StatusCodes.OK);
    }
  );
};

/** DELETE /api/user/model-override/:personalityId — remove model override for a personality */
export const handleDeleteModelOverride = (deps: RouteDeps): RequestHandler => {
  const { prisma, llmConfigCacheInvalidation } = deps;
  return withManifestInput(
    userRoutes.deleteModelOverride,
    async (req: ProvisionedRequest, res: Response, { query, params }) => {
      const discordUserId = req.userId;
      const personalityId = params.personalityId;
      const userId = resolveProvisionedUserId(req);

      const slots = parseClearSlots(res, query);
      if (slots === null) {
        return;
      }
      const { slot, clearText, clearVision } = slots;

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
          { discordUserId, personalityId, slot, hadOverride: false },
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
      await pruneEmptyPersonalityConfig(prisma, override.id);

      logger.info(
        { discordUserId, personalityId, personalityName: override.personality.name, slot },
        'Removed override'
      );

      await tryInvalidateCache(
        llmConfigCacheInvalidation?.invalidateUserLlmConfig.bind(
          llmConfigCacheInvalidation,
          discordUserId
        ),
        { discordUserId }
      );

      sendCustomSuccess(res, { deleted: true }, StatusCodes.OK);
    }
  );
};
