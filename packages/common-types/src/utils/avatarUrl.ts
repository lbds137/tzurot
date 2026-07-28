/**
 * Public avatar URL path construction — the single producer of the two URL
 * shapes the gateway's avatar route parses:
 *
 * 1. Legacy: `/avatars/{slug}.png`
 * 2. Path-versioned: `/avatars/{slug}-{timestamp}.png` — Discord's CDN
 *    ignores query params but treats different paths as new resources, so
 *    cache-busting rides the filename.
 *
 * Consumers prepend their own base (public gateway URL for Discord-facing
 * avatars, internal gateway URL for service-to-service fetches). The slug is
 * always URI-encoded here — SSRF defense-in-depth applies to every dynamic
 * path segment regardless of how trusted the source is, and centralizing the
 * shape keeps producers from drifting against the gateway's filename parser.
 */

/** The URL path prefix the gateway mounts the avatar router at. */
export const AVATAR_URL_PREFIX = '/avatars';

/**
 * Build the avatar URL path for a personality slug.
 *
 * @param slug - The personality slug (encoded here; pass it raw).
 * @param cacheBustMs - Optional versioning timestamp (epoch ms, typically the
 *   row's `updatedAt`); when present, produces the path-versioned shape.
 */
export function avatarUrlPath(slug: string, cacheBustMs?: number): string {
  const version = cacheBustMs !== undefined ? `-${cacheBustMs}` : '';
  return `${AVATAR_URL_PREFIX}/${encodeURIComponent(slug)}${version}.png`;
}
