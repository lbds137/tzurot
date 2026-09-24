/**
 * Feedback content normalization + hashing.
 *
 * The intake dedupe gate compares a sha-256 of NORMALIZED content against the
 * user's recent rows, so trivial variants (case, extra whitespace) of the
 * same complaint don't slip past as "new" feedback. One shared implementation
 * so the gateway writer and any test factory can never drift.
 */

import { sha256Hex } from './sha256Hex.js';

/** Lowercase, collapse all whitespace runs to single spaces, trim. */
export function normalizeFeedbackContent(content: string): string {
  return content.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Full 64-hex sha-256 of the normalized content — matches the
 * user_feedback.content_hash VarChar(64) column exactly.
 */
export function hashFeedbackContent(content: string): string {
  return sha256Hex(normalizeFeedbackContent(content));
}
