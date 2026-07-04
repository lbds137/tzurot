/**
 * ElevenLabs Voices Client (api-gateway side)
 *
 * Stateless HTTP helpers for ElevenLabs' `/v1/voices` endpoints, shaped for
 * the api-gateway's `/user/voices` route family.
 *
 * Parallels `mistralVoicesClient.ts` so both providers expose the same
 * surface (list-tzurot-prefixed, get-by-id, delete-by-id) to the route
 * layer, which orchestrates them via an exhaustive switch on
 * `AudioProviderId`.
 */

import { z } from 'zod';
import { AI_ENDPOINTS, TTS_VOICE_NAME_PREFIX } from '@tzurot/common-types/constants/ai';
import { VALIDATION_TIMEOUTS } from '@tzurot/common-types/constants/timing';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { type ErrorResponse, ErrorResponses } from './errorResponses.js';
import { fetchFromElevenLabs } from './elevenLabsFetch.js';

const logger = createLogger('ElevenLabsVoicesClient');

const ElevenLabsVoiceSchema = z.object({
  voice_id: z.string(),
  name: z.string(),
  category: z.string().optional(),
});

const ElevenLabsVoicesResponseSchema = z.object({
  voices: z.array(ElevenLabsVoiceSchema),
});

export type ElevenLabsVoice = z.infer<typeof ElevenLabsVoiceSchema>;

/** List all tzurot-prefixed cloned voices in the user's ElevenLabs account.
 *  Filters by name prefix in api-gateway since that's the route's concern. */
export async function listElevenLabsTzurotVoices(
  apiKey: string
): Promise<{ voices: ElevenLabsVoice[]; totalVoices: number } | { errorResponse: ErrorResponse }> {
  const result = await fetchFromElevenLabs({
    endpoint: '/voices',
    apiKey,
    schema: ElevenLabsVoicesResponseSchema,
    resourceName: 'voices',
  });

  if ('errorResponse' in result) {
    return result;
  }

  const allVoices = result.data.voices;
  const tzurotVoices = allVoices.filter(v => v.name.startsWith(TTS_VOICE_NAME_PREFIX));
  return { voices: tzurotVoices, totalVoices: allVoices.length };
}

/** Fetch a single ElevenLabs voice by id. Used for IDOR-style verification
 *  before delete: ensure the voice exists AND has the tzurot- prefix before
 *  authorizing the destructive op. */
export async function getElevenLabsVoice(
  apiKey: string,
  voiceId: string
): Promise<{ voice: ElevenLabsVoice } | { errorResponse: ErrorResponse }> {
  const response = await fetch(
    `${AI_ENDPOINTS.ELEVENLABS_BASE_URL}/voices/${encodeURIComponent(voiceId)}`,
    {
      headers: { 'xi-api-key': apiKey },
      signal: AbortSignal.timeout(VALIDATION_TIMEOUTS.EXTERNAL_AUDIO_API_CALL),
    }
  );

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      logger.warn({ status: response.status }, 'ElevenLabs rejected API key');
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
      'ElevenLabs API error fetching voice'
    );
    return {
      errorResponse: ErrorResponses.internalError('Failed to fetch voice from ElevenLabs'),
    };
  }

  const parseResult = ElevenLabsVoiceSchema.safeParse(await response.json());
  if (!parseResult.success) {
    logger.error(
      { errors: parseResult.error.format(), voiceId },
      'Unexpected voice response format from ElevenLabs'
    );
    return {
      errorResponse: ErrorResponses.internalError('Unexpected voice response from ElevenLabs'),
    };
  }
  return { voice: parseResult.data };
}

/** Delete a single ElevenLabs voice by id. Returns the raw fetch Response so
 *  the caller can inspect status (200 / 404 / 429 / etc.) for batch error
 *  reporting. Mirrors `deleteMistralVoice`. */
export async function deleteElevenLabsVoice(
  apiKey: string,
  voiceId: string
): Promise<globalThis.Response> {
  return fetch(`${AI_ENDPOINTS.ELEVENLABS_BASE_URL}/voices/${encodeURIComponent(voiceId)}`, {
    method: 'DELETE',
    headers: { 'xi-api-key': apiKey },
    signal: AbortSignal.timeout(VALIDATION_TIMEOUTS.EXTERNAL_AUDIO_API_CALL),
  });
}
