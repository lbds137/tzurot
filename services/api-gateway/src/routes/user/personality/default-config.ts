/**
 * PUT/DELETE /api/user/personality/:slug/default-config
 *
 * Set or clear the personality-level default LLM config for a slot
 * (text | vision) — the `PersonalityDefaultConfig` / `PersonalityVisionDefaultConfig`
 * rows the config-resolver cascade reads after the user tiers and before the
 * admin default.
 */

import { type Response, type RequestHandler } from 'express';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import type { ModelSlot } from '@tzurot/common-types/constants/ai';
import {
  SetPersonalityDefaultConfigRequestSchema,
  SetPersonalityDefaultConfigResponseSchema,
  ClearPersonalityDefaultConfigResponseSchema,
} from '@tzurot/common-types/schemas/api/personalityDefaultConfig';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { asyncHandler } from '../../../utils/asyncHandler.js';
import { sendContractSuccess, sendError } from '../../../utils/responseHelpers.js';
import { ErrorResponses } from '../../../utils/errorResponses.js';
import { sendZodError } from '../../../utils/zodHelpers.js';
import type { ProvisionedRequest } from '../../../types.js';
import { getParam } from '../../../utils/requestParams.js';
import { parseModelSlotQuery } from '../../../utils/configRouteHelpers.js';
import { ensureVisionCapableModel } from '../../../utils/llmConfigValidation.js';
import { resolveProvisionedUserId } from '../../../utils/resolveProvisionedUserId.js';
import { resolvePersonalityForEdit } from './helpers.js';
import { verifyConfigAccess } from '../modelOverrideShared.js';
import { tryInvalidateCache } from '../../../utils/configOverrideHelpers.js';
import type { RouteDeps } from '../../routeDeps.js';

const logger = createLogger('user-personality-default-config');

/**
 * Slug + slot + owner check shared by both PUT and DELETE handlers. Sends
 * its own 400/403/404 and returns null on any refusal.
 */
async function resolveSlotAndOwnedPersonality(
  prisma: PrismaClient,
  req: ProvisionedRequest,
  res: Response
): Promise<{ slot: ModelSlot; personality: { id: string; ownerId: string } } | null> {
  const slug = getParam(req.params.slug);
  if (slug === undefined || slug === '') {
    sendError(res, ErrorResponses.validationError('slug is required'));
    return null;
  }

  const slot = parseModelSlotQuery(res, req.query);
  if (slot === null) {
    return null;
  }

  const resolved = await resolvePersonalityForEdit<{ id: string; ownerId: string }>({
    prisma,
    req,
    slug,
    res,
    options: {
      select: { id: true, ownerId: true },
      action: 'edit',
    },
  });
  if (resolved === null) {
    return null;
  }

  return { slot, personality: resolved.personality };
}

/**
 * Invalidate the personality cache AND the LLM config cache after a
 * default-config write. Both calls go through the shared never-throwing
 * `tryInvalidateCache` helper and run concurrently because they are
 * independent; a failure in either is warn-logged by the helper and never
 * fails the request.
 */
async function invalidateDefaultConfigCaches(
  deps: Pick<RouteDeps, 'cacheInvalidationService' | 'llmConfigCacheInvalidation'>,
  personalityId: string
): Promise<void> {
  const { cacheInvalidationService, llmConfigCacheInvalidation } = deps;

  await Promise.all([
    tryInvalidateCache(
      cacheInvalidationService === undefined
        ? undefined
        : () => cacheInvalidationService.invalidatePersonality(personalityId),
      { personalityId }
    ),
    tryInvalidateCache(
      llmConfigCacheInvalidation === undefined
        ? undefined
        : () => llmConfigCacheInvalidation.invalidateAll(),
      { personalityId }
    ),
  ]);
}

/** PUT /api/user/personality/:slug/default-config — set the slot's default config. */
export const handleSetPersonalityDefaultConfig = (deps: RouteDeps): RequestHandler => {
  const { prisma, modelCache, cacheInvalidationService, llmConfigCacheInvalidation } = deps;
  return asyncHandler(async (req: ProvisionedRequest, res: Response) => {
    const discordUserId = req.userId;
    const resolved = await resolveSlotAndOwnedPersonality(prisma, req, res);
    if (resolved === null) {
      return;
    }
    const { slot, personality } = resolved;

    const parseResult = SetPersonalityDefaultConfigRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      return sendZodError(res, parseResult.error);
    }
    const { configId } = parseResult.data;

    const userId = resolveProvisionedUserId(req);
    const llmConfig = await verifyConfigAccess(prisma, configId, userId);
    if (llmConfig === null) {
      return sendError(res, ErrorResponses.notFound('Config'));
    }

    const isVision = slot === 'vision';
    if (isVision && !(await ensureVisionCapableModel(res, modelCache, llmConfig.model))) {
      return;
    }

    if (isVision) {
      await prisma.personalityVisionDefaultConfig.upsert({
        where: { personalityId: personality.id },
        create: { personalityId: personality.id, llmConfigId: configId },
        update: { llmConfigId: configId },
      });
    } else {
      await prisma.personalityDefaultConfig.upsert({
        where: { personalityId: personality.id },
        create: { personalityId: personality.id, llmConfigId: configId },
        update: { llmConfigId: configId },
      });
    }

    await invalidateDefaultConfigCaches(
      { cacheInvalidationService, llmConfigCacheInvalidation },
      personality.id
    );

    logger.info(
      { personalityId: personality.id, slot, configId, discordUserId },
      'Set personality default config'
    );

    sendContractSuccess(res, SetPersonalityDefaultConfigResponseSchema, {
      slot,
      config: { id: llmConfig.id, name: llmConfig.name, model: llmConfig.model },
    });
  });
};

/** DELETE /api/user/personality/:slug/default-config — clear the slot's default config. */
export const handleClearPersonalityDefaultConfig = (deps: RouteDeps): RequestHandler => {
  const { prisma, cacheInvalidationService, llmConfigCacheInvalidation } = deps;
  return asyncHandler(async (req: ProvisionedRequest, res: Response) => {
    const discordUserId = req.userId;
    const resolved = await resolveSlotAndOwnedPersonality(prisma, req, res);
    if (resolved === null) {
      return;
    }
    const { slot, personality } = resolved;

    const isVision = slot === 'vision';
    if (isVision) {
      await prisma.personalityVisionDefaultConfig.deleteMany({
        where: { personalityId: personality.id },
      });
    } else {
      await prisma.personalityDefaultConfig.deleteMany({
        where: { personalityId: personality.id },
      });
    }

    await invalidateDefaultConfigCaches(
      { cacheInvalidationService, llmConfigCacheInvalidation },
      personality.id
    );

    logger.info(
      { personalityId: personality.id, slot, discordUserId },
      'Cleared personality default config'
    );

    sendContractSuccess(res, ClearPersonalityDefaultConfigResponseSchema, { success: true });
  });
};
