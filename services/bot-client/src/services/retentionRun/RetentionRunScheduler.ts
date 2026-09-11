/**
 * Retention job scheduler — the ONE scheduler for the retention job's three
 * mutually-exclusive modes, chosen fresh on every tick:
 *
 * | Mode      | When                                              | What it does                                                                 |
 * | --------- | -------------------------------------------------- | ----------------------------------------------------------------------------- |
 * | `live`    | production AND `RETENTION_AUTORUN_ENABLED`          | Runs the daily notify + purge unattended (retentionLiveRun.ts), posts a run report |
 * | `nag`     | production AND kill switch off                      | Report-only: posts the purge-eligibility nag, purges nothing (retentionNag.ts) |
 * | `rehearsal` | anywhere NOT production                           | Dry-runs notify, reports what a live run here would start from (retentionRehearsal.ts) |
 *
 * Live and nag never run outside production, for the same reason the nag
 * always excluded dev: the dev database mirrors prod's users via db-sync, so
 * a dev-side live run's purge would tombstone `users` rows that propagate
 * straight back to prod at the next nightly sync — no dev-specific signal,
 * real dev-side blast radius. The gateway's purge scope already confines a
 * dev purge to `OUTBOUND_DM_ALLOWLIST` (see purgeScope.ts); this scheduler
 * adds a second, independent refusal by never calling `executeLiveRun`
 * outside production at all.
 *
 * Cadence: hourly tick, restart-friendly — bot-client restarts on every
 * deploy, and a restart only makes the check fire more often, never less. A
 * 60s startup delay lets the rest of boot finish first.
 */

import type { Client } from 'discord.js';
import type { Redis } from 'ioredis';
import { getConfig } from '@tzurot/common-types/config/config';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { createIntervalScheduler } from '@tzurot/common-types/utils/intervalScheduler';
import { getServiceClient } from '../../utils/gatewayClients.js';
import { postOwnerChannelEmbed } from '../../utils/ownerChannel.js';
import { beginRetentionRunLease, releaseRetentionRunLease } from './retentionRunLease.js';
import { executeLiveRun, LIVE_RUN_CONTEXT } from './retentionLiveRun.js';
import { shouldReportLiveRun, buildLiveRunEmbed, summarizeLiveRun } from './retentionRunReport.js';
import { replayPendingReport, stashUndeliveredReport } from './retentionPendingReport.js';
import { runRetentionNagCheck } from './retentionNag.js';
import { runRetentionRehearsal } from './retentionRehearsal.js';
import type { LiveRunOutcome } from './types.js';

const logger = createLogger('retention-run');

const TICK_INTERVAL_MS = 60 * 60 * 1000;
const STARTUP_DELAY_MS = 60_000;

/**
 * 23h, not 24h — mirrors `NightlyDbSyncScheduler`'s reasoning: a little under
 * a day so tick jitter never lands a run inside its own previous cooldown
 * and skips a day.
 */
const LIVE_COOLDOWN_SECONDS = 23 * 60 * 60;
const LIVE_COOLDOWN_KEY = 'retention-run:cooldown';

export type RetentionRunMode = 'live' | 'nag' | 'rehearsal';

/** Which mode this tick runs in. Called fresh every tick — never cached. */
export function resolveRetentionRunMode(): RetentionRunMode {
  const config = getConfig();
  if (config.NODE_ENV !== 'production') {
    return 'rehearsal';
  }
  return config.RETENTION_AUTORUN_ENABLED ? 'live' : 'nag';
}

const scheduler = createIntervalScheduler<[Client, Redis]>({
  intervalMs: TICK_INTERVAL_MS,
  startupDelayMs: STARTUP_DELAY_MS,
  logger,
  run: (client, redis) => runRetentionTick(client, redis),
});

/** Start the hourly retention job tick (call once from the composition root). */
export function startRetentionRunScheduler(client: Client, redis: Redis): void {
  logger.info({ mode: resolveRetentionRunMode() }, 'Starting retention job scheduler');
  scheduler.start(client, redis);
}

/** Stop the scheduler (graceful shutdown). */
export function stopRetentionRunScheduler(): void {
  scheduler.stop();
}

/**
 * One tick: resolve the mode fresh, dispatch to it, and swallow anything it
 * throws — the interval scheduler fires this unawaited, so a rejection here
 * would surface as an unhandled rejection.
 */
export async function runRetentionTick(client: Client, redis: Redis): Promise<void> {
  const mode = resolveRetentionRunMode();
  try {
    if (mode === 'rehearsal') {
      await runRetentionRehearsal(client, redis);
      return;
    }
    if (mode === 'nag') {
      // A report stashed by a live run before the kill switch was flipped off
      // still has to reach the owner channel; nag mode never writes the
      // stash itself, so replay is the only path back to delivery.
      await replayPendingReport(client, redis);
      await runRetentionNagCheck(client, redis);
      return;
    }
    await runLiveTick(client, redis);
  } catch (error) {
    logger.warn({ err: error, mode }, 'Retention job tick failed');
  }
}

async function reportLiveRun(client: Client, redis: Redis, outcome: LiveRunOutcome): Promise<void> {
  if (!shouldReportLiveRun(outcome)) {
    logger.info(summarizeLiveRun(outcome), 'Quiet retention run — nothing to report');
    return;
  }
  const embed = buildLiveRunEmbed(outcome);
  const delivered = await postOwnerChannelEmbed(client, embed);
  logger.info({ ...summarizeLiveRun(outcome), delivered }, 'Retention run report');
  if (!delivered) {
    await stashUndeliveredReport(redis, embed, outcome);
  }
}

/**
 * The live-run tick: pre-run preview → take the run lease → arm the cooldown
 * → run notify/purge/reconcile → release the lease → report. Exported for
 * tests; dispatched to by `runRetentionTick` when the mode is `live`.
 */
export async function runLiveTick(client: Client, redis: Redis): Promise<void> {
  // Replay before the cooldown read so a stashed report gets retried on
  // every hourly tick during the cooldown window — which is exactly when no
  // new report will be generated to take its place.
  await replayPendingReport(client, redis);

  const cooling = await redis.get(LIVE_COOLDOWN_KEY);
  if (cooling !== null) {
    logger.debug('Retention live run is in cooldown');
    return;
  }

  const serviceClient = getServiceClient();
  const previewResult = await serviceClient.retentionPreview();
  if (!previewResult.ok) {
    logger.warn(
      { error: previewResult.error },
      'Retention preview fetch failed; skipping live run'
    );
    return;
  }
  const preview = previewResult.data;

  const begin = await beginRetentionRunLease(serviceClient, LIVE_RUN_CONTEXT);
  if (begin.kind === 'busy') {
    logger.info(
      { holder: begin.holder },
      'Retention run lease is held by another run; skipping this tick'
    );
    return;
  }
  if (begin.kind === 'failed') {
    logger.warn(
      { error: begin.error },
      'Failed to take the retention run lease; skipping this tick'
    );
    return;
  }

  const { runId } = begin;
  let outcome: LiveRunOutcome;
  try {
    // Armed once the run has started, whatever its outcome — a failing
    // gateway must not produce an hourly failure report — and BEFORE any
    // destructive call, so a crash mid-run still buys the next 23h of quiet.
    await redis.setex(LIVE_COOLDOWN_KEY, LIVE_COOLDOWN_SECONDS, new Date().toISOString());
    outcome = await executeLiveRun(serviceClient, runId, preview);
  } finally {
    await releaseRetentionRunLease(serviceClient, runId);
  }

  await reportLiveRun(client, redis, outcome);
}
