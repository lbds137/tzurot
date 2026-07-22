/**
 * Voice Management Routes
 *
 * Manages cloned voices (tzurot-prefixed) across ALL audio providers a user
 * has BYOK keys for. Currently supports ElevenLabs and Mistral; new audio
 * providers slot in by registering a `VoiceProviderClient` below.
 *
 * Endpoints:
 * - GET /                    — list cloned voices (across all configured providers)
 * - DELETE /:provider/:voiceId — delete a single voice from the named provider
 * - POST /clear              — delete ALL tzurot-prefixed voices across all providers
 */

import { Router, type Response as ExpressResponse, type RequestHandler } from 'express';
import { TTS_VOICE_NAME_PREFIX } from '@tzurot/common-types/constants/ai';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import { isAudioProviderId, type AudioProviderId } from '@tzurot/common-types/types/audio-provider';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { ErrorCode, type AuthenticatedRequest } from '../../types.js';
import { type ErrorResponse, ErrorResponses } from '../../utils/errorResponses.js';
import { requireUserAuth, requireProvisionedUser } from '../../services/AuthMiddleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendCustomSuccess, sendError } from '../../utils/responseHelpers.js';
import { resolveAudioProviderKeys } from '../../utils/audioProviderKeyResolver.js';
import {
  listElevenLabsTzurotVoices,
  getElevenLabsVoice,
  deleteElevenLabsVoice,
} from '../../utils/elevenLabsVoicesClient.js';
import {
  listMistralTzurotVoices,
  getMistralVoice,
  deleteMistralVoice,
  type MistralCloned,
} from '../../utils/mistralVoicesClient.js';
import { handleListModels as listModelsImpl } from './voiceModels.js';
import type { RouteDeps } from '../routeDeps.js';

const logger = createLogger('VoicesRoute');

/** Validates voice IDs across providers — prevents unnecessary API round-trips for garbage input.
 *  Both ElevenLabs (20-char IDs) and Mistral (UUIDs with hyphens) fit this character class. */
const VOICE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** Max concurrent provider-API delete calls per batch in bulk clear */
const DELETE_BATCH_SIZE = 5;

/**
 * Provider-tagged voice entry returned to bot-client. The `provider` field
 * lets the autocomplete / delete handlers know which API to talk to without
 * a separate lookup.
 */
interface TaggedVoice {
  provider: AudioProviderId;
  voiceId: string;
  name: string;
  slug: string;
}

/**
 * Per-provider warning surfaced to bot-client when one provider's fetch
 * failed but the request as a whole succeeded (e.g., working ElevenLabs key
 * + bad Mistral key returns ElevenLabs voices with a "Mistral unavailable"
 * warning). Without this, a user with an expired key sees fewer voices and
 * has no signal that something's wrong.
 */
interface ProviderWarning {
  provider: AudioProviderId;
  message: string;
}

/**
 * Map a provider's error response to a clean user-facing warning message.
 * The provider name is added by the consumer (`Mistral: ...`), so messages
 * here describe only the failure shape, not which provider failed.
 *
 * Exported for direct unit-test coverage: the fallback ("Couldn't load
 * voices") branch isn't reachable through the route tests because both
 * voice clients only emit UNAUTHORIZED and INTERNAL_ERROR, but the branch
 * remains as defensive code for future error codes.
 */
export function describeProviderError(errorResponse: ErrorResponse): string {
  if (errorResponse.error === ErrorCode.UNAUTHORIZED) {
    return 'API key invalid or expired';
  }
  if (errorResponse.error === ErrorCode.INTERNAL_ERROR) {
    return 'Provider temporarily unavailable';
  }
  return "Couldn't load voices";
}

// ===== Provider-fanout helpers =============================================

/**
 * Per-provider list dispatch. Exhaustive switch with `never`-typed default
 * so adding a new `AudioProviderId` value surfaces a compile error here
 * rather than silently being skipped on list/clear. Mirrors
 * `deleteVoiceAtProvider`'s exhaustiveness pattern. Normalizes the per-API
 * shape (ElevenLabs `voice_id`, Mistral `voiceId`) to the unified
 * `TaggedVoice` shape at the source.
 */
async function listVoicesForProvider(
  provider: AudioProviderId,
  apiKey: string
): Promise<{ voices: TaggedVoice[]; totalVoices: number } | { errorResponse: ErrorResponse }> {
  switch (provider) {
    case 'elevenlabs': {
      const result = await listElevenLabsTzurotVoices(apiKey);
      if ('errorResponse' in result) {
        return result;
      }
      return {
        voices: result.voices.map(v => ({
          provider: 'elevenlabs',
          voiceId: v.voice_id,
          name: v.name,
          slug: v.name.slice(TTS_VOICE_NAME_PREFIX.length),
        })),
        totalVoices: result.totalVoices,
      };
    }
    case 'mistral': {
      const result = await listMistralTzurotVoices(apiKey, TTS_VOICE_NAME_PREFIX);
      if ('errorResponse' in result) {
        return result;
      }
      return {
        voices: result.voices.map(v => ({
          provider: 'mistral',
          voiceId: v.voiceId,
          name: v.name,
          slug: v.name.slice(TTS_VOICE_NAME_PREFIX.length),
        })),
        totalVoices: result.totalVoices,
      };
    }
    default: {
      const _exhaustive: never = provider;
      throw new Error(`Unsupported audio provider: ${String(_exhaustive)}`);
    }
  }
}

/**
 * Fetch tzurot-prefixed cloned voices from every provider the user has a
 * BYOK key for, tagging each voice with its provider. Used by both list and
 * clear handlers.
 *
 * Auth-error responses are surfaced as `errorResponse` only when ALL
 * providers fail (otherwise success-with-fewer-results is the right shape
 * — a working ElevenLabs key + bad Mistral key shouldn't break the listing
 * the user's actual ElevenLabs voices).
 */
export async function fetchAllTzurotVoices(keys: Map<AudioProviderId, string>): Promise<{
  voices: TaggedVoice[];
  totalVoicesByProvider: Map<AudioProviderId, number>;
  warnings: ProviderWarning[];
}> {
  const tagged: TaggedVoice[] = [];
  const totals = new Map<AudioProviderId, number>();
  const warnings: ProviderWarning[] = [];

  // Fan out per-provider fetches in parallel. Sequential `for...of` made a
  // user with both ElevenLabs + Mistral keys wait ~500-1000ms per provider
  // serially; parallelizing halves the wall-clock latency.
  const settled = await Promise.allSettled(
    [...keys].map(async ([provider, apiKey]) => {
      const result = await listVoicesForProvider(provider, apiKey);
      return { provider, result };
    })
  );

  for (const outcome of settled) {
    if (outcome.status === 'rejected') {
      // Defensive: listVoicesForProvider catches everything internally and
      // returns `{ errorResponse }`, so this branch shouldn't fire. Log and
      // skip rather than failing the whole list.
      logger.warn({ err: outcome.reason }, 'listVoicesForProvider rejected unexpectedly');
      continue;
    }
    const { provider, result } = outcome.value;
    if ('errorResponse' in result) {
      logger.warn(
        { provider, errorResponse: result.errorResponse },
        'Skipping provider — fetch failed'
      );
      warnings.push({ provider, message: describeProviderError(result.errorResponse) });
      continue;
    }
    totals.set(provider, result.totalVoices);
    tagged.push(...result.voices);
  }

  return { voices: tagged, totalVoicesByProvider: totals, warnings };
}

/** Per-provider single-voice lookup (for IDOR-style verification before delete). */
async function fetchVoiceFromProvider(
  provider: AudioProviderId,
  apiKey: string,
  voiceId: string
): Promise<{ name: string } | { errorResponse: ErrorResponse }> {
  if (provider === 'elevenlabs') {
    const result = await getElevenLabsVoice(apiKey, voiceId);
    if ('errorResponse' in result) {
      return result;
    }
    return { name: result.voice.name };
  }
  // mistral
  const result: { voice: MistralCloned } | { errorResponse: ErrorResponse } = await getMistralVoice(
    apiKey,
    voiceId
  );
  if ('errorResponse' in result) {
    return result;
  }
  return { name: result.voice.name };
}

/** Per-provider single-voice delete dispatch.
 *  Exhaustive switch with `never`-typed default so adding a new
 *  `AudioProviderId` value surfaces a compile error here rather than
 *  silently routing to a wrong provider's API. */
async function deleteVoiceAtProvider(
  provider: AudioProviderId,
  apiKey: string,
  voiceId: string
): Promise<globalThis.Response> {
  switch (provider) {
    case 'elevenlabs':
      return deleteElevenLabsVoice(apiKey, voiceId);
    case 'mistral':
      return deleteMistralVoice(apiKey, voiceId);
    default: {
      const _exhaustive: never = provider;
      throw new Error(`Unsupported audio provider: ${String(_exhaustive)}`);
    }
  }
}

// ===== Handlers ============================================================

/** GET / — list tzurot-prefixed voices across all providers the user has keys for. */
async function listVoicesImpl(
  prisma: PrismaClient,
  req: AuthenticatedRequest,
  res: ExpressResponse
): Promise<void> {
  const discordUserId = req.userId;

  const keysResult = await resolveAudioProviderKeys(prisma, discordUserId);
  if ('errorResponse' in keysResult) {
    sendError(res, keysResult.errorResponse);
    return;
  }

  if (keysResult.keys.size === 0) {
    sendError(
      res,
      ErrorResponses.notFound(
        'audio provider API key. Set one with /settings apikey set (ElevenLabs or Mistral)'
      )
    );
    return;
  }

  const { voices, totalVoicesByProvider, warnings } = await fetchAllTzurotVoices(keysResult.keys);
  const totalVoices = Array.from(totalVoicesByProvider.values()).reduce((a, b) => a + b, 0);

  logger.info(
    {
      discordUserId,
      tzurotCount: voices.length,
      totalVoices,
      providers: [...keysResult.keys.keys()],
      warningCount: warnings.length,
    },
    'Listed cloned voices across providers'
  );

  // Omit `warnings` field entirely when empty — keeps the success response
  // shape clean and lets bot-client treat its presence as the signal to
  // render. Mirror the contract on the bot-client side: optional field.
  sendCustomSuccess(res, {
    voices,
    totalVoices,
    tzurotCount: voices.length,
    ...(warnings.length > 0 ? { warnings } : {}),
  });
}

/** DELETE /:provider/:voiceId — delete a single tzurot-prefixed voice from a specific provider. */
async function deleteVoiceImpl(
  prisma: PrismaClient,
  req: AuthenticatedRequest,
  res: ExpressResponse
): Promise<void> {
  const discordUserId = req.userId;
  // ParamsDictionary widening: route params are always string at runtime
  const provider = req.params.provider as string;
  const voiceId = req.params.voiceId as string;

  // `AudioProviderId` is intentionally narrower than `TtsProviderId` — it
  // excludes `self-hosted` because users don't manage voices in a self-hosted
  // account (no per-user voice slate to clone/delete). Only `'elevenlabs'`
  // and `'mistral'` pass this guard. Pairs with the exhaustive switch in
  // `deleteVoiceAtProvider`: adding a new BYOK provider only requires
  // updating `AudioProviderId` + its dispatch case.
  if (!isAudioProviderId(provider)) {
    sendError(res, ErrorResponses.validationError(`Unknown provider: ${provider}`));
    return;
  }
  if (!VOICE_ID_RE.test(voiceId)) {
    sendError(res, ErrorResponses.validationError('Invalid voice ID format'));
    return;
  }

  const audioProvider = provider;

  const keysResult = await resolveAudioProviderKeys(prisma, discordUserId);
  if ('errorResponse' in keysResult) {
    sendError(res, keysResult.errorResponse);
    return;
  }

  const apiKey = keysResult.keys.get(audioProvider);
  if (apiKey === undefined) {
    sendError(
      res,
      ErrorResponses.notFound(`${audioProvider} API key. Set one with /settings apikey set`)
    );
    return;
  }

  // IDOR guard: fetch the voice and verify it has the tzurot- prefix before deleting.
  const voiceResult = await fetchVoiceFromProvider(audioProvider, apiKey, voiceId);
  if ('errorResponse' in voiceResult) {
    sendError(res, voiceResult.errorResponse);
    return;
  }

  if (!voiceResult.name.startsWith(TTS_VOICE_NAME_PREFIX)) {
    sendError(res, ErrorResponses.notFound('Tzurot-cloned voice'));
    return;
  }

  const deleteResponse = await deleteVoiceAtProvider(audioProvider, apiKey, voiceId);

  if (!deleteResponse.ok) {
    logger.error(
      {
        discordUserId,
        provider: audioProvider,
        voiceId,
        status: deleteResponse.status,
        statusText: deleteResponse.statusText,
      },
      'Failed to delete voice from provider'
    );
    sendError(res, ErrorResponses.internalError('Failed to delete voice'));
    return;
  }

  logger.info(
    { discordUserId, provider: audioProvider, voiceId, voiceName: voiceResult.name },
    'Deleted voice'
  );

  sendCustomSuccess(res, {
    deleted: true,
    provider: audioProvider,
    voiceId,
    name: voiceResult.name,
    slug: voiceResult.name.slice(TTS_VOICE_NAME_PREFIX.length),
  });
}

/**
 * POST /clear — delete ALL tzurot-prefixed voices across all configured providers.
 *
 * Always returns 200 OK, even on partial failure. Callers must inspect the
 * response body: `{ deleted, total, errors? }`. When `errors` is present,
 * some deletions failed but others succeeded.
 */
async function clearVoicesImpl(
  prisma: PrismaClient,
  req: AuthenticatedRequest,
  res: ExpressResponse
): Promise<void> {
  const discordUserId = req.userId;

  const keysResult = await resolveAudioProviderKeys(prisma, discordUserId);
  if ('errorResponse' in keysResult) {
    sendError(res, keysResult.errorResponse);
    return;
  }

  if (keysResult.keys.size === 0) {
    sendError(
      res,
      ErrorResponses.notFound(
        'audio provider API key. Set one with /settings apikey set (ElevenLabs or Mistral)'
      )
    );
    return;
  }

  const { voices } = await fetchAllTzurotVoices(keysResult.keys);

  if (voices.length === 0) {
    sendCustomSuccess(res, { deleted: 0, total: 0, message: 'No Tzurot voices to clear' });
    return;
  }

  // Delete in small batches to balance speed vs provider rate limits.
  // Bot-client uses GATEWAY_TIMEOUTS.BULK_OPERATION (30s) for this call;
  // gateway timeout would abort but deletions continue server-side.
  let deleted = 0;
  let alreadyGone = 0;
  const errors: string[] = [];

  for (let i = 0; i < voices.length; i += DELETE_BATCH_SIZE) {
    const batch = voices.slice(i, i + DELETE_BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async voice => {
        const apiKey = keysResult.keys.get(voice.provider);
        if (apiKey === undefined) {
          // Defensive: voice came from fetchAllTzurotVoices, so its provider had a key.
          // If it disappeared mid-clear, fail loudly with a meaningful message.
          throw new Error(`${voice.name}: ${voice.provider} key disappeared mid-clear`);
        }
        const response = await deleteVoiceAtProvider(voice.provider, apiKey, voice.voiceId);
        if (response.status === 404) {
          // Already absent at the provider (deleted concurrently, or a stale
          // listing entry). The purge goal for this voice is met — reporting
          // it as a failure just alarms the user about a voice that's gone.
          alreadyGone++;
          return;
        }
        if (!response.ok) {
          // Surface actionable messages — "429" alone is meaningless to end users.
          // voice.name is safe to embed: it's tzurot-prefix-filtered (no user-controlled
          // injection risk).
          const detail =
            response.status === 429
              ? `${voice.name} (${voice.provider}): rate limited — try again shortly`
              : `${voice.name} (${voice.provider}): ${response.status}`;
          throw new Error(detail);
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
    { discordUserId, deleted, alreadyGone, total: voices.length, errors: errors.length },
    'Cleared cloned voices across providers'
  );

  sendCustomSuccess(res, {
    deleted,
    total: voices.length,
    errors: errors.length > 0 ? errors : undefined,
  });
}

// ===== Handler factories ===================================================

/** GET /api/user/voices — list cloned voices across configured providers */
export const handleListVoices = (deps: RouteDeps): RequestHandler => {
  const { prisma } = deps;
  return asyncHandler(async (req: AuthenticatedRequest, res: ExpressResponse) => {
    await listVoicesImpl(prisma, req, res);
  });
};

/** GET /api/user/voices/models — list available voice models per provider */
export const handleListVoiceModels = (deps: RouteDeps): RequestHandler => {
  const { prisma } = deps;
  return asyncHandler(async (req: AuthenticatedRequest, res: ExpressResponse) => {
    await listModelsImpl(prisma, req, res);
  });
};

/** POST /api/user/voices/clear — delete all tzurot-prefixed voices */
export const handleClearVoices = (deps: RouteDeps): RequestHandler => {
  const { prisma } = deps;
  return asyncHandler(async (req: AuthenticatedRequest, res: ExpressResponse) => {
    await clearVoicesImpl(prisma, req, res);
  });
};

/** DELETE /api/user/voices/:provider/:voiceId — delete a single voice */
export const handleDeleteVoice = (deps: RouteDeps): RequestHandler => {
  const { prisma } = deps;
  return asyncHandler(async (req: AuthenticatedRequest, res: ExpressResponse) => {
    await deleteVoiceImpl(prisma, req, res);
  });
};

// ===== Router setup ========================================================

export function createVoicesRoutes(deps: RouteDeps): Router {
  const router = Router();
  const requireProvisioned = requireProvisionedUser(deps.prisma);

  router.get('/', requireUserAuth(), requireProvisioned, handleListVoices(deps));
  // Register /models and /clear before /:provider/:voiceId so the wildcard doesn't shadow them
  router.get('/models', requireUserAuth(), requireProvisioned, handleListVoiceModels(deps));
  router.post('/clear', requireUserAuth(), requireProvisioned, handleClearVoices(deps));
  router.delete(
    '/:provider/:voiceId',
    requireUserAuth(),
    requireProvisioned,
    handleDeleteVoice(deps)
  );

  return router;
}
