/**
 * ElevenLabs API key validation.
 *
 * Uses `GET /v1/user` to check key validity AND character-quota status.
 * Distinguishes truly invalid keys from valid-but-scoped keys with
 * insufficient permissions (which surface as 401 with a distinctive
 * `detail.status === 'missing_permissions'` body).
 *
 * Validation runs at the api-gateway layer on key submission (user-facing
 * flow). Runtime health checks happen implicitly when the worker calls
 * the provider during job execution — bad keys surface as job failures
 * with provider error details there.
 */

import { AI_ENDPOINTS } from '@tzurot/common-types/constants/ai';
import { VALIDATION_TIMEOUTS } from '@tzurot/common-types/constants/timing';
import { VALIDATION_MESSAGES, type ApiKeyValidationResult } from './types.js';

/** Permissions Tzurot needs from a scoped ElevenLabs key. */
const ELEVENLABS_REQUIRED_PERMISSIONS = [
  'Text to Speech (Access)',
  'Speech to Text (Access)',
  'Voices (Write)',
  'Models (Access)',
  'User (Read)',
];

/**
 * Parse a 401 response body to detect the scoped-key permissions case.
 * Returns a user-friendly error string, or null if the 401 is from a
 * truly invalid key (caller falls through to INVALID_KEY).
 */
async function parseElevenLabsPermissionError(response: Response): Promise<string | null> {
  try {
    const body = (await response.json()) as {
      detail?: { status?: string; message?: string };
    };

    if (body.detail?.status === 'missing_permissions') {
      const required = ELEVENLABS_REQUIRED_PERMISSIONS.map(p => `• ${p}`).join('\n');
      return (
        'Your ElevenLabs API key is valid but missing required permissions. ' +
        'If using a restricted key, enable these permissions in your ElevenLabs dashboard:\n' +
        required
      );
    }
  } catch {
    // Response body not JSON or malformed — fall through to INVALID_KEY
  }

  return null;
}

export async function validateElevenLabsKey(apiKey: string): Promise<ApiKeyValidationResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), VALIDATION_TIMEOUTS.API_KEY_VALIDATION);

  try {
    const response = await fetch(`${AI_ENDPOINTS.ELEVENLABS_BASE_URL}/user`, {
      method: 'GET',
      headers: {
        'xi-api-key': apiKey,
      },
      signal: controller.signal,
    });

    if (response.status === 401 || response.status === 403) {
      const permError = await parseElevenLabsPermissionError(response);
      if (permError !== null) {
        return { valid: false, errorCode: 'MISSING_PERMISSIONS', error: permError };
      }
      return { valid: false, errorCode: 'INVALID_KEY', error: VALIDATION_MESSAGES.INVALID_KEY };
    }

    if (!response.ok) {
      return { valid: false, errorCode: 'UNKNOWN', error: `HTTP ${response.status}` };
    }

    const data = (await response.json()) as {
      subscription?: {
        character_count?: number;
        character_limit?: number;
      };
    };

    const used = data.subscription?.character_count;
    const limit = data.subscription?.character_limit;

    if (typeof used === 'number' && typeof limit === 'number' && used >= limit) {
      return {
        valid: false,
        errorCode: 'QUOTA_EXCEEDED',
        error: 'ElevenLabs character quota exhausted',
        credits: limit - used,
      };
    }

    const remaining =
      typeof used === 'number' && typeof limit === 'number' ? limit - used : undefined;

    return { valid: true, credits: remaining };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { valid: false, errorCode: 'TIMEOUT', error: VALIDATION_MESSAGES.TIMEOUT };
    }

    return {
      valid: false,
      errorCode: 'UNKNOWN',
      error: error instanceof Error ? error.message : VALIDATION_MESSAGES.FALLBACK,
    };
  } finally {
    clearTimeout(timeout);
  }
}
