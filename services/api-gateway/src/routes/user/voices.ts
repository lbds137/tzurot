/**
 * Voice Management Routes
 *
 * Manages ElevenLabs cloned voices (tzurot-prefixed) for BYOK users.
 * Proxies to ElevenLabs API after decrypting the user's stored key.
 *
 * Endpoints:
 * - GET /    - List cloned voices (filtered to tzurot-* prefix)
 * - DELETE /:voiceId - Delete a single voice
 * - POST /clear     - Delete ALL tzurot-prefixed voices
 */

import { Router, type Response as ExpressResponse } from 'express';
import {
  createLogger,
  decryptApiKey,
  AIProvider,
  AI_ENDPOINTS,
  VALIDATION_TIMEOUTS,
  type PrismaClient,
} from '@tzurot/common-types';
import type { ErrorResponse } from '../../utils/errorResponses.js';
import { requireUserAuth } from '../../services/AuthMiddleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendCustomSuccess, sendError } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import type { AuthenticatedRequest } from '../../types.js';

const logger = createLogger('VoicesRoute');

/** Prefix used by ElevenLabsVoiceService when cloning voices */
const VOICE_NAME_PREFIX = 'tzurot-';

/** Shape of a voice entry from ElevenLabs GET /v1/voices */
interface ElevenLabsVoice {
  voice_id: string;
  name: string;
  category?: string;
}

/** Response from ElevenLabs GET /v1/voices */
interface ElevenLabsVoicesResponse {
  voices: ElevenLabsVoice[];
}

/**
 * Resolve and decrypt the user's ElevenLabs API key.
 * Returns the decrypted key or an ErrorResponse for the caller to send.
 */
async function resolveElevenLabsKey(
  prisma: PrismaClient,
  discordUserId: string
): Promise<{ apiKey: string } | { errorResponse: ErrorResponse }> {
  const user = await prisma.user.findFirst({
    where: { discordId: discordUserId },
    select: { id: true },
  });

  if (user === null) {
    return { errorResponse: ErrorResponses.notFound('User') };
  }

  const storedKey = await prisma.userApiKey.findFirst({
    where: { userId: user.id, provider: AIProvider.ElevenLabs },
    select: { iv: true, content: true, tag: true },
  });

  if (storedKey === null) {
    return {
      errorResponse: ErrorResponses.notFound(
        'ElevenLabs API key. Set one with /settings apikey set'
      ),
    };
  }

  try {
    const apiKey = decryptApiKey({
      iv: storedKey.iv,
      content: storedKey.content,
      tag: storedKey.tag,
    });
    return { apiKey };
  } catch (error) {
    logger.error({ err: error, discordUserId }, '[Voices] Failed to decrypt ElevenLabs key');
    return { errorResponse: ErrorResponses.internalError('Failed to decrypt stored API key') };
  }
}

/**
 * Fetch all voices from ElevenLabs, filtered to tzurot-prefixed clones.
 */
async function fetchTzurotVoices(
  apiKey: string
): Promise<{ voices: ElevenLabsVoice[]; totalSlots: number }> {
  const response = await fetch(`${AI_ENDPOINTS.ELEVENLABS_BASE_URL}/voices`, {
    headers: { 'xi-api-key': apiKey },
    signal: AbortSignal.timeout(VALIDATION_TIMEOUTS.API_KEY_VALIDATION),
  });

  if (!response.ok) {
    throw new Error(`ElevenLabs API error: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as ElevenLabsVoicesResponse;
  const allVoices = data.voices;
  const tzurotVoices = allVoices.filter(v => v.name.startsWith(VOICE_NAME_PREFIX));

  return { voices: tzurotVoices, totalSlots: allVoices.length };
}

/** Delete a single ElevenLabs voice via the API */
async function deleteElevenLabsVoice(
  apiKey: string,
  voiceId: string
): Promise<globalThis.Response> {
  return fetch(`${AI_ENDPOINTS.ELEVENLABS_BASE_URL}/voices/${encodeURIComponent(voiceId)}`, {
    method: 'DELETE',
    headers: { 'xi-api-key': apiKey },
    signal: AbortSignal.timeout(VALIDATION_TIMEOUTS.API_KEY_VALIDATION),
  });
}

/** GET / handler — list cloned voices with slot summary */
async function handleListVoices(
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

  const { voices, totalSlots } = await fetchTzurotVoices(keyResult.apiKey);

  logger.info(
    { discordUserId, tzurotCount: voices.length, totalSlots },
    '[Voices] Listed cloned voices'
  );

  sendCustomSuccess(res, {
    voices: voices.map(v => ({
      voiceId: v.voice_id,
      name: v.name,
      slug: v.name.slice(VOICE_NAME_PREFIX.length),
    })),
    totalSlots,
    tzurotCount: voices.length,
  });
}

/** DELETE /:voiceId handler — delete a single tzurot-prefixed voice */
async function handleDeleteVoice(
  prisma: PrismaClient,
  req: AuthenticatedRequest,
  res: ExpressResponse
): Promise<void> {
  const discordUserId = req.userId;
  const voiceId = req.params.voiceId as string;

  const keyResult = await resolveElevenLabsKey(prisma, discordUserId);
  if ('errorResponse' in keyResult) {
    sendError(res, keyResult.errorResponse);
    return;
  }

  const { voices } = await fetchTzurotVoices(keyResult.apiKey);
  const voice = voices.find(v => v.voice_id === voiceId);

  if (voice === undefined) {
    sendError(res, ErrorResponses.notFound('Voice not found or not a Tzurot-cloned voice'));
    return;
  }

  const deleteResponse = await deleteElevenLabsVoice(keyResult.apiKey, voiceId);

  if (!deleteResponse.ok) {
    logger.error(
      {
        discordUserId,
        voiceId,
        status: deleteResponse.status,
        statusText: deleteResponse.statusText,
      },
      '[Voices] Failed to delete voice from ElevenLabs'
    );
    sendError(res, ErrorResponses.internalError('Failed to delete voice'));
    return;
  }

  logger.info({ discordUserId, voiceId, voiceName: voice.name }, '[Voices] Deleted voice');

  sendCustomSuccess(res, {
    deleted: true,
    voiceId,
    name: voice.name,
    slug: voice.name.slice(VOICE_NAME_PREFIX.length),
  });
}

/** POST /clear handler — delete ALL tzurot-prefixed voices */
async function handleClearVoices(
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

  const { voices } = await fetchTzurotVoices(keyResult.apiKey);

  if (voices.length === 0) {
    sendCustomSuccess(res, { deleted: 0, message: 'No Tzurot voices to clear' });
    return;
  }

  const results = await Promise.allSettled(
    voices.map(async voice => {
      const deleteResponse = await deleteElevenLabsVoice(keyResult.apiKey, voice.voice_id);
      if (!deleteResponse.ok) {
        throw new Error(`${voice.name}: ${deleteResponse.status}`);
      }
      return voice;
    })
  );

  let deleted = 0;
  const errors: string[] = [];
  for (const result of results) {
    if (result.status === 'fulfilled') {
      deleted++;
    } else {
      errors.push(result.reason instanceof Error ? result.reason.message : 'Unknown error');
    }
  }

  logger.info(
    { discordUserId, deleted, total: voices.length, errors: errors.length },
    '[Voices] Cleared cloned voices'
  );

  sendCustomSuccess(res, {
    deleted,
    total: voices.length,
    errors: errors.length > 0 ? errors : undefined,
  });
}

export function createVoicesRoutes(prisma: PrismaClient): Router {
  const router = Router();

  router.get(
    '/',
    requireUserAuth(),
    asyncHandler(async (req: AuthenticatedRequest, res: ExpressResponse) => {
      await handleListVoices(prisma, req, res);
    })
  );

  router.delete(
    '/:voiceId',
    requireUserAuth(),
    asyncHandler(async (req: AuthenticatedRequest, res: ExpressResponse) => {
      await handleDeleteVoice(prisma, req, res);
    })
  );

  router.post(
    '/clear',
    requireUserAuth(),
    asyncHandler(async (req: AuthenticatedRequest, res: ExpressResponse) => {
      await handleClearVoices(prisma, req, res);
    })
  );

  return router;
}
