/**
 * Mistral Voices Client (api-gateway side)
 *
 * Stateless HTTP helpers for Mistral's `/v1/audio/voices` endpoints,
 * shaped for the api-gateway's `/user/voices` route family.
 *
 * Parallels the ai-worker's `MistralTtsClient.ts` but doesn't import from
 * it — services don't share runtime code (per `.claude/rules/01-architecture.md`).
 * The duplication is small (~60 LOC for list + delete + parse), and the
 * two consumers have different concerns: ai-worker needs the synthesis
 * path (TTS, clone, list-by-name); api-gateway only needs voice management
 * (list-all-tzurot-prefixed, delete-by-id).
 */

import { z } from 'zod';
import { AI_ENDPOINTS } from '@tzurot/common-types/constants/ai';
import { VALIDATION_TIMEOUTS } from '@tzurot/common-types/constants/timing';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { type ErrorResponse, ErrorResponses } from './errorResponses.js';

const logger = createLogger('MistralVoicesClient');

const MISTRAL_VOICES_PAGE_SIZE = 50;
const MISTRAL_VOICES_MAX_PAGES = 20;

const MistralVoiceSchema = z.object({
  id: z.string(),
  name: z.string(),
  user_id: z.string().nullable().optional(),
});

const MistralVoicesPageSchema = z.object({
  items: z.array(MistralVoiceSchema),
  total_pages: z.number().optional(),
});

export interface MistralCloned {
  voiceId: string;
  name: string;
}

/**
 * List all tzurot-prefixed voices in the user's Mistral account, walking
 * pagination. Mirrors the ai-worker's `mistralListVoices` shape but filters
 * by name prefix in api-gateway since that's what the route consumer needs.
 */
export async function listMistralTzurotVoices(
  apiKey: string,
  prefix: string
): Promise<{ voices: MistralCloned[]; totalVoices: number } | { errorResponse: ErrorResponse }> {
  const all: { voiceId: string; name: string }[] = [];
  let totalVoices = 0;
  let page = 1;

  while (page <= MISTRAL_VOICES_MAX_PAGES) {
    const response = await fetch(
      `${AI_ENDPOINTS.MISTRAL_BASE_URL}/audio/voices?page=${page}&page_size=${MISTRAL_VOICES_PAGE_SIZE}`,
      {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(VALIDATION_TIMEOUTS.EXTERNAL_AUDIO_API_CALL),
      }
    );

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        logger.warn({ status: response.status }, 'Mistral rejected API key');
        return {
          errorResponse: ErrorResponses.unauthorized(
            'Mistral API key is invalid or expired. Update it with /settings apikey set'
          ),
        };
      }
      logger.error(
        { status: response.status, statusText: response.statusText },
        'Mistral API error listing voices'
      );
      return {
        errorResponse: ErrorResponses.internalError('Failed to list voices from Mistral'),
      };
    }

    const parseResult = MistralVoicesPageSchema.safeParse(await response.json());
    if (!parseResult.success) {
      logger.error(
        { errors: parseResult.error.format() },
        'Unexpected Mistral voices list response format'
      );
      return {
        errorResponse: ErrorResponses.internalError('Unexpected voices response from Mistral'),
      };
    }

    const { items, total_pages } = parseResult.data;
    totalVoices += items.length;
    for (const item of items) {
      if (item.name.startsWith(prefix)) {
        all.push({ voiceId: item.id, name: item.name });
      }
    }

    const pages = total_pages ?? 1;
    if (page >= pages) {
      return { voices: all, totalVoices };
    }
    page++;
  }

  logger.warn(
    { maxPages: MISTRAL_VOICES_MAX_PAGES, returnedCount: all.length },
    'Mistral voice list pagination cap reached'
  );
  return { voices: all, totalVoices };
}

/**
 * Fetch a single Mistral voice by id. Used for IDOR-style verification
 * before delete: we ensure the voice exists AND has the tzurot- prefix
 * before authorizing the destructive op.
 */
export async function getMistralVoice(
  apiKey: string,
  voiceId: string
): Promise<{ voice: MistralCloned } | { errorResponse: ErrorResponse }> {
  const response = await fetch(
    `${AI_ENDPOINTS.MISTRAL_BASE_URL}/audio/voices/${encodeURIComponent(voiceId)}`,
    {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(VALIDATION_TIMEOUTS.EXTERNAL_AUDIO_API_CALL),
    }
  );

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      return {
        errorResponse: ErrorResponses.unauthorized(
          'Mistral API key is invalid or expired. Update it with /settings apikey set'
        ),
      };
    }
    if (response.status === 404) {
      return { errorResponse: ErrorResponses.notFound('Voice') };
    }
    logger.error(
      { status: response.status, statusText: response.statusText, voiceId },
      'Mistral API error fetching voice'
    );
    return {
      errorResponse: ErrorResponses.internalError('Failed to fetch voice from Mistral'),
    };
  }

  const parseResult = MistralVoiceSchema.safeParse(await response.json());
  if (!parseResult.success) {
    logger.error(
      { errors: parseResult.error.format(), voiceId },
      'Unexpected Mistral voice response format'
    );
    return {
      errorResponse: ErrorResponses.internalError('Unexpected voice response from Mistral'),
    };
  }
  return { voice: { voiceId: parseResult.data.id, name: parseResult.data.name } };
}

/** Delete a single Mistral voice by id. Returns the raw fetch Response so the
 *  caller can inspect status (200 / 404 / 429 / etc.) for batch error reporting. */
export async function deleteMistralVoice(
  apiKey: string,
  voiceId: string
): Promise<globalThis.Response> {
  return fetch(`${AI_ENDPOINTS.MISTRAL_BASE_URL}/audio/voices/${encodeURIComponent(voiceId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(VALIDATION_TIMEOUTS.EXTERNAL_AUDIO_API_CALL),
  });
}
