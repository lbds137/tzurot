/**
 * OUTBOUND_DM_ALLOWLIST parsing — the single gate every proactive-outreach
 * feature must consult before contacting a user the bot didn't just hear
 * from (DM prewarming, broadcast delivery, future outbound DMs).
 *
 * Rationale: dev's database is synced from prod, so dev's user table is
 * prod-shaped. Any audience derived from it (recent users, opted-in
 * recipients) points the DEV bot at PROD users; repeated boot-time DM
 * bursts of that shape earned a Discord 340002 DM quarantine. The
 * allowlist makes dev structurally unable to reach beyond its real users.
 */

import { getConfig } from '../config/config.js';
import { DiscordSnowflakeSchema } from '../schemas/api/internal.js';
import { createLogger } from './logger.js';

const logger = createLogger('outboundDmAllowlist');

/**
 * The parsed allowlist, or null when unrestricted (env unset/empty — prod).
 *
 * Malformed entries (typos, non-snowflakes) are dropped WITH a warn log —
 * fail-closed stays intact (a garbage-only value restricts to nobody rather
 * than falling open), but the misconfiguration is visible instead of
 * silently locking the dev bot out of everyone.
 */
export function getOutboundDmAllowlist(): ReadonlySet<string> | null {
  const raw = getConfig().OUTBOUND_DM_ALLOWLIST;
  if (raw === undefined || raw.trim() === '') {
    return null;
  }
  const entries = raw
    .split(',')
    .map(id => id.trim())
    .filter(id => id !== '');
  const valid = entries.filter(id => DiscordSnowflakeSchema.safeParse(id).success);
  if (valid.length < entries.length) {
    logger.warn(
      { dropped: entries.length - valid.length, kept: valid.length },
      'OUTBOUND_DM_ALLOWLIST contains non-snowflake entries — dropped'
    );
  }
  return new Set(valid);
}
