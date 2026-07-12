/**
 * Vision-description validity checking.
 *
 * Some vision models return an error message AS text content instead of
 * failing the HTTP call — "I cannot access the image URL…" arrives looking
 * like a description. Without this filter such error text would be cached as
 * a "valid" description, permanently blocking retries for that attachment.
 * Used both when storing new descriptions and when reading cached ones
 * (a previously-cached error-shaped entry gets a fresh attempt).
 *
 * Extracted from VisionProcessor.ts (max-lines) — also gives the pattern
 * list its own direct tests. Also home to the Redis-backed validated cache
 * read (`readValidCachedDescription`), which applies the validity rule to
 * cached entries — the module is validity-centric, no longer purely pure.
 */

import { createLogger } from '@tzurot/common-types/utils/logger';
import { visionDescriptionCache } from '../../redis.js';

const logger = createLogger('VisionDescriptionValidity');

/** Below this length a "description" carries no usable signal. */
export const VISION_MIN_DESCRIPTION_LENGTH = 10;

/**
 * The canonical prefix of a failure-placeholder "description" ('[Image ...').
 * Shared contract between the placeholder renderer (buildFailureFallback),
 * the validity check below, and ImageDescriptionJob's failure counting —
 * one constant instead of three independent literals.
 */
export const VISION_PLACEHOLDER_PREFIX = '[Image';

/**
 * Patterns that indicate a vision model returned an error message as text
 * content rather than an actual image description.
 */
const ERROR_DESCRIPTION_PATTERNS = [
  'cannot access',
  'unable to access',
  'unable to view',
  'unable to process',
  'not accessible',
  'cannot be accessed',
  'cannot view',
  'cannot process',
  'cannot see the image',
  'cannot see this image',
  'failed to load',
  'error loading',
  'url has expired',
  'url is expired',
  'url is invalid',
  'image is not available',
  'image is unavailable',
  // Anchored to provider-error phrasings — the bare substrings 'image url' /
  // 'provided url' also appear in LEGITIMATE descriptions ("The image URL shown
  // in this banner…"), which would get mis-classified and negative-cached.
  'fetch the image url',
  'access the image url',
  'load the image url',
  'access the provided url',
  'fetch the provided url',
];

/** Check if a description looks like an error message from the vision model. */
export function isLikelyErrorDescription(description: string): boolean {
  const lower = description.toLowerCase();
  return ERROR_DESCRIPTION_PATTERNS.some(pattern => lower.includes(pattern));
}

/**
 * Validate that a vision description is a genuine image description, not an
 * error message (error-shaped text must never enter the positive cache).
 */
export function isValidVisionDescription(description: string): boolean {
  const trimmed = description.trim();
  return (
    trimmed.length >= VISION_MIN_DESCRIPTION_LENGTH &&
    !trimmed.startsWith(VISION_PLACEHOLDER_PREFIX) &&
    !isLikelyErrorDescription(trimmed)
  );
}

/**
 * Read the canonical cached description, filtering QUALITY failures: some
 * models cache error text ("I cannot access the image URL") that parses as a
 * description but isn't useful — an invalid entry reads as a miss so the
 * caller re-processes with a fresh attempt.
 */
export async function readValidCachedDescription(
  cacheKeyOptions: { attachmentId?: string; url: string; model?: string },
  attachment: { id?: string; name?: string | null }
): Promise<string | null> {
  const cachedDescription = await visionDescriptionCache.get(cacheKeyOptions);
  if (cachedDescription === null) {
    return null;
  }
  if (isValidVisionDescription(cachedDescription)) {
    logger.debug(
      { attachmentName: attachment.name, attachmentId: attachment.id },
      'Using cached vision description - avoiding duplicate API call'
    );
    return cachedDescription;
  }
  logger.warn(
    {
      attachmentId: attachment.id,
      cachedLength: cachedDescription.length,
      preview: cachedDescription.substring(0, 80),
    },
    'Cached vision description appears invalid — re-processing image'
  );
  return null;
}
