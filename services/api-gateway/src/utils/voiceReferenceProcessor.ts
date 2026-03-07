/**
 * Voice Reference Audio Processor
 *
 * Validates and decodes base64 voice reference audio for personality voice cloning.
 * Unlike avatars, voice references are stored as-is (no optimization/resizing).
 */

import { createLogger, VOICE_REFERENCE_LIMITS } from '@tzurot/common-types';
import { ErrorResponses, type ErrorResponse } from './errorResponses.js';

const logger = createLogger('voiceReferenceProcessor');

/** Successful processing result */
export interface VoiceReferenceSuccess {
  ok: true;
  buffer: Buffer;
  mimeType: string;
}

/** Processing failure result */
export interface VoiceReferenceError {
  ok: false;
  error: ErrorResponse;
}

/**
 * Extract MIME type from a base64 data URI.
 * Supports: `data:audio/wav;base64,AAAA...` format.
 *
 * @returns The MIME type string or null if not a valid data URI.
 */
function extractMimeType(dataUri: string): string | null {
  const match = /^data:([^;]+);base64,/.exec(dataUri);
  return match !== null ? match[1] : null;
}

/**
 * Process voice reference audio data.
 *
 * @param voiceReferenceData - Base64 data URI of the audio file
 * @param slug - Personality slug, used only for log context
 * @returns `null` if no data provided, `{ ok: true, buffer, mimeType }` on success,
 *          or `{ ok: false, error }` on validation failure.
 */
export function processVoiceReferenceData(
  voiceReferenceData: string | undefined,
  slug: string
): VoiceReferenceSuccess | VoiceReferenceError | null {
  if (voiceReferenceData === undefined || voiceReferenceData.length === 0) {
    return null;
  }

  try {
    // Extract MIME type from data URI
    const mimeType = extractMimeType(voiceReferenceData);
    if (mimeType === null) {
      return {
        ok: false,
        error: ErrorResponses.validationError(
          'Voice reference must be a base64 data URI (e.g., data:audio/wav;base64,...)'
        ),
      };
    }

    // Validate MIME type
    if (!VOICE_REFERENCE_LIMITS.ALLOWED_TYPES.includes(mimeType)) {
      return {
        ok: false,
        error: ErrorResponses.validationError(
          `Unsupported audio type: ${mimeType}. Allowed: ${VOICE_REFERENCE_LIMITS.ALLOWED_TYPES.join(', ')}`
        ),
      };
    }

    // Use indexOf for the payload split — the prefix is short (~20 chars)
    // so the comma is found immediately without scanning the full multi-MB string.
    const commaIndex = voiceReferenceData.indexOf(',');
    const base64Data = voiceReferenceData.substring(commaIndex + 1);
    const buffer = Buffer.from(base64Data, 'base64');

    // Validate size
    if (buffer.length > VOICE_REFERENCE_LIMITS.MAX_SIZE) {
      const sizeMB = (buffer.length / (1024 * 1024)).toFixed(1);
      const maxMB = (VOICE_REFERENCE_LIMITS.MAX_SIZE / (1024 * 1024)).toFixed(0);
      return {
        ok: false,
        error: ErrorResponses.validationError(
          `Voice reference too large (${sizeMB}MB). Maximum: ${maxMB}MB`
        ),
      };
    }

    logger.info(
      { slug, mimeType, sizeKB: Math.round(buffer.length / 1024) },
      'Voice reference processed'
    );

    return { ok: true, buffer, mimeType };
  } catch (error) {
    logger.error({ err: error, slug }, 'Failed to process voice reference');
    return {
      ok: false,
      error: ErrorResponses.processingError(
        'Failed to process voice reference audio. Ensure it is a valid audio file.'
      ),
    };
  }
}
