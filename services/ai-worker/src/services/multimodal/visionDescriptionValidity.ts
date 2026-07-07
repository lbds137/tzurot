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
 * list its own direct tests.
 */

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
