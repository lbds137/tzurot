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
  ELEVENLABS_VOICE_NAME_PREFIX,
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

/** Validates ElevenLabs voice IDs — prevents unnecessary API round-trips for garbage input */
const VOICE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** Max concurrent ElevenLabs delete calls per batch in bulk clear */
const DELETE_BATCH_SIZE = 5;

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
    select: {
      id: true,
      apiKeys: {
        where: { provider: AIProvider.ElevenLabs },
        select: { iv: true, content: true, tag: true },
        take: 1,
      },
    },
  });

  if (user === null) {
    return { errorResponse: ErrorResponses.notFound('User') };
  }

  const storedKey = user.apiKeys[0];
  if (storedKey === undefined) {
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
 * Returns an ErrorResponse for auth failures (401/403) so callers can surface
 * user-actionable messages instead of a generic 500.
 *
 */
async function fetchTzurotVoices(
  apiKey: string
): Promise<{ voices: ElevenLabsVoice[]; totalSlots: number } | { errorResponse: ErrorResponse }> {
  const response = await fetch(`${AI_ENDPOINTS.ELEVENLABS_BASE_URL}/voices`, {
    headers: { 'xi-api-key': apiKey },
    signal: AbortSignal.timeout(VALIDATION_TIMEOUTS.ELEVENLABS_API_CALL),
  });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      logger.warn({ status: response.status }, '[Voices] ElevenLabs rejected API key');
      return {
        errorResponse: ErrorResponses.unauthorized(
          'ElevenLabs API key is invalid or expired. Update it with /settings apikey set'
        ),
      };
    }
    logger.error(
      { status: response.status, statusText: response.statusText },
      '[Voices] ElevenLabs API error'
    );
    return {
      errorResponse: ErrorResponses.internalError('Failed to fetch voices from ElevenLabs'),
    };
  }

  const data = (await response.json()) as ElevenLabsVoicesResponse;
  const allVoices = Array.isArray(data.voices) ? data.voices : [];
  const tzurotVoices = allVoices.filter(
    v => typeof v.name === 'string' && v.name.startsWith(ELEVENLABS_VOICE_NAME_PREFIX)
  );

  return { voices: tzurotVoices, totalSlots: allVoices.length };
}

/**
 * Fetch a single voice by ID from ElevenLabs.
 * Used by the delete handler for O(1) IDOR verification instead of listing all voices.
 */
async function fetchSingleVoice(
  apiKey: string,
  voiceId: string
): Promise<{ voice: ElevenLabsVoice } | { errorResponse: ErrorResponse }> {
  const response = await fetch(
    `${AI_ENDPOINTS.ELEVENLABS_BASE_URL}/voices/${encodeURIComponent(voiceId)}`,
    {
      headers: { 'xi-api-key': apiKey },
      signal: AbortSignal.timeout(VALIDATION_TIMEOUTS.ELEVENLABS_API_CALL),
    }
  );

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      logger.warn({ status: response.status }, '[Voices] ElevenLabs rejected API key');
      return {
        errorResponse: ErrorResponses.unauthorized(
          'ElevenLabs API key is invalid or expired. Update it with /settings apikey set'
        ),
      };
    }
    if (response.status === 404) {
      return { errorResponse: ErrorResponses.notFound('Voice') };
    }
    logger.error(
      { status: response.status, statusText: response.statusText, voiceId },
      '[Voices] ElevenLabs API error fetching voice'
    );
    return {
      errorResponse: ErrorResponses.internalError('Failed to fetch voice from ElevenLabs'),
    };
  }

  const voice = (await response.json()) as ElevenLabsVoice;
  if (typeof voice.voice_id !== 'string' || typeof voice.name !== 'string') {
    return {
      errorResponse: ErrorResponses.internalError('Unexpected voice response from ElevenLabs'),
    };
  }
  return { voice };
}

/** Delete a single ElevenLabs voice via the API */
async function deleteElevenLabsVoice(
  apiKey: string,
  voiceId: string
): Promise<globalThis.Response> {
  return fetch(`${AI_ENDPOINTS.ELEVENLABS_BASE_URL}/voices/${encodeURIComponent(voiceId)}`, {
    method: 'DELETE',
    headers: { 'xi-api-key': apiKey },
    signal: AbortSignal.timeout(VALIDATION_TIMEOUTS.ELEVENLABS_API_CALL),
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

  const voicesResult = await fetchTzurotVoices(keyResult.apiKey);
  if ('errorResponse' in voicesResult) {
    sendError(res, voicesResult.errorResponse);
    return;
  }

  const { voices, totalSlots } = voicesResult;

  logger.info(
    { discordUserId, tzurotCount: voices.length, totalSlots },
    '[Voices] Listed cloned voices'
  );

  sendCustomSuccess(res, {
    voices: voices.map(v => ({
      voiceId: v.voice_id,
      name: v.name,
      slug: v.name.slice(ELEVENLABS_VOICE_NAME_PREFIX.length),
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
  // @types/express-serve-static-core ParamsDictionary: [key: string]: string | string[]
  // Named route params (`:voiceId`) are always string, but the index signature is wider
  const voiceId = req.params.voiceId as string;

  if (!VOICE_ID_RE.test(voiceId)) {
    sendError(res, ErrorResponses.notFound('Voice'));
    return;
  }

  const keyResult = await resolveElevenLabsKey(prisma, discordUserId);
  if ('errorResponse' in keyResult) {
    sendError(res, keyResult.errorResponse);
    return;
  }

  // Fetch the single voice to verify it exists and is tzurot-prefixed (IDOR guard).
  // Uses GET /v1/voices/:voiceId — O(1) instead of listing all voices.
  const voiceResult = await fetchSingleVoice(keyResult.apiKey, voiceId);
  if ('errorResponse' in voiceResult) {
    sendError(res, voiceResult.errorResponse);
    return;
  }

  const { voice } = voiceResult;

  if (!voice.name.startsWith(ELEVENLABS_VOICE_NAME_PREFIX)) {
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
    slug: voice.name.slice(ELEVENLABS_VOICE_NAME_PREFIX.length),
  });
}

/**
 * POST /clear handler — delete ALL tzurot-prefixed voices.
 *
 * Always returns 200 OK, even on partial failure. Callers must inspect the
 * response body: `{ deleted, total, errors? }`. When `errors` is present,
 * some deletions failed but others succeeded. This mirrors the bot-client's
 * expectation — it shows a warning embed for partial failures.
 */
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

  const voicesResult = await fetchTzurotVoices(keyResult.apiKey);
  if ('errorResponse' in voicesResult) {
    sendError(res, voicesResult.errorResponse);
    return;
  }

  const { voices } = voicesResult;

  if (voices.length === 0) {
    sendCustomSuccess(res, { deleted: 0, total: 0, message: 'No Tzurot voices to clear' });
    return;
  }

  // Delete in small batches to balance speed vs ElevenLabs rate limits.
  // Bot-client uses GATEWAY_TIMEOUTS.BULK_OPERATION (30s) for this call.
  // If the gateway exceeds that, the bot-client aborts but deletions continue
  // server-side — no data is lost, voices are eventually removed.
  let deleted = 0;
  const errors: string[] = [];

  for (let i = 0; i < voices.length; i += DELETE_BATCH_SIZE) {
    const batch = voices.slice(i, i + DELETE_BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async voice => {
        const deleteResponse = await deleteElevenLabsVoice(keyResult.apiKey, voice.voice_id);
        if (!deleteResponse.ok) {
          throw new Error(`${voice.name}: ${deleteResponse.status}`);
        }
      })
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        deleted++;
      } else {
        errors.push(result.reason instanceof Error ? result.reason.message : 'Unknown error');
      }
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

  // Register /clear before /:voiceId so the wildcard doesn't shadow it
  router.post(
    '/clear',
    requireUserAuth(),
    asyncHandler(async (req: AuthenticatedRequest, res: ExpressResponse) => {
      await handleClearVoices(prisma, req, res);
    })
  );

  router.delete(
    '/:voiceId',
    requireUserAuth(),
    asyncHandler(async (req: AuthenticatedRequest, res: ExpressResponse) => {
      await handleDeleteVoice(prisma, req, res);
    })
  );

  return router;
}
