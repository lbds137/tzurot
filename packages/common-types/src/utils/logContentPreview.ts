/**
 * The single gate every log site must pass user-authored content through so
 * deployed logs carry no message / persona / LLM-response /
 * vision-description text by default. Lengths and digests stay always-on;
 * only the raw-text preview is gated behind `LOG_CONTENT_PREVIEWS`, and only
 * in development — see `contentPreviewsEnabled`.
 */

import { createHash } from 'node:crypto';
import { getConfig } from '../config/config.js';
import { truncateByCodePoints } from './codePointTruncation.js';

/**
 * Whether raw-text content previews are allowed in this process right now.
 * Requires BOTH a development `NODE_ENV` and the `LOG_CONTENT_PREVIEWS`
 * opt-in — a deployed environment is refused at boot by
 * `assertNoLocalOnlyFlagsDeployed` regardless of this check, but this
 * function is the runtime gate every call site consults directly. Reads
 * `getConfig()` fresh on every call so tests can drive it.
 *
 * Pinned by the `contentPreviewsEnabled` describe in `logContentPreview.test.ts`.
 */
export function contentPreviewsEnabled(): boolean {
  const config = getConfig();
  return config.NODE_ENV === 'development' && config.LOG_CONTENT_PREVIEWS === true;
}

/**
 * Returns a truncated preview of `text` when content previews are enabled,
 * or `undefined` otherwise (including when `text` itself is `undefined` or
 * `null`). Truncates to `maxChars` code points with a trailing `...` marker
 * when `text` is longer than that. Cutting on code points keeps an emoji or
 * other astral character whole, so a preview never carries a lone surrogate
 * into the log line; the marker rides beyond the cap rather than inside it.
 *
 * Always returns `undefined`, never `null`, when there is no preview to
 * show — pino serializes an explicit `null` into the log line but omits an
 * `undefined` field entirely, so only `undefined` makes the field vanish.
 * Pinned by the `contentPreview` describe in `logContentPreview.test.ts`.
 */
export function contentPreview(
  text: string | undefined | null,
  maxChars: number
): string | undefined {
  if (text === undefined || text === null) {
    return undefined;
  }
  if (!contentPreviewsEnabled()) {
    return undefined;
  }
  return truncateByCodePoints(text, maxChars, '...');
}

/**
 * A short, always-on digest of `text` for equality/duplication diagnosis
 * without logging the content itself. Ignores `LOG_CONTENT_PREVIEWS` — this
 * is always safe to log, deployed or not.
 */
export function contentDigest(text: string): string {
  return createHash('sha256').update(text).digest('hex').substring(0, 12);
}
