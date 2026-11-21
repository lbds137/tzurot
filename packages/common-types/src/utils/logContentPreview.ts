/**
 * The single gate every log site must pass user-authored content through so
 * deployed logs carry no message / persona / LLM-response /
 * vision-description text by default. Lengths and digests stay always-on;
 * only the raw-text preview is gated behind `LOG_CONTENT_PREVIEWS`, and only
 * in development — see `contentPreviewsEnabled`. This module also holds the
 * non-content prefix helper (`idPrefix`) — the
 * `@tzurot/no-raw-log-content` lint rule makes this module the sanctioned
 * route for a truncated value into a log field. `filenameShape` is the
 * sanctioned route for a user-supplied filename (an attachment's `.name`):
 * a filename is content, so only its extension and length are safe to log.
 */

import { isIP } from 'node:net';
import { getConfig } from '../config/config.js';
import { sha256Hex } from './sha256Hex.js';
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
  return sha256Hex(text, { length: 12 });
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

/** What `attachmentUrlShape` returns for an input `new URL()` rejects; never any part of the input. */
const UNPARSABLE_URL_SHAPE = '[unparsable-url]';

/** The Discord hosts whose `/attachments/<channel>/<id>/<filename>` route carries ids worth logging. */
const DISCORD_ATTACHMENT_HOSTS = new Set(['cdn.discordapp.com', 'media.discordapp.net']);

/**
 * `/attachments/` or `/ephemeral-attachments/`, then `<channel id>/<attachment id>/<anything>`.
 * Only the three captures are ever used: the route name comes from this fixed
 * alternation, never from input text beyond it.
 */
const DISCORD_ATTACHMENT_PATH = /^\/(attachments|ephemeral-attachments)\/(\d+)\/(\d+)\/.+$/;

/** What `attachmentUrlShape` returns for an IP-literal host; never the address. */
const IP_HOST_SHAPE = '[ip-host]';

/**
 * Reduces an attachment URL to the only parts safe to log. A Discord CDN
 * attachment URL ends in the user-supplied filename
 * (`cdn.discordapp.com/attachments/<channel>/<id>/<filename>?ex=...`), so the
 * filename is user content and a plain truncation of the URL can still
 * carry it.
 *
 * - `cdn.discordapp.com` / `media.discordapp.net` with a
 *   `/attachments/<digits>/<digits>/<anything>` path returns
 *   `<host>/attachments/<channel>/<id>`, rebuilt from the captures alone, so
 *   nothing after them (filename, extra segments, query, fragment) can reach
 *   the output. `/ephemeral-attachments/<digits>/<digits>/<anything>` is
 *   handled the same way and keeps its route name. Unverified against a live
 *   URL: slash-command option uploads are believed to be served from the
 *   ephemeral route.
 * - An IPv4 or IPv6 literal host (with or without a port) returns the fixed
 *   token `[ip-host]`: an IP address is never-log data.
 * - Any other parsable URL with a host, including a Discord host off those
 *   routes, returns the host alone: an arbitrary path can carry user text.
 * - Input that `new URL()` rejects, and a hostless URL such as `data:`,
 *   returns the fixed token `[unparsable-url]`, never any part of the raw string.
 *
 * Returns `undefined` for `undefined`/`null` input, matching `filenameShape`
 * so pino omits the field entirely rather than logging a literal `null`.
 *
 * Pinned by the `attachmentUrlShape` describe in `logContentPreview.test.ts`.
 */
export function attachmentUrlShape(url: string | undefined | null): string | undefined {
  if (url === undefined || url === null) {
    return undefined;
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return UNPARSABLE_URL_SHAPE;
  }
  if (parsed.host === '') {
    return UNPARSABLE_URL_SHAPE;
  }
  // `.hostname` brackets an IPv6 literal; `isIP` wants it bare.
  if (isIP(parsed.hostname.replace(/^\[|\]$/g, '')) !== 0) {
    return IP_HOST_SHAPE;
  }
  if (DISCORD_ATTACHMENT_HOSTS.has(parsed.host)) {
    const match = DISCORD_ATTACHMENT_PATH.exec(parsed.pathname);
    if (match !== null) {
      return `${parsed.host}/${match[1]}/${match[2]}/${match[3]}`;
    }
  }
  return parsed.host;
}

/** The shape a filename reduces to when it's safe to log: extension and length only, never the stem. */
export interface FilenameShape {
  extension: string | undefined;
  nameLength: number;
}

/**
 * Reduces a user-supplied filename (an attachment's `.name`) to the only
 * parts safe to log: its extension and its length. A filename is
 * user-authored content — the stem can carry arbitrary text (`secret
 * diary.txt`) — so this never returns any part of the name itself.
 *
 * `nameLength` counts code points, not UTF-16 units, matching
 * `contentPreview`'s counting — an astral emoji in the filename counts as
 * one character, not two.
 *
 * Returns `undefined` for `undefined`/`null` input, matching `contentPreview`
 * so pino omits the field entirely rather than logging a literal `null`.
 *
 * The extension is the text after the LAST `.`, lowercased, and only when
 * all of the following hold: the last dot isn't at index 0 (a dotfile like
 * `.env` has no extension), the dot isn't the final character, the
 * candidate is 1-10 characters, and it matches `/^[a-z0-9]+$/` after
 * lowercasing. Otherwise `extension` is `undefined` — rejecting a long or
 * odd "extension" outright (rather than truncating it) is deliberate: a
 * truncated one would still leak up to 10 characters of user text (e.g.
 * `notes.my secret` truncating to `my secret`).
 *
 * Pinned by the `filenameShape` describe in `logContentPreview.test.ts`.
 */
export function filenameShape(name: string | undefined | null): FilenameShape | undefined {
  if (name === undefined || name === null) {
    return undefined;
  }
  const lastDot = name.lastIndexOf('.');
  let extension: string | undefined;
  if (lastDot > 0 && lastDot < name.length - 1) {
    const candidate = name.slice(lastDot + 1).toLowerCase();
    if (candidate.length >= 1 && candidate.length <= 10 && /^[a-z0-9]+$/.test(candidate)) {
      extension = candidate;
    }
  }
  return { extension, nameLength: [...name].length };
}
