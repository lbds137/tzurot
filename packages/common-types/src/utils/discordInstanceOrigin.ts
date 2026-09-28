/**
 * Self-hosted Discord-compatible (Spacebar) instance origin — pure helpers.
 *
 * A bot-client/ai-worker process configured with `DISCORD_INSTANCE_ORIGIN`
 * talks to that origin for REST + CDN instead of Discord's own hosts. This
 * module is pure (no config import) so it stays usable from both the config
 * schema (which normalizes the raw env value) and the runtime guards/parsers
 * that need to match a URL against the configured origin. Unset (`undefined`)
 * must always be byte-identical to today's Discord-only behavior — every
 * function here treats `undefined` as "no instance configured."
 */

/**
 * Normalize a raw `DISCORD_INSTANCE_ORIGIN` value into a canonical origin
 * string (`scheme://hostname[:port]`, no trailing slash, no path/query/hash).
 *
 * Throws when `raw` doesn't parse as a URL, or parses but isn't a bare
 * https origin: non-https scheme, embedded credentials, or any path/query/
 * hash beyond the root.
 */
export function normalizeDiscordInstanceOrigin(raw: string): string {
  const url = new URL(raw);

  if (url.protocol !== 'https:') {
    throw new Error(`DISCORD_INSTANCE_ORIGIN must use https:, got "${url.protocol}" in "${raw}"`);
  }
  if (url.username !== '' || url.password !== '') {
    throw new Error(`DISCORD_INSTANCE_ORIGIN must not contain credentials: "${raw}"`);
  }
  if (url.pathname !== '/') {
    throw new Error(
      `DISCORD_INSTANCE_ORIGIN must be a bare origin with no path, got "${url.pathname}" ` +
        `in "${raw}"`
    );
  }
  if (url.search !== '') {
    throw new Error(`DISCORD_INSTANCE_ORIGIN must not contain a query string: "${raw}"`);
  }
  if (url.hash !== '') {
    throw new Error(`DISCORD_INSTANCE_ORIGIN must not contain a fragment: "${raw}"`);
  }

  return url.origin;
}

/**
 * The `@discordjs/rest` options an instance-configured client passes as its
 * `rest` client options. `undefined` origin returns `undefined` so callers
 * can spread it in without adding a `rest` key at all when unset — keeping
 * unset behavior byte-identical to a client built with zero rest overrides.
 */
export interface DiscordInstanceRestOptions {
  api: string;
  cdn: string;
  mediaProxy: string;
}

/**
 * Build the discord.js/`@discordjs/rest` origin overrides for a configured
 * instance origin. `mediaProxy` is set alongside `cdn` because
 * `@discordjs/rest` 2.6.3 builds GIF sticker URLs from `mediaProxy`
 * (defaulting to `https://media.discordapp.net`), so an instance-configured
 * process must not silently keep pointing at Discord's media proxy.
 * `version` is deliberately left unset — the default REST API version.
 */
export function discordRestOptions(
  origin: string | undefined
): DiscordInstanceRestOptions | undefined {
  if (origin === undefined) {
    return undefined;
  }
  return { api: `${origin}/api`, cdn: origin, mediaProxy: origin };
}

/**
 * True when `url` matches the configured instance origin EXACTLY on
 * scheme + hostname + port, with no embedded credentials. Always false when
 * `origin` is undefined. Comparison is field-by-field `===` only — never a
 * substring/prefix check on the raw URL string, which CodeQL flags as
 * incomplete URL sanitization and which a look-alike host
 * (`host.example.evil.io`) would pass. ORIGIN-only — trusts the whole
 * origin including `${origin}/api`; see `matchesInstanceCdnUrl` below for
 * a path-scoped check restricted to the CDN/media-proxy surface.
 */
export function matchesInstanceOrigin(url: URL, origin: string | undefined): boolean {
  if (origin === undefined) {
    return false;
  }
  const o = new URL(origin);
  return (
    url.protocol === o.protocol &&
    url.hostname === o.hostname &&
    url.port === o.port &&
    url.username === '' &&
    url.password === ''
  );
}

/**
 * CDN/media-proxy path prefixes. Sourced from discord-api-types v10's
 * `CDNRoutes` (`node_modules/discord-api-types/rest/v10/index.js`) — the
 * shapes discord.js builds when constructing avatar/icon/banner/emoji/
 * sticker/etc. URLs from API responses — plus two shapes `CDNRoutes`
 * doesn't cover (see below). Deliberately excludes `/api`: the REST API
 * prefix `discordRestOptions` puts on the same origin, so an SSRF request
 * to the instance's REST API can never pass under this allowlist.
 *
 * Two shapes `CDNRoutes` doesn't cover: `channelIcon` — built directly by
 * `@discordjs/rest`'s `CDN` class, not `discord-api-types`; and
 * `attachments` — returned verbatim by the Discord/Spacebar REST API
 * rather than built client-side (confirmed against a local
 * spacebar-server checkout, `src/cdn/routes/attachments.ts`, which serves
 * message attachments at
 * `${endpoint}/attachments/${channel_id}/${message_id}/${filename}`).
 */
export const DISCORD_INSTANCE_CDN_PATH_PREFIXES: readonly string[] = [
  '/attachments/',
  '/avatars/',
  '/avatar-decorations/',
  '/avatar-decoration-presets/',
  '/banners/',
  '/channel-icons/',
  '/discovery-splashes/',
  '/embed/',
  '/emojis/',
  '/guild-events/',
  '/guild-tag-badges/',
  '/guilds/',
  '/icons/',
  '/role-icons/',
  '/soundboard-sounds/',
  '/splashes/',
  '/stickers/',
  '/team-icons/',
  '/app-assets/',
  '/app-icons/',
];

/**
 * True when `url` matches the configured instance origin AND its path is
 * under one of `DISCORD_INSTANCE_CDN_PATH_PREFIXES` — the narrower check
 * for callers that must trust only the instance's CDN/media-proxy
 * surface, never its REST API. `matchesInstanceOrigin`'s origin match
 * alone is NOT sufficient for that: `discordRestOptions` places the
 * instance's REST api at `${origin}/api`, so an origin-only check would
 * also accept `${origin}/api/...` (SSRF to the instance's REST API).
 * Each prefix is matched as a full path segment via `String#startsWith`
 * on a slash-terminated prefix, so `/attachmentsX/...` and
 * `/api/attachments/...` do NOT pass. Always false when `origin` is
 * undefined.
 */
export function matchesInstanceCdnUrl(url: URL, origin: string | undefined): boolean {
  if (!matchesInstanceOrigin(url, origin)) {
    return false;
  }
  return DISCORD_INSTANCE_CDN_PATH_PREFIXES.some(prefix => url.pathname.startsWith(prefix));
}

/** Escape a literal string for safe embedding inside a `RegExp` source. */
export function escapeRegExpLiteral(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

/** Regex-source fragment matching Discord's own message-link hosts. */
export const DISCORD_HOST_PATTERN = 'https:\\/\\/(ptb\\.|canary\\.)?discord(?:app)?\\.com';

/** Regex-source fragment matching the message-link `/channels/.../.../...` path. */
export const MESSAGE_LINK_PATH_PATTERN = '\\/channels\\/(@me|\\d+)\\/(\\d+)\\/(\\d+)';

/**
 * The regex SOURCE (not a compiled `RegExp`) matching a message link against
 * exactly one instance origin: the escaped `origin` composed with
 * `MESSAGE_LINK_PATH_PATTERN`. Three capture groups, in order: guild id (or
 * `@me`), channel id, message id. Callers wrap this in `new RegExp(...)`
 * (optionally with flags).
 */
export function instanceMessageLinkPattern(origin: string): string {
  return `${escapeRegExpLiteral(origin)}${MESSAGE_LINK_PATH_PATTERN}`;
}
