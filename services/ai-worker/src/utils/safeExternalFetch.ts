/**
 * Safe External Image Fetcher
 *
 * Fallback path for embed images whose URL didn't pass the strict Discord-CDN
 * allowlist in `attachmentFetch.validateAttachmentUrl` — typically Reddit,
 * Imgur, Tenor, and other CDNs that surface in Discord embeds when the source
 * link wasn't proxied through `media.discordapp.net`.
 *
 * Security model:
 * - Surface URL checks (https only, no credentials, no non-standard ports,
 *   no IP literal as hostname) match `validateAttachmentUrl` MINUS the host
 *   allowlist.
 * - DNS lookup with `{ all: true }` resolves every IP for the hostname and
 *   refuses to proceed if any of them are private/internal/loopback. Closes
 *   the IPv4-public/IPv6-private family-mismatch bypass.
 * - The fetch itself adds a browser-shaped User-Agent (Reddit/Imgur 403
 *   non-browser UAs) and asserts `Content-Type` starts with `image/` BEFORE
 *   buffering the body (memory-exhaustion guard against text/HTML payloads).
 * - Existing `fetchAttachmentBytes` provides redirect:'error', AbortController
 *   timeout, Content-Length pre-check, and post-buffer size guard.
 *
 * Residual risk: TOCTOU window between `dns.promises.lookup` and the fetch's
 * own resolution. Mitigated by checking ALL IPs (so an IPv4/IPv6 family
 * mismatch can't slip through) but a custom undici Dispatcher with
 * `connect.lookup` is the proper closure — tracked in BACKLOG.
 */

import { promises as dns } from 'node:dns';
import { isIPv4, isIPv6 } from 'node:net';
import { createLogger } from '@tzurot/common-types';
import { fetchAttachmentBytes, type FetchAttachmentBytesOptions } from './attachmentFetch.js';

const logger = createLogger('safeExternalFetch');

/**
 * Browser-shaped User-Agent used on the external-image fallback path. Honest
 * about the source (`Tzurot/3.0`) but Mozilla-prefixed because many CDNs
 * (Reddit, Imgur, Cloudflare-fronted hosts) 403 anything that doesn't look
 * like a browser. If real-world deploy shows this is still 403'd at meaningful
 * rates, swap to a fully-impersonating UA — tracked in BACKLOG.
 */
export const EXTERNAL_FETCH_USER_AGENT =
  'Mozilla/5.0 (compatible; Tzurot/3.0; +https://github.com/lbds137/tzurot)';

/**
 * Validate an external (non-Discord-CDN) image URL.
 *
 * Same surface checks as `validateAttachmentUrl` minus the host allowlist —
 * this function intentionally accepts arbitrary hostnames. The remaining
 * SSRF defense (rejecting private/internal IPs) runs at fetch time in
 * `fetchExternalImageBytes` because it requires a live DNS lookup.
 *
 * @throws Error with a user-safe message on any rule violation.
 */
export function validateExternalImageUrl(rawUrl: string): string {
  const url = new URL(rawUrl);

  if (url.protocol !== 'https:') {
    throw new Error('Invalid external URL: protocol must be https:');
  }
  if (url.port !== '') {
    throw new Error('Invalid external URL: non-standard port not allowed');
  }
  if (url.username !== '' || url.password !== '') {
    throw new Error('Invalid external URL: credentials not allowed');
  }

  // ReDoS-safe: {1,16} ceiling; DNS absolute form has ≤2 trailing dots.
  const normalizedHostname = url.hostname.replace(/\.{1,16}$/, '');

  const ipv4Pattern = /^(\d{1,3}\.){3}\d{1,3}$/;
  const ipv6Pattern = /^\[?[0-9a-f:]+\]?$/i;
  if (ipv4Pattern.test(normalizedHostname) || ipv6Pattern.test(normalizedHostname)) {
    // IP literals bypass DNS, which is where our private-range check runs.
    // Reject early — anything that genuinely needs to be reached by IP can be
    // added to the Discord-CDN allowlist explicitly instead.
    throw new Error('Invalid external URL: IP addresses not allowed');
  }

  // Reconstruct from validated components to break taint flow into the fetch call.
  // Fragment (`url.hash`) is intentionally dropped — see equivalent comment in
  // attachmentFetch.validateAttachmentUrl. Same rationale: undici strips it
  // before the wire request, so retaining it here would only mislead callers
  // and risk fragment-divergent cache keys.
  return `https://${normalizedHostname}${url.pathname}${url.search}`;
}

/**
 * True if an IPv4 address is in a range we refuse to fetch from.
 * Covers private (RFC 1918), loopback, link-local, CGNAT, multicast,
 * reserved, and broadcast.
 */
function isPrivateOrInternalIpv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(p => !Number.isFinite(p) || p < 0 || p > 255)) {
    return true;
  }
  const [a, b] = parts;
  return (
    a === 0 || // 0.0.0.0/8 — "this" network
    a === 10 || // 10.0.0.0/8 — RFC 1918 private
    a === 127 || // 127.0.0.0/8 — loopback
    (a === 169 && b === 254) || // 169.254.0.0/16 — link-local
    (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12 — RFC 1918 private
    (a === 192 && b === 168) || // 192.168.0.0/16 — RFC 1918 private
    (a === 100 && b >= 64 && b <= 127) || // 100.64.0.0/10 — CGNAT
    a >= 224 // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved + 255.255.255.255 broadcast
  );
}

/**
 * Extract the embedded IPv4 from a 6to4 IPv6 address (`2002:hhhh:hhhh::/48`)
 * and apply the IPv4 private-range check to it. The 32-bit IPv4 lives in the
 * second and third hextets: `2002:AABB:CCDD::` → `A.B.C.D` where each pair
 * is one octet (high byte / low byte of the hextet). Returns true (fail
 * closed) on any parse error.
 */
function isPrivateOrInternalIpv6Tunneled6to4(lower: string): boolean {
  const parts = lower.split(':');
  // Need at least three hextets (2002, h1, h2). Compressed forms may collapse
  // trailing zeros via `::`, so we check the prefix-bound parts.
  if (parts.length < 3) {
    return true;
  }
  const h1 = Number.parseInt(parts[1], 16);
  const h2 = Number.parseInt(parts[2], 16);
  if (!Number.isFinite(h1) || !Number.isFinite(h2)) {
    return true;
  }
  const o1 = (h1 >> 8) & 0xff;
  const o2 = h1 & 0xff;
  const o3 = (h2 >> 8) & 0xff;
  const o4 = h2 & 0xff;
  const embeddedV4 = `${o1}.${o2}.${o3}.${o4}`;
  return isIPv4(embeddedV4) ? isPrivateOrInternalIpv4(embeddedV4) : true;
}

/**
 * True if an IPv6 address is in a range we refuse to fetch from.
 * Covers loopback, ULA, link-local, multicast, deprecated site-local,
 * IPv4-mapped recursion, 6to4 tunneling recursion, and Teredo tunneling.
 */
// Loopback / unspecified IPv6 addresses, in the forms `dns.lookup` actually
// produces: canonical (RFC 5952) `::`, `::1` plus the uncompressed-zeros
// representation. Fully-padded forms (`0000:...:0001`) and mixed-compression
// variants are not covered — `dns.lookup` does not emit them, and the only
// other caller (`isPrivateOrInternalIp` exposed for defense-in-depth) is
// expected to canonicalise its input first. Set lookup keeps the guard tight
// while keeping function complexity below the lint cap.
const LOOPBACK_OR_UNSPECIFIED_IPV6 = new Set(['::', '::1', '0:0:0:0:0:0:0:0', '0:0:0:0:0:0:0:1']);

function isPrivateOrInternalIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (LOOPBACK_OR_UNSPECIFIED_IPV6.has(lower)) {
    return true;
  }
  // IPv4-mapped IPv6 (::ffff:a.b.c.d) — extract embedded IPv4 and recurse so
  // a private IPv4 wrapped in IPv6 syntax doesn't slip through.
  if (lower.startsWith('::ffff:')) {
    const v4 = lower.slice(7);
    return isIPv4(v4) ? isPrivateOrInternalIpv4(v4) : true;
  }
  // 6to4 tunneling (2002::/16) — second/third hextets encode an IPv4 address
  // (e.g. `2002:c0a8:0101::` embeds `192.168.1.1`). Without this recursion an
  // attacker who registered a domain with a AAAA record pointing at
  // `2002:c0a8:0101::` could bypass the guard. Practical exploitability is
  // limited (Railway's network is unlikely to reach 6to4 relay infra), but
  // the gap is incongruous with the IPv4-mapped recursion above so we close
  // it for consistency. Malformed 6to4 fails closed.
  if (lower.startsWith('2002:')) {
    return isPrivateOrInternalIpv6Tunneled6to4(lower);
  }
  // Teredo tunneling (2001:0000::/32) — encodes a private IPv4 endpoint plus
  // public IPv4 server. RFC 4380. Modern OSes have largely deprecated it but
  // the address space is still routable. Reject the whole prefix rather than
  // try to extract the embedded server/client addresses (the spec is
  // sufficiently fiddly that mis-extraction would be more dangerous than
  // blanket rejection of a prefix that legitimate external image hosts will
  // never use).
  //
  // Three prefix forms must be checked because Node's `dns.lookup` returns
  // RFC 5952 canonical form (leading zeros stripped per `inet_ntop`). A
  // Teredo address is canonicalized as `2001:0:hhhh:hhhh:...`, NOT
  // `2001:0000:...` — so omitting the `2001:0:` prefix would silently miss
  // every real-world Teredo hit. The `2001:0000:` form covers uncompressed
  // input (e.g. tests, hand-written addresses); `2001::` covers the
  // degenerate all-zeros form.
  if (lower.startsWith('2001:0000:') || lower.startsWith('2001:0:') || lower.startsWith('2001::')) {
    return true;
  }
  const firstHextet = lower.split(':')[0];
  // fe80::/10 — link-local. The first 10 bits are 1111111010, which spans
  // first hextets fe80–febf, all of which start with fe8 / fe9 / fea / feb.
  if (
    firstHextet.startsWith('fe8') ||
    firstHextet.startsWith('fe9') ||
    firstHextet.startsWith('fea') ||
    firstHextet.startsWith('feb')
  ) {
    return true;
  }
  if (firstHextet.startsWith('fc') || firstHextet.startsWith('fd')) {
    return true; // fc00::/7 — unique local addresses
  }
  // fec0::/10 — deprecated site-local addresses (RFC 3879). No real
  // infrastructure uses these post-deprecation, but the guard stays for
  // defensive completeness — a regression that re-enables them would be
  // invisible until exploited. Spans first hextets fec0–feff (fec*/fed*/fee*/fef*).
  if (
    firstHextet.startsWith('fec') ||
    firstHextet.startsWith('fed') ||
    firstHextet.startsWith('fee') ||
    firstHextet.startsWith('fef')
  ) {
    return true;
  }
  if (firstHextet.startsWith('ff')) {
    return true; // ff00::/8 — multicast
  }
  return false;
}

/**
 * True if an IP address is in a range we refuse to fetch from. Dispatches by
 * family to `isPrivateOrInternalIpv4` / `isPrivateOrInternalIpv6`. Returns
 * true on unparseable input so unknown formats fail closed.
 */
export function isPrivateOrInternalIp(ip: string): boolean {
  if (isIPv4(ip)) {
    return isPrivateOrInternalIpv4(ip);
  }
  if (isIPv6(ip)) {
    return isPrivateOrInternalIpv6(ip);
  }
  return true; // unknown family — fail closed
}

/**
 * Resolve a hostname and confirm EVERY returned IP is public.
 *
 * Uses `{ all: true }` so an IPv4-public/IPv6-private mismatch can't bypass
 * us — fetch could pick either family for the connection, and we want the
 * answer "any IP for this hostname is private" to fail the validation.
 *
 * Logs the resolution (hostname + IPs) at info level so a future incident
 * can trace which external domains we've actually reached.
 *
 * @throws Error if any resolved IP is private/internal, or if DNS resolution
 *   fails (NXDOMAIN, no answer, network error).
 */
export async function assertResolvedHostnameIsPublic(hostname: string): Promise<void> {
  let resolved: { address: string; family: number }[];
  try {
    resolved = await dns.lookup(hostname, { all: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not resolve hostname for external URL: ${message}`, { cause: error });
  }

  if (resolved.length === 0) {
    throw new Error(`DNS lookup for external URL returned no addresses (hostname: ${hostname})`);
  }

  const offenders = resolved.filter(r => isPrivateOrInternalIp(r.address));
  if (offenders.length > 0) {
    throw new Error(
      `Refusing to fetch external URL: hostname ${hostname} resolves to private/internal IP(s): ` +
        offenders.map(o => o.address).join(', ')
    );
  }

  // DEBUG, not INFO: this fires per-external-attachment-per-job; on a busy
  // bot forwarding many Reddit/Imgur images it would dominate the log volume.
  // The structured fields (hostname, addresses, families) stay attached so
  // an incident responder can re-deploy with DEBUG to recover the forensic
  // trail; failure paths above already log/throw at warn/error.
  logger.debug(
    {
      hostname,
      addresses: resolved.map(r => r.address),
      families: resolved.map(r => r.family),
    },
    'External URL hostname resolved to public IP(s)'
  );
}

/**
 * Fetch an external (non-Discord-CDN) image's bytes safely.
 *
 * Composes `assertResolvedHostnameIsPublic` (DNS+IP guard) with the existing
 * `fetchAttachmentBytes` helper, adding the browser User-Agent and the
 * Content-Type prefix assertion.
 *
 * Caller is responsible for passing a URL already through
 * `validateExternalImageUrl` — surface checks (https, no creds, etc.) are
 * NOT re-applied here.
 *
 * Known limitation: the underlying `fetchAttachmentBytes` uses
 * `redirect: 'error'`, so any external CDN that issues a 30x redirect
 * (Cloudflare canonicalization, scheme upgrades, etc.) will fail here even
 * though the destination would have been safe. This is a deliberate
 * SSRF-via-redirect defense — the post-resolution redirect target hasn't
 * gone through `assertResolvedHostnameIsPublic` and could point at a private
 * IP. If real-world deploy shows meaningful loss to this, the fix is to add
 * a manual one-step redirect-follow that re-runs the DNS+IP guard on the
 * Location header.
 *
 * Throws:
 * - Error from `assertResolvedHostnameIsPublic` (private IP, DNS failure)
 * - HttpError from `fetchAttachmentBytes` (non-OK status, including 30x
 *   redirect responses surfaced as fetch errors)
 * - AttachmentTooLargeError from `fetchAttachmentBytes` (size cap)
 * - Error from `fetchAttachmentBytes` (Content-Type mismatch, network error,
 *   timeout)
 */
export async function fetchExternalImageBytes(
  url: string,
  options: Pick<FetchAttachmentBytesOptions, 'maxBytes' | 'timeoutMs'> = {}
): Promise<Buffer> {
  const { hostname } = new URL(url);
  await assertResolvedHostnameIsPublic(hostname);
  return fetchAttachmentBytes(url, {
    ...options,
    headers: { 'User-Agent': EXTERNAL_FETCH_USER_AGENT },
    assertContentTypePrefix: 'image/',
  });
}
