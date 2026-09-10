/**
 * The single gate every log site must pass user-authored content through so
 * deployed logs carry no message / persona / LLM-response /
 * vision-description text by default. Lengths and digests stay always-on;
 * only the raw-text preview is gated behind `LOG_CONTENT_PREVIEWS`, and only
 * in development — see `contentPreviewsEnabled`. This module also holds the
 * two non-content prefix helpers (`idPrefix`, `urlPrefix`) — the
 * `@tzurot/no-raw-log-content` lint rule makes this module the sanctioned
 * route for a truncated value into a log field.
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

/**
 * The first `n` characters of an identifier or opaque token (a persona UUID,
 * an action token) — enough to correlate log lines without logging the whole
 * value. NOT a content gate: pass only values that carry no user-authored
 * text; the name records that intent at the call site. Pinned by the
 * `idPrefix` describe in `logContentPreview.test.ts`.
 */
export function idPrefix(id: string, n = 8): string {
  return id.substring(0, n);
}

/**
 * The first `n` characters of a URL, so a cache or attachment log line can be
 * correlated with its source without logging the full URL. NOT a content
 * gate. Pinned by the `urlPrefix` describe in `logContentPreview.test.ts`.
 */
export function urlPrefix(url: string, n: number): string {
  return url.substring(0, n);
}
