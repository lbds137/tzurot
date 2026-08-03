/**
 * Retention Nag Scheduler
 *
 * Daily check (plus one shortly after startup) of the gateway's retention
 * preview; posts an owner-channel embed when any account is purge-eligible.
 * Nothing purges automatically — the embed's whole job is to point the
 * operator at the CLI commands that review and act.
 *
 * Cadence design mirrors SecretRotationNagScheduler: bot-client restarts on
 * every deploy, so a weekly setInterval would effectively never fire. The
 * CHECK runs daily/on-startup (restart-friendly — restarts make it fire more
 * often, never less) and a Redis cooldown key caps the NAG at one post per
 * week, surviving deploys precisely because in-process state does not.
 */

import { EmbedBuilder, escapeMarkdown, type Client } from 'discord.js';
import type { Redis } from 'ioredis';
import { getConfig } from '@tzurot/common-types/config/config';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { RetentionPreviewResponse } from '@tzurot/common-types/schemas/api/internal';
import { getServiceClient } from '../utils/gatewayClients.js';
import { createIntervalScheduler } from '../utils/intervalScheduler.js';
import { postOwnerChannelEmbed } from '../utils/ownerChannel.js';

const logger = createLogger('retention-nag');

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const STARTUP_DELAY_MS = 60_000;
/** At most one nag per week, across restarts. */
const NAG_COOLDOWN_SECONDS = 7 * 24 * 60 * 60;
const COOLDOWN_KEY = 'retention-nag:cooldown';
/** Embed line cap — the full cohort belongs to the preview CLI, not Discord. */
const MAX_LISTED_USERS = 10;

const scheduler = createIntervalScheduler<[Client, Redis]>({
  intervalMs: CHECK_INTERVAL_MS,
  startupDelayMs: STARTUP_DELAY_MS,
  logger,
  run: (client, redis) => runRetentionNagCheck(client, redis),
});

/** Start the daily purge-eligibility check (call once from the composition root). */
export function startRetentionNagScheduler(client: Client, redis: Redis): void {
  scheduler.start(client, redis);
}

/** Stop the scheduler (graceful shutdown). */
export function stopRetentionNagScheduler(): void {
  scheduler.stop();
}

/** The `--env` the embed's CLI commands should carry for THIS deployment. */
function cliEnv(): 'prod' | 'dev' {
  return getConfig().NODE_ENV === 'production' ? 'prod' : 'dev';
}

/** Build the owner-channel embed for a non-empty cohort. Exported for tests. */
export function buildRetentionNagEmbed(preview: RetentionPreviewResponse): EmbedBuilder {
  const { users, totals } = preview;
  const env = cliEnv();

  const reasonLabel = {
    account_gone: 'account deleted',
    unreachable: 'unreachable',
    grace_expired: 'grace expired',
    bystander: 'never used directly',
  } as const;

  // Three identity tokens per line, deliberately redundant: the `<@id>` mention
  // frequently fails to resolve on mobile, the plain-text username is the
  // readable fallback, and the backticked id is the copy-paste handle the CLI
  // commands take. The username is user-controlled text entering an
  // owner-facing embed, so it is escaped; an empty one drops its token rather
  // than rendering a dangling `@`.
  const lines = users.slice(0, MAX_LISTED_USERS).map(user => {
    const escapedUsername = escapeMarkdown(user.username);
    const usernameToken = user.username.trim() === '' ? '' : `@${escapedUsername} `;
    return (
      `<@${user.discordId}> ${usernameToken}— \`${user.discordId}\` — ` +
      `inactive since ${user.inactiveSince.slice(0, 10)} ` +
      `(${reasonLabel[user.reason]})`
    );
  });
  if (users.length > MAX_LISTED_USERS) {
    lines.push(`…and ${String(users.length - MAX_LISTED_USERS)} more (see the preview CLI)`);
  }

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

  return new EmbedBuilder()
    .setTitle('🗑️ Accounts eligible for retention purge')
    .setDescription(`${summary}${reachable}${breaker}\n\n${lines.join('\n')}`)
    .setFooter({
      text:
        `Review: pnpm ops retention:preview --env ${env} · ` +
        `Notify: pnpm ops retention:notify --env ${env} · ` +
        `Purge: pnpm ops retention:purge --env ${env}`,
    })
    .setTimestamp();
}

/** Exported for tests — one full check cycle. */
export async function runRetentionNagCheck(client: Client, redis: Redis): Promise<void> {
  try {
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

    await postOwnerChannelEmbed(client, buildRetentionNagEmbed(preview));
    await redis.setex(COOLDOWN_KEY, NAG_COOLDOWN_SECONDS, new Date().toISOString());
    logger.info({ eligibleCount: preview.totals.eligibleCount }, 'Posted retention nag');
  } catch (error) {
    // Nag failure must never affect anything else; next daily tick retries.
    logger.warn({ err: error }, 'Retention nag check failed');
  }
}
