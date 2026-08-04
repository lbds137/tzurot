/**
 * Nightly DB Sync Scheduler
 *
 * Runs the same REAL dev↔prod sync that `/admin db-sync` runs by hand, once
 * per day, unattended. Silent when the databases are already in agreement;
 * posts an owner-channel summary when rows actually moved or the sync raised
 * warnings, and an owner-channel failure notice when the call fails.
 *
 * Cadence design — one deliberate inversion of the nag schedulers. Those run
 * a CHEAP check every tick and use the Redis cooldown to rate-limit the POST.
 * Here the tick's action IS the expensive, consequential step: a real sync
 * that writes to both databases. So the cooldown gates the SYNC itself and is
 * armed BEFORE the call — bot-client restarts on every deploy, and without
 * that ordering a deploy-heavy day would fire a real sync per deploy, and a
 * crash loop would fire one per restart. The cost of arming first is that a
 * process death mid-sync skips that day's run, which is the right trade for
 * an operation that writes to prod.
 *
 * The cadence is once per day anchored to process start, not to a wall-clock
 * hour — the same property every scheduler here has. "Nightly" is the budget,
 * not a guaranteed 03:00.
 */

import { EmbedBuilder, type Client } from 'discord.js';
import type { Redis } from 'ioredis';
import { DISCORD_COLORS } from '@tzurot/common-types/constants/discord';
import { getConfig } from '@tzurot/common-types/config/config';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { escapeFenceBreaks } from '../utils/fenceEscape.js';
import { getOwnerClient } from '../utils/gatewayClients.js';
import { createIntervalScheduler } from '../utils/intervalScheduler.js';
import { postOwnerChannelEmbed } from '../utils/ownerChannel.js';
import {
  buildSyncSummary,
  hasSyncChanges,
  sumSyncCounters,
  type SyncResult,
} from '../utils/dbSyncSummary.js';

const logger = createLogger('nightly-db-sync');

const SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;
const STARTUP_DELAY_MS = 60_000;
/**
 * At most one real sync per day, across restarts. Deliberately a little under
 * the 24h interval so ordinary tick jitter can never make a scheduled run land
 * inside its own previous cooldown and skip a day.
 */
const SYNC_COOLDOWN_SECONDS = 23 * 60 * 60;
const COOLDOWN_KEY = 'nightly-db-sync:cooldown';

/**
 * The scheduled run mirrors `/admin db-sync`'s defaults exactly: a real sync
 * (never a dry run — a dry run would report work it never did), and no schema
 * -skew override, so a migration-soak window fails loudly here just as it does
 * for the manual command.
 */
const SCHEDULED_SYNC_OPTIONS = { dryRun: false, allowSchemaSkew: false } as const;

const scheduler = createIntervalScheduler<[Client, Redis]>({
  intervalMs: SYNC_INTERVAL_MS,
  startupDelayMs: STARTUP_DELAY_MS,
  logger,
  run: (client, redis) => runNightlyDbSync(client, redis),
});

/**
 * Start the daily sync (call once from the composition root). Refuses to start
 * without a configured owner id: every `/api/admin/*` call is gated on the
 * actor header matching it, so an unconfigured deployment could only ever
 * produce a daily rejection.
 */
export function startNightlyDbSyncScheduler(client: Client, redis: Redis): void {
  const ownerId = getConfig().BOT_OWNER_ID;
  // Same emptiness test as getOwnerClient — an empty string would pass a bare
  // undefined check, start the scheduler, and turn a config gap into a daily
  // failure post instead of one boot-time warn.
  if (ownerId === undefined || ownerId.length === 0) {
    logger.warn('BOT_OWNER_ID is not configured — nightly db-sync will not run');
    return;
  }
  scheduler.start(client, redis);
}

/** Stop the scheduler (graceful shutdown). */
export function stopNightlyDbSyncScheduler(): void {
  scheduler.stop();
}

/**
 * Owner-channel embed for a sync worth reporting. Rows moving is the normal
 * reportable outcome; warnings WITHOUT row movement (a failed deletion
 * propagation, a partial skip) are the quieter failure shape and get warning
 * framing — an unattended job that lets those pass silently is how a sync
 * degrades for weeks before anyone notices.
 */
function buildNightlySyncEmbed(result: SyncResult, rowsMoved: boolean): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(rowsMoved ? DISCORD_COLORS.SUCCESS : DISCORD_COLORS.WARNING)
    .setTitle(
      rowsMoved
        ? '🌙 Nightly database sync applied changes'
        : '⚠️ Nightly database sync completed with warnings'
    )
    .setDescription(buildSyncSummary(result, false))
    .setFooter({ text: 'Full per-table report: /admin db-sync' })
    .setTimestamp();
}

/** Owner-channel embed for a failed sync. */
function buildNightlySyncFailureEmbed(reason: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(DISCORD_COLORS.ERROR)
    .setTitle('❌ Nightly database sync failed')
    .setDescription(reason)
    .setFooter({ text: 'Retry by hand: /admin db-sync' })
    .setTimestamp();
}

/** Exported for tests — one full sync cycle. */
export async function runNightlyDbSync(client: Client, redis: Redis): Promise<void> {
  try {
    // Cooldown FIRST, and armed before the call — see the cadence note above.
    const cooling = await redis.get(COOLDOWN_KEY);
    if (cooling !== null) {
      logger.info({ since: cooling }, 'Nightly sync already ran within the cooldown window');
      return;
    }
    await redis.setex(COOLDOWN_KEY, SYNC_COOLDOWN_SECONDS, new Date().toISOString());

    const result = await getOwnerClient().dbSync(SCHEDULED_SYNC_OPTIONS);

    if (!result.ok) {
      logger.error({ status: result.status, error: result.error }, 'Nightly db sync failed');
      await postOwnerChannelEmbed(
        client,
        buildNightlySyncFailureEmbed(
          `The scheduled sync did not complete (HTTP ${String(result.status)}):\n\`\`\`\n${escapeFenceBreaks(result.error)}\n\`\`\``
        )
      );
      return;
    }

    const stats = result.data.stats;
    const totals = sumSyncCounters(stats);
    const rowsMoved = hasSyncChanges(stats);
    const warningCount = result.data.warnings?.length ?? 0;

    // Silent only when nothing moved AND nothing warned: a "nothing happened"
    // post every night trains the owner to ignore the channel, but a
    // warnings-only result is the quiet failure shape and must surface.
    if (!rowsMoved && warningCount === 0) {
      logger.info({ tableCount: Object.keys(stats).length }, 'Nightly sync applied no changes');
      return;
    }

    await postOwnerChannelEmbed(client, buildNightlySyncEmbed(result.data, rowsMoved));
    logger.info({ ...totals, warningCount }, 'Nightly sync reportable — posted owner summary');
  } catch (error) {
    logger.error({ err: error }, 'Nightly db sync threw');
    // postOwnerChannelEmbed never throws, so this stays inside the swallow.
    await postOwnerChannelEmbed(
      client,
      buildNightlySyncFailureEmbed(
        `The scheduled sync threw before completing: \`${escapeFenceBreaks(error instanceof Error ? error.message : String(error))}\``
      )
    );
  }
}
