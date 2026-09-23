/**
 * Nightly DB Sync Scheduler
 *
 * Runs the same REAL dev↔prod sync that `/admin db-sync` runs by hand, once
 * per day, unattended. Silent when the databases are already in agreement;
 * posts an owner-channel summary when rows actually moved or the sync raised
 * warnings, and an owner-channel failure notice when the call fails.
 *
 * PROD ONLY. The sync operates on the dev↔prod PAIR, so it is the same job no
 * matter which side schedules it — running it from both bot-clients syncs the
 * pair twice a day, and the Redis cooldown cannot dedupe that (each
 * environment has its own Redis). The prod deployment owns the schedule.
 *
 * Cadence design — one deliberate inversion of the nag schedulers. Those run
 * a CHEAP check every tick and use the Redis cooldown to rate-limit the POST.
 * Here the tick's action IS the expensive, consequential step: a real sync
 * that writes to both databases. So the cooldown gates the SYNC itself and is
 * armed BEFORE the call — bot-client restarts on every deploy, and without
 * that ordering a deploy-heavy day would fire a real sync per deploy, and a
 * crash loop would fire one per restart. The cost of arming first is that a
 * process death mid-sync skips that day's run, which is the right trade for
 * an operation that writes to prod. One narrow exception: the startup-run
 * deploy-window retry below releases the cooldown it just armed, only for
 * failures where the request cannot have reached the sync handler.
 *
 * Genuinely nightly, not boot-anchored: the tick runs every 15 minutes and
 * does nothing unless the current UTC hour equals the `nightlySyncHourUtc`
 * system setting (owner-editable in `/admin settings`, alongside the
 * `nightlySyncEnabled` switch). The 23h cooldown then collapses the up-to-four
 * ticks inside the matching hour to a single run — hour equality picks the
 * time of day, the cooldown enforces once-per-day. A deploy at noon no longer
 * fires a sync at noon.
 *
 * Startup-run deploy-window retry: the startup run (fired ~60s after
 * container start) can land while the gateway is still mid-deploy — bot-
 * client restarted, but the gateway hasn't finished its own rollover. A
 * not-ready failure there (a 404 from an old build missing the route, a
 * 502/503 from a fronting proxy, or a transport-level network error) is bad timing, not a real sync failure, so
 * the startup run releases the cooldown it just armed and retries once,
 * after a fixed delay. That retry deliberately skips the hour-equality gate —
 * it can land past the hour boundary, and every later tick that day would
 * then read as outside the hour and lose the day entirely — but it still
 * honours the `nightlySyncEnabled` switch and the (freshly re-armed)
 * cooldown. The retry itself is an ordinary run: any failure on it —
 * not-ready or otherwise — posts the failure embed and keeps the cooldown
 * armed, same as a normal tick. Two failure shapes are excluded from the
 * retry even on the startup run: a client timeout and a proxy 504, because
 * either could mean the request reached a live gateway that is still running
 * the sync server-side, and releasing the cooldown there risks stacking a
 * second real sync on top of the first — those keep the immediate-post,
 * cooldown-stays-armed behavior. Ordinary (interval) ticks never get this
 * treatment: a failure there posts and keeps the cooldown armed
 * unconditionally, as before. `stopNightlyDbSyncScheduler` clears a pending
 * retry timer along with the scheduler's own timers.
 */

import { AttachmentBuilder, EmbedBuilder, type Client } from 'discord.js';
import type { Redis } from 'ioredis';
import { DISCORD_COLORS } from '@tzurot/common-types/constants/discord';
import { getConfig } from '@tzurot/common-types/config/config';
import { SYSTEM_SETTINGS_FALLBACKS } from '@tzurot/common-types/schemas/api/systemSettingsRegistry';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { escapeFenceBreaks } from '../utils/fenceEscape.js';
import { getOwnerClient } from '../utils/gatewayClients.js';
import { createIntervalScheduler } from '@tzurot/common-types/utils/intervalScheduler';
import { postOwnerChannelEmbed } from '../utils/ownerChannel.js';
import { isGatewayUnreachedFailure } from '../utils/gatewayNotReady.js';
import { createStartupRetry, STARTUP_RETRY_DELAY_MS } from '../utils/startupRetry.js';
import {
  buildSyncReportText,
  buildSyncSummary,
  hasSyncChanges,
  sumSyncCounters,
  type SyncResult,
} from '../utils/dbSyncSummary.js';

const logger = createLogger('nightly-db-sync');

/**
 * Tick cadence, NOT the sync cadence: the tick's only job is to notice that
 * the clock has entered the configured hour. Four ticks per hour keeps the
 * miss window small (a tick lost to a restart still leaves three chances) at
 * the cost of one cheap settings read per tick.
 */
const TICK_INTERVAL_MS = 15 * 60 * 1000;
const STARTUP_DELAY_MS = 60_000;
/**
 * At most one real sync per day, across restarts. Deliberately a little under
 * 24h so ordinary tick jitter can never make a scheduled run land inside its
 * own previous cooldown and skip a day; comfortably longer than the one-hour
 * window, so the extra ticks inside the matching hour are no-ops.
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

/** A single sync-cycle invocation's trigger — decides both the hour gate and the not-ready retry eligibility. */
type SyncTrigger = 'interval' | 'startup' | 'startup-retry';

const startupRetry = createStartupRetry();

const scheduler = createIntervalScheduler<[Client, Redis]>({
  intervalMs: TICK_INTERVAL_MS,
  startupDelayMs: STARTUP_DELAY_MS,
  logger,
  run: (client, redis) =>
    runNightlyDbSync(client, redis, startupRetry.consume() ? 'startup' : 'interval'),
});

/**
 * Start the daily sync (call once from the composition root). Refuses to start
 * without a configured owner id: every `/api/admin/*` call is gated on the
 * actor header matching it, so an unconfigured deployment could only ever
 * produce a daily rejection. Also refuses outside production — see the
 * prod-only note in the module docstring.
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
  if (getConfig().NODE_ENV !== 'production') {
    logger.info('Not a production environment — nightly db-sync scheduler disabled');
    return;
  }
  startupRetry.arm();
  scheduler.start(client, redis);
}

/** Stop the scheduler (graceful shutdown). Also clears a pending startup retry. */
export function stopNightlyDbSyncScheduler(): void {
  scheduler.stop();
  startupRetry.reset();
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
    .setDescription(buildSyncSummary(result, false, 'attachment'))
    .setFooter({ text: 'Full per-table report attached' })
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

/**
 * The tick's schedule gate: is this the configured hour, and is the job on at
 * all? Reads the live system-settings bag every tick (an owner toggling the
 * switch must take effect without a deploy) and falls back to the registry
 * constants for keys the bag has not seeded yet. Returns false — never syncs —
 * when the bag cannot be read: an unknown config is not a licence to write to
 * both databases.
 *
 * `checkHour` is false only for the startup-run deploy-window retry: the
 * startup run that scheduled it already passed the hour gate, so the day's
 * sync was due. The retry lands 5 minutes later and can cross the hour
 * boundary, and every later tick that day would then read as outside the
 * configured hour — skipping the retry's hour check is what keeps the day
 * from being lost to that timing accident. The enabled switch still applies
 * either way.
 */
async function shouldSyncThisTick(checkHour: boolean): Promise<boolean> {
  const settings = await getOwnerClient().getSystemSettings();
  if (!settings.ok) {
    logger.warn(
      { status: settings.status, error: settings.error },
      'System settings unreadable — skipping this nightly-sync tick'
    );
    return false;
  }

  const bag = settings.data.systemSettings;
  const enabled = bag.nightlySyncEnabled ?? SYSTEM_SETTINGS_FALLBACKS.nightlySyncEnabled;
  if (!enabled) {
    logger.debug('Nightly db-sync is disabled by system setting');
    return false;
  }

  if (!checkHour) {
    return true;
  }

  const hourUtc = bag.nightlySyncHourUtc ?? SYSTEM_SETTINGS_FALLBACKS.nightlySyncHourUtc;
  const currentHourUtc = new Date().getUTCHours();
  if (currentHourUtc !== hourUtc) {
    logger.debug({ currentHourUtc, hourUtc }, 'Outside the configured nightly-sync hour');
    return false;
  }

  return true;
}

/**
 * Releases the cooldown for the startup deploy-window retry. Returns false
 * when the release itself fails — a scheduled retry would only skip on a
 * cooldown that never got released anyway, so the caller treats that as an
 * ordinary failure instead of retrying.
 */
async function releaseCooldownForStartupRetry(
  redis: Redis,
  kind: string,
  status: number
): Promise<boolean> {
  try {
    await redis.del(COOLDOWN_KEY);
    return true;
  } catch (delError) {
    logger.warn(
      { err: delError, kind, status },
      'Could not release the cooldown for the startup retry — reporting the not-ready failure now instead'
    );
    return false;
  }
}

/** Exported for tests — one full sync cycle. */
export async function runNightlyDbSync(
  client: Client,
  redis: Redis,
  trigger: SyncTrigger = 'interval'
): Promise<void> {
  try {
    // Schedule gate BEFORE the cooldown: a tick outside the configured hour
    // must not arm the cooldown, or the first tick after boot would burn the
    // day's single run at whatever time the deploy happened to land. The
    // startup-retry trigger skips the hour check — see shouldSyncThisTick.
    if (!(await shouldSyncThisTick(trigger !== 'startup-retry'))) {
      return;
    }

    // Cooldown SECOND, and armed before the call — see the cadence note above.
    const cooling = await redis.get(COOLDOWN_KEY);
    if (cooling !== null) {
      logger.info({ since: cooling }, 'Nightly sync already ran within the cooldown window');
      return;
    }
    await redis.setex(COOLDOWN_KEY, SYNC_COOLDOWN_SECONDS, new Date().toISOString());

    const result = await getOwnerClient().dbSync(SCHEDULED_SYNC_OPTIONS);

    if (!result.ok) {
      if (trigger === 'startup' && isGatewayUnreachedFailure(result)) {
        // Release the cooldown this same run just armed — the retry re-arms
        // it on its own attempt, so a concurrent 15-minute tick sees the
        // cooldown and skips instead of stacking a second sync (pinned by
        // "a tick overlapping the retry skips on the cooldown"). If a stop
        // lands while this call is still in flight, the release still
        // happens and no retry re-arms it — intended, since the sync did not
        // run and the next process start runs it normally (pinned by "a stop
        // that lands while the startup dbSync call is still in flight wins —
        // no retry arms after").
        const cooldownReleased = await releaseCooldownForStartupRetry(
          redis,
          result.kind,
          result.status
        );
        if (cooldownReleased) {
          logger.warn(
            {
              kind: result.kind,
              status: result.status,
              error: result.error,
              retryInMs: STARTUP_RETRY_DELAY_MS,
            },
            'Gateway not ready on the startup nightly sync — released the cooldown, retrying once before alerting'
          );
          startupRetry.schedule(() => runNightlyDbSync(client, redis, 'startup-retry'));
          return;
        }
      }
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

    // The embed carries only totals and active tables; the unattended run has
    // no "Show details" button to fall back on, so the full report ships as a
    // file alongside it.
    const reportText = buildSyncReportText(result.data, false);
    await postOwnerChannelEmbed(client, buildNightlySyncEmbed(result.data, rowsMoved), [
      new AttachmentBuilder(Buffer.from(reportText, 'utf-8'), {
        name: 'nightly-db-sync-report.md',
        description: 'Full nightly db-sync report',
      }),
    ]);
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
