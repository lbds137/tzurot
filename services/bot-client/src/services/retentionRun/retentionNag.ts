/**
 * Retention job — report-only nag mode.
 *
 * This is what `RetentionRunScheduler` runs in production when the
 * `RETENTION_AUTORUN_ENABLED` kill switch is off (see that module's mode
 * table): an hourly check of the gateway's retention preview that posts an
 * owner-channel embed when any account is purge-eligible. Nothing purges in
 * this mode — the embed's whole job is to point the operator at the CLI
 * commands that review and act.
 *
 * Production-only, like the live mode (non-production rehearses): the dev database
 * mirrors prod's users, so a dev-side check reports the SAME cohort the prod
 * check reports, with no dev-specific signal — hence the hardcoded `prod` in
 * the embed's footer commands below rather than an env lookup.
 */

import { EmbedBuilder, type Client } from 'discord.js';
import type { Redis } from 'ioredis';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { RetentionPreviewResponse } from '@tzurot/common-types/schemas/api/internal';
import { getServiceClient } from '../../utils/gatewayClients.js';
import { postOwnerChannelEmbed } from '../../utils/ownerChannel.js';
import { formatRetentionUserLines } from './retentionRows.js';

const logger = createLogger('retention-nag');

/** At most one nag per week, across restarts. */
const NAG_COOLDOWN_SECONDS = 7 * 24 * 60 * 60;
const COOLDOWN_KEY = 'retention-nag:cooldown';

/** Build the owner-channel embed for a non-empty cohort. Exported for tests. */
export function buildRetentionNagEmbed(preview: RetentionPreviewResponse): EmbedBuilder {
  const { users, totals } = preview;

  const bystanderNote =
    totals.bystander > 0
      ? ` (${String(totals.bystander)} never used the bot directly — no notice owed)`
      : '';
  const summary =
    `**${String(totals.eligibleCount)}** of ${String(totals.userbaseCount)} users ` +
    `(${String(totals.percentOfUserbase)}%) are purge-eligible${bystanderNote}. ` +
    `Characters: ${String(totals.charactersToDelete)} would be deleted, ` +
    `${String(totals.charactersToReHome)} re-homed to the Orphaned Characters bucket.`;

  // The reachable branch's pipeline states (Phase 3). Grace-expired users are
  // already IN the cohort above; the other two are upstream of it. All THREE
  // counts gate the line — grace-expired users have left the other two counts
  // (window passed, already warned), so a graceExpired-only state is real.
  const reachable =
    totals.reachableToNotify > 0 || totals.inGrace > 0 || totals.graceExpired > 0
      ? `\n\nReachable branch: **${String(totals.reachableToNotify)}** awaiting a warning DM · ` +
        `**${String(totals.inGrace)}** in grace · ` +
        `**${String(totals.graceExpired)}** grace-expired (counted in the cohort above).`
      : '';

  const breaker = totals.breakerWarning
    ? '\n\n⚠️ **Cohort exceeds the breaker warning share of the userbase.** ' +
      'Confirm this is real churn and not a tracking-signal glitch before purging.'
    : '';

  const lines = formatRetentionUserLines(users, '(see the preview CLI)');

  return new EmbedBuilder()
    .setTitle('🗑️ Accounts eligible for retention purge')
    .setDescription(`${summary}${reachable}${breaker}\n\n${lines.join('\n')}`)
    .setFooter({
      text:
        'Review: pnpm ops retention:preview --env prod · ' +
        'Notify: pnpm ops retention:notify --env prod · ' +
        'Purge: pnpm ops retention:purge --env prod',
    })
    .setTimestamp();
}

/**
 * Exported for tests — one full check cycle. May throw; the scheduler's tick
 * wrapper is what swallows errors, not this function.
 */
export async function runRetentionNagCheck(client: Client, redis: Redis): Promise<void> {
  const result = await getServiceClient().retentionPreview();
  if (!result.ok) {
    logger.warn({ error: result.error }, 'Retention preview fetch failed; skipping check');
    return;
  }
  const preview = result.data;
  // Nag when EITHER branch needs the operator: a purge-eligible cohort, or
  // reachable-inactive users awaiting a warning DM (the notify CLI exists
  // now, so that state is actionable). Mid-grace users need nobody's
  // attention — the clock is doing the work.
  if (preview.totals.eligibleCount === 0 && preview.totals.reachableToNotify === 0) {
    return;
  }

  // Cooldown AFTER the eligibility determination: a quiet week costs no
  // Redis read, and the key only exists while a nag is being suppressed.
  const cooling = await redis.get(COOLDOWN_KEY);
  if (cooling !== null) {
    logger.info(
      { eligibleCount: preview.totals.eligibleCount },
      'Purge-eligible accounts present but nag is in cooldown'
    );
    return;
  }

  // Arm the cooldown only on confirmed delivery: a swallowed post failure
  // must not buy a week of silence — the next tick retries instead.
  const delivered = await postOwnerChannelEmbed(client, buildRetentionNagEmbed(preview));
  if (delivered) {
    await redis.setex(COOLDOWN_KEY, NAG_COOLDOWN_SECONDS, new Date().toISOString());
    logger.info({ eligibleCount: preview.totals.eligibleCount }, 'Posted retention nag');
  } else {
    logger.warn(
      { eligibleCount: preview.totals.eligibleCount },
      'Retention nag embed was not delivered; will retry next tick'
    );
  }
}
