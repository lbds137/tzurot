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
import {
  createLogger,
  VALIDATION_TIMEOUTS,
  AI_ENDPOINTS,
  type PrismaClient,
} from '@tzurot/common-types';
import type { Response as ExpressResponse } from 'express';
import { resolveElevenLabsKey } from '../../utils/elevenLabsKeyResolver.js';
import { sendCustomSuccess, sendError } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
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

  const response = await fetch(`${AI_ENDPOINTS.ELEVENLABS_BASE_URL}/models`, {
    headers: { 'xi-api-key': keyResult.apiKey },
    signal: AbortSignal.timeout(VALIDATION_TIMEOUTS.ELEVENLABS_API_CALL),
  });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      logger.warn({ status: response.status }, '[Models] ElevenLabs rejected API key');
      sendError(
        res,
        ErrorResponses.unauthorized(
          'ElevenLabs API key is invalid or expired. Update it with /settings apikey set'
        )
      );
      return;
    }
    logger.error(
      { status: response.status, statusText: response.statusText },
      '[Models] ElevenLabs API error'
    );
    sendError(res, ErrorResponses.internalError('Failed to fetch models from ElevenLabs'));
    return;
  }

  const parseResult = ElevenLabsModelsResponseSchema.safeParse(await response.json());
  if (!parseResult.success) {
    logger.error(
      { errors: parseResult.error.format() },
      '[Models] Unexpected response format from ElevenLabs'
    );
    sendError(res, ErrorResponses.internalError('Unexpected response from ElevenLabs API'));
    return;
  }

  const ttsModels = parseResult.data
    .filter(m => m.can_do_text_to_speech === true)
    .map(m => ({ modelId: m.model_id, name: m.name }));

  logger.info(
    { discordUserId, modelCount: ttsModels.length },
    '[Models] Listed ElevenLabs TTS models'
  );

  sendCustomSuccess(res, { models: ttsModels });
}
