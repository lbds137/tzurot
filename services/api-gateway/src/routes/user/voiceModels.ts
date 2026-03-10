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
import { createLogger, type PrismaClient } from '@tzurot/common-types';
import type { Response as ExpressResponse } from 'express';
import { resolveElevenLabsKey } from '../../utils/elevenLabsKeyResolver.js';
import { fetchFromElevenLabs } from '../../utils/elevenLabsFetch.js';
import { sendCustomSuccess, sendError } from '../../utils/responseHelpers.js';
import type { AuthenticatedRequest } from '../../types.js';

const logger = createLogger('VoiceModelsRoute');

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
 * If the filter logic changes, update both places.
 */
export async function handleListModels(
  prisma: PrismaClient,
  req: AuthenticatedRequest,
  res: ExpressResponse
): Promise<void> {
  const discordUserId = req.userId;

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

  logger.info(
    { discordUserId, modelCount: ttsModels.length },
    '[Models] Listed ElevenLabs TTS models'
  );

  sendCustomSuccess(res, { models: ttsModels });
}
