// SSRF defense-in-depth helper. Discord interactions only ever supply
// CDN URLs from `cdn.discordapp.com` or `media.discordapp.net`, or from the
// CDN/media-proxy paths of the one configured self-hosted instance origin
// (`DISCORD_INSTANCE_ORIGIN`; never that instance's REST API), but
// a malicious or compromised Discord client could in principle inject a
// different host into an attachment payload. This helper validates the URL
// before any outbound fetch, providing an explicit guard at every fetch site
// rather than implicit trust in the Discord interaction object.

import type { Logger } from 'pino';
import { getConfig } from '@tzurot/common-types/config/config';
import { matchesInstanceCdnUrl } from '@tzurot/common-types/utils/discordInstanceOrigin';

/** Allowed Discord CDN hostnames. */
const DISCORD_CDN_HOSTS = ['cdn.discordapp.com', 'media.discordapp.net'];

export type DiscordCdnGuardResult =
  | { ok: true; hostname: string }
  | { ok: false; reason: 'invalid-url' }
  | { ok: false; reason: 'non-https' }
  | { ok: false; reason: 'unexpected-host'; rawHost: string };

/**
 * Validate that an attachment URL points at a Discord CDN host. Returns a
 * tagged result rather than throwing so callers can control their own
 * error-reply flow (some need to send to Discord, some to a webhook, etc.).
 *
 * @param url The attachment URL (typically `attachment.url` from a Discord
 *   interaction option).
 * @param logger Optional logger; when provided, an `unexpected-host` rejection
 *   logs a warn-level entry with the URL+host for incident triage.
 * @param instanceOrigin The configured self-hosted instance origin, if any.
 *   Defaults to the live config's `DISCORD_INSTANCE_ORIGIN` so call sites
 *   don't need to thread it manually; tests can pass it explicitly.
 */
export function validateDiscordCdnUrl(
  url: string,
  logger?: Logger,
  instanceOrigin: string | undefined = getConfig().DISCORD_INSTANCE_ORIGIN
): DiscordCdnGuardResult {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: 'invalid-url' };
  }
  if (parsed.protocol !== 'https:') {
    return { ok: false, reason: 'non-https' };
  }
  if (matchesInstanceCdnUrl(parsed, instanceOrigin)) {
    return { ok: true, hostname: parsed.hostname };
  }
  const hostname = parsed.hostname;
  if (!DISCORD_CDN_HOSTS.includes(hostname)) {
    if (logger !== undefined) {
      logger.warn({ url, host: hostname }, 'Unexpected attachment URL host');
    }
    return { ok: false, reason: 'unexpected-host', rawHost: hostname };
  }
  return { ok: true, hostname };
}
