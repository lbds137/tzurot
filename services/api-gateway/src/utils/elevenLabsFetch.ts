/**
 * ElevenLabs Fetch Helper
 *
 * Shared utility for fetching from the ElevenLabs API with consistent
 * auth error handling and Zod response validation. Eliminates duplication
 * between voice and model routes.
 */

import { z } from 'zod';
import { createLogger, VALIDATION_TIMEOUTS, AI_ENDPOINTS } from '@tzurot/common-types';
import type { ErrorResponse } from './errorResponses.js';
import { ErrorResponses } from './errorResponses.js';

const logger = createLogger('ElevenLabsFetch');

interface ElevenLabsFetchOptions<T extends z.ZodType> {
  /** API path appended to ELEVENLABS_BASE_URL, e.g. '/voices' or '/models' */
  endpoint: string;
  /** Decrypted ElevenLabs API key */
  apiKey: string;
  /** Zod schema to validate the JSON response */
  schema: T;
  /** Human-readable resource name for error messages and log prefix, e.g. 'voices' or 'models' */
  resourceName: string;
}

/**
 * Fetch from the ElevenLabs API with auth error handling and Zod validation.
 *
 * On success, returns `{ data }` with the Zod-parsed response.
 * On failure (auth, server error, parse error), returns `{ errorResponse }`
 * for the caller to forward via `sendError()`.
 */
export async function fetchFromElevenLabs<T extends z.ZodType>(
  options: ElevenLabsFetchOptions<T>
): Promise<{ data: z.infer<T> } | { errorResponse: ErrorResponse }> {
  const { endpoint, apiKey, schema, resourceName } = options;
  const prefix = `[${resourceName.charAt(0).toUpperCase()}${resourceName.slice(1)}]`;

  let response: globalThis.Response;
  try {
    response = await fetch(`${AI_ENDPOINTS.ELEVENLABS_BASE_URL}${endpoint}`, {
      headers: { 'xi-api-key': apiKey },
      signal: AbortSignal.timeout(VALIDATION_TIMEOUTS.ELEVENLABS_API_CALL),
    });
  } catch (error) {
    logger.error({ err: error }, `${prefix} Network error calling ElevenLabs`);
    return {
      errorResponse: ErrorResponses.internalError(
        `Failed to fetch ${resourceName} from ElevenLabs`
      ),
    };
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      logger.warn({ status: response.status }, `${prefix} ElevenLabs rejected API key`);
      return {
        errorResponse: ErrorResponses.unauthorized(
          'ElevenLabs API key is invalid or expired. Update it with /settings apikey set'
        ),
      };
    }
    logger.error(
      { status: response.status, statusText: response.statusText },
      `${prefix} ElevenLabs API error`
    );
    return {
      errorResponse: ErrorResponses.internalError(
        `Failed to fetch ${resourceName} from ElevenLabs`
      ),
    };
  }

  const parseResult = schema.safeParse(await response.json());
  if (!parseResult.success) {
    logger.error(
      { errors: parseResult.error.format() },
      `${prefix} Unexpected response format from ElevenLabs`
    );
    return {
      errorResponse: ErrorResponses.internalError('Unexpected response from ElevenLabs API'),
    };
  }

  return { data: parseResult.data };
}
