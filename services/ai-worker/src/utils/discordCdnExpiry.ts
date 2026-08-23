/**
 * Discord CDN URL expiry detection.
 *
 * Discord CDN signed URLs carry an `ex` query parameter (a hex timestamp)
 * marking when the signature expires. Reading it lets callers skip a fetch —
 * and, upstream of that, a billed vision-provider call — that cannot possibly
 * succeed against an already-expired signature.
 *
 * Discord's reference docs name the `ex`/`is`/`hm` params; as far as the
 * attachments page read at authoring time goes, the unit of `ex` (seconds vs
 * milliseconds) is not stated. This module disambiguates by checking which
 * plausible-epoch range the decoded value falls into (see the bound constants
 * below). Every case this module cannot confidently classify — not a Discord
 * CDN URL, no `ex` param, a hex value outside both plausible ranges — FAILS
 * OPEN (treated as not-expired), so a future URL-format change can only cost
 * us today's already-known fallback behavior; it can never cause a live URL
 * to be misclassified as dead.
 */

import { ALLOWED_HOSTS } from './attachmentFetch.js';

/** Grace period before a parsed expiry is trusted as past. Guards against local clock skew. */
export const CDN_EXPIRY_SKEW_MS = 5 * 60 * 1000;

// Roughly mid-2017 through the end of 2099, expressed as epoch SECONDS.
const EPOCH_SECONDS_MIN = 1_500_000_000;
const EPOCH_SECONDS_MAX = 4_100_000_000;

// The same rough 2017-2099 span, expressed as epoch MILLISECONDS.
const EPOCH_MS_MIN = 1_500_000_000_000;
const EPOCH_MS_MAX = 4_100_000_000_000;

const HEX_EX_PATTERN = /^[0-9a-f]{1,16}$/i;

export type DiscordCdnExpiry =
  | { known: true; expiresAtMs: number }
  | { known: false; reason: 'not-discord-cdn' | 'no-ex-param' | 'unparseable-ex' };

const UNPARSEABLE_EX: DiscordCdnExpiry = { known: false, reason: 'unparseable-ex' };

/**
 * True when `url` is an `https://` URL on the Discord CDN allowlist.
 * Exact hostname comparison only — never a substring/prefix check on the raw
 * URL string (CodeQL `js/incomplete-url-substring-sanitization`).
 */
export function isDiscordCdnUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  // Same trailing-root-dot normalization as validateAttachmentUrl — a DNS
  // absolute form like `cdn.discordapp.com.` routes through the CDN fetch
  // path, so the dead-URL check must recognize it as the same host.
  const hostname = parsed.hostname.replace(/\.{1,16}$/, '');
  return parsed.protocol === 'https:' && ALLOWED_HOSTS.includes(hostname);
}

/**
 * Read and classify the `ex` expiry param off a Discord CDN URL.
 * Returns `known: false` for anything this module cannot confidently
 * classify — see the module doc comment for the fail-open rationale.
 */
export function readDiscordCdnExpiry(url: string): DiscordCdnExpiry {
  if (!isDiscordCdnUrl(url)) {
    return { known: false, reason: 'not-discord-cdn' };
  }

  // isDiscordCdnUrl already proved `url` parses; re-parsing here is cheaper
  // than threading the parsed URL through, and just as safe.
  const parsed = new URL(url);
  const raw = parsed.searchParams.get('ex');
  if (raw === null || raw.length === 0) {
    return { known: false, reason: 'no-ex-param' };
  }

  if (!HEX_EX_PATTERN.test(raw)) {
    return UNPARSEABLE_EX;
  }

  const value = Number.parseInt(raw, 16);
  if (!Number.isSafeInteger(value)) {
    return UNPARSEABLE_EX;
  }

  if (value >= EPOCH_SECONDS_MIN && value <= EPOCH_SECONDS_MAX) {
    return { known: true, expiresAtMs: value * 1000 };
  }
  if (value >= EPOCH_MS_MIN && value <= EPOCH_MS_MAX) {
    return { known: true, expiresAtMs: value };
  }
  return UNPARSEABLE_EX;
}

/**
 * Thrown when a Discord CDN URL's signature has already expired.
 * Non-retryable: the signature will never become valid again for this URL —
 * a fresh URL (not currently obtainable in this service; see the module
 * consumers for why) would be required, not a retry of the same request.
 */
export class ExpiredCdnUrlError extends Error {
  readonly expiresAtMs: number;
  constructor(expiresAtMs: number) {
    super(`Discord CDN URL expired at ${new Date(expiresAtMs).toISOString()}`);
    this.name = 'ExpiredCdnUrlError';
    this.expiresAtMs = expiresAtMs;
  }
}

/**
 * Throws `ExpiredCdnUrlError` when `url` is a Discord CDN URL with a
 * confidently-parsed `ex` past its expiry plus `CDN_EXPIRY_SKEW_MS`;
 * otherwise returns without side effects — every `known: false` case
 * (including a non-Discord-CDN URL) is a no-op, fail open. This is the one
 * place the expiry boundary is computed.
 */
export function assertDiscordCdnUrlNotExpired(url: string, nowMs: number = Date.now()): void {
  const expiry = readDiscordCdnExpiry(url);
  if (expiry.known && nowMs > expiry.expiresAtMs + CDN_EXPIRY_SKEW_MS) {
    throw new ExpiredCdnUrlError(expiry.expiresAtMs);
  }
}
