/**
 * Voice Models Route
 *
 * Lists available ElevenLabs TTS models for the authenticated user.
 * Extracted from voices.ts to keep that file under the 400-line limit.
 *
 * Endpoint:
 * - GET /models - List TTS-capable models from ElevenLabs
 */

import { z } from 'zod';
import { createLogger, TTLCache, type PrismaClient } from '@tzurot/common-types';
import type { Response as ExpressResponse } from 'express';
import { resolveElevenLabsKey } from '../../utils/elevenLabsKeyResolver.js';
import { fetchFromElevenLabs } from '../../utils/elevenLabsFetch.js';
import { sendCustomSuccess, sendError } from '../../utils/responseHelpers.js';
import type { AuthenticatedRequest } from '../../types.js';

const logger = createLogger('VoiceModelsRoute');

interface CachedModelList {
  models: { modelId: string; name: string }[];
}

const MODEL_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const MODEL_CACHE_MAX_SIZE = 200; // max user entries (each entry is a small model list)

const modelCache = new TTLCache<CachedModelList>({
  ttl: MODEL_CACHE_TTL,
  maxSize: MODEL_CACHE_MAX_SIZE,
});

/** @internal Reset cache (for testing only). */
export function resetModelCache(): void {
  modelCache.clear();
}

/** Zod schema for ElevenLabs model list response */
const ElevenLabsModelSchema = z.object({
  model_id: z.string(),
  name: z.string(),
  can_do_text_to_speech: z.boolean().optional(),
});

const ElevenLabsModelsResponseSchema = z.array(ElevenLabsModelSchema);

/**
 * GET /models handler — list TTS-capable models from ElevenLabs.
 *
 * NOTE: ai-worker has a parallel implementation in services/voice/ElevenLabsClient.ts
 * (elevenLabsListModels) that filters models the same way (can_do_text_to_speech === true).
 * If the filter logic changes, update both places. Validation differs by design: this
 * path uses Zod and surfaces parse failures as 500 errors, while ai-worker uses manual
 * Array.isArray() and returns [] on unexpected shapes (silent degradation for job context).
 */
export async function handleListModels(
  prisma: PrismaClient,
  req: AuthenticatedRequest,
  res: ExpressResponse
): Promise<void> {
  const discordUserId = req.userId;

  // Check cache before DB + external API calls. Keyed by userId (not API key)
  // so key rotation or revocation may serve stale model data for up to 5 min.
  // Acceptable tradeoff: model lists are currently identical across keys and the
  // data is benign (no secrets), while the cache skips a DB + external API round-trip.
  // Per-user keying (vs. a single global key) future-proofs against ElevenLabs
  // introducing tier-based model availability — a global key would silently serve
  // the wrong model list if different accounts see different models.
  const cached = modelCache.get(discordUserId);
  if (cached !== null) {
    logger.debug({ discordUserId }, 'Cache hit for ElevenLabs models');
    sendCustomSuccess(res, cached);
    return;
  }

  const keyResult = await resolveElevenLabsKey(prisma, discordUserId);
  if ('errorResponse' in keyResult) {
    sendError(res, keyResult.errorResponse);
    return;
  }

  const result = await fetchFromElevenLabs({
    endpoint: '/models',
    apiKey: keyResult.apiKey,
    schema: ElevenLabsModelsResponseSchema,
    resourceName: 'models',
  });

  if ('errorResponse' in result) {
    sendError(res, result.errorResponse);
    return;
  }

  const ttsModels = result.data
    .filter(m => m.can_do_text_to_speech === true)
    .map(m => ({ modelId: m.model_id, name: m.name }));

  logger.info({ discordUserId, modelCount: ttsModels.length }, 'Listed ElevenLabs TTS models');

  const modelResult = { models: ttsModels };
  modelCache.set(discordUserId, modelResult);
  sendCustomSuccess(res, modelResult);
}
