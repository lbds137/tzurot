/**
 * Feedback content normalization + hashing.
 *
 * The intake dedupe gate compares a sha-256 of NORMALIZED content against the
 * user's recent rows, so trivial variants (case, extra whitespace) of the
 * same complaint don't slip past as "new" feedback. One shared implementation
 * so the gateway writer and any test factory can never drift.
 */

import { createHash } from 'node:crypto';

/** Lowercase, collapse all whitespace runs to single spaces, trim. */
export function normalizeFeedbackContent(content: string): string {
  return content.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Full 64-hex sha-256 of the normalized content — matches the
 * user_feedback.content_hash VarChar(64) column exactly (the repo's other
 * sha-256 helpers all truncate; this one must not).
 */
export function hashFeedbackContent(content: string): string {
  return createHash('sha256').update(normalizeFeedbackContent(content)).digest('hex');
}
