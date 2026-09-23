/**
 * Memory-archive auto-promotion check scheduler.
 *
 * Six-hourly poke of `POST /api/admin/memory-archive/promote` — the gateway
 * does the real work (evaluating every personality's summary coverage
 * against the flip gate and promoting anyone ready); this scheduler exists
 * only to trigger it periodically and report what moved.
 *
 * NO cooldown, unlike the other owner-channel schedulers in this directory:
 * the endpoint is idempotent (a personality already on both render lists is
 * `skipped.alreadyListed`, never re-promoted) and this scheduler posts an
 * embed ONLY when something was actually promoted, so a restart-triggered
 * extra run is silent — there is no expensive or user-visible action a
 * cooldown would need to gate. bot-client runs as a single replica; if it
 * ever ran several, each would fire the six-hourly check and the
 * optimistic-concurrency guards are expected to serialize the writes (pinned
 * single-process by MEM-ARCH-036, not verified across replicas), at the
 * cost of duplicate work and possibly a second owner-channel embed for the
 * same batch.
 *
 * NOT production-gated, unlike `RetentionRunScheduler`: the promotion
 * decision reads dev's own `system_settings` and `memories` rows, which are
 * real per-environment state (not a rehearsal of prod), so a dev-side
 * promotion is a real, useful signal rather than noise.
 *
 * The startup run (fired ~60s after container start by `createIntervalScheduler`)
 * lands in a deploy window where the gateway may still be running: this
 * scheduler's own service (bot-client) restarted, but the gateway might not
 * have finished its own rollover yet. During that window the gateway can be
 * the OLD build (missing this route → 404) or mid-rollover (no listener yet →
 * a transport error, or a fronting proxy answering 502/503/504) — none of
 * that is a real promotion-check failure, just bad timing. So the startup run
 * treats a not-ready failure specially: it logs and retries once, after a
 * fixed delay, instead of alerting immediately. The retry runs as an ordinary
 * (non-startup) check, so ANY failure on it — not-ready or otherwise — posts
 * the failure embed like normal. The six-hourly runs never get this
 * treatment: by then the gateway has had hours to finish deploying, so a
 * failure there is real. `stop()` clears a pending retry timer along with the
 * scheduler's own timers, so a shutdown mid-retry-window doesn't leave a
 * stray check firing after the scheduler was told to stop. Every behavior
 * claim here is pinned by a test in `ArchivePromotionScheduler.test.ts`.
 */

import { EmbedBuilder, type Client } from 'discord.js';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { createIntervalScheduler } from '@tzurot/common-types/utils/intervalScheduler';
import type { MemoryArchivePromotion } from '@tzurot/common-types/schemas/api/memoryArchive';
import { getOwnerClient } from '../utils/gatewayClients.js';
import { postOwnerChannelEmbed } from '../utils/ownerChannel.js';
import { cappedInlineField, clampEmbedText, EMBED_CAPS } from '../utils/embedLimits.js';
import { isGatewayNotReadyFailure } from '../utils/gatewayNotReady.js';
import { createStartupRetry, STARTUP_RETRY_DELAY_MS } from '../utils/startupRetry.js';

const logger = createLogger('archive-promotion');

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const STARTUP_DELAY_MS = 60_000;
/** Discord's embed field cap (no shared `DISCORD_LIMITS` entry for field COUNT, only per-field size). */
const MAX_PROMOTION_FIELDS = 25;

const startupRetry = createStartupRetry();

const scheduler = createIntervalScheduler<[Client]>({
  intervalMs: CHECK_INTERVAL_MS,
  startupDelayMs: STARTUP_DELAY_MS,
  logger,
  run: client => runArchivePromotionCheck(client, { isStartupRun: startupRetry.consume() }),
});

/** Start the six-hourly check (call once from the composition root). */
export function startArchivePromotionScheduler(client: Client): void {
  startupRetry.arm();
  scheduler.start(client);
}

/** Stop the scheduler (graceful shutdown). Also clears a pending startup retry. */
export function stopArchivePromotionScheduler(): void {
  scheduler.stop();
  startupRetry.reset();
}

/** Builds the "N promoted" embed, capping fields at Discord's per-embed limit. */
function buildPromotionEmbed(promoted: MemoryArchivePromotion[]): EmbedBuilder {
  const rendered = promoted.slice(0, MAX_PROMOTION_FIELDS);
  const omitted = promoted.length - rendered.length;
  const fields = rendered.map(promotion =>
    cappedInlineField(
      promotion.slug,
      `${(promotion.coverage * 100).toFixed(1)}% coverage · split-render: ${String(promotion.writes.archiveSplitRender)} · digest: ${String(promotion.writes.recentDaysDigest)} · render-mode: ${String(promotion.writes.renderMode)}`
    )
  );

  const embed = new EmbedBuilder()
    .setTitle(`📈 Memory archive: ${String(promoted.length)} promoted`)
    .addFields(fields)
    .setTimestamp();

  if (omitted > 0) {
    embed.setDescription(clampEmbedText(`…and ${String(omitted)} more.`, EMBED_CAPS.description));
  }

  return embed;
}

/** Builds a failure embed for a request-level or endpoint-level failure. */
function buildFailureEmbed(reason: string): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle('🧯 Memory archive promotion check failed')
    .setDescription(clampEmbedText(reason, EMBED_CAPS.description))
    .setTimestamp();
}

/** Exported for tests — one full check cycle. */
export async function runArchivePromotionCheck(
  client: Client,
  options: { isStartupRun?: boolean } = {}
): Promise<void> {
  try {
    const result = await getOwnerClient().memoryArchivePromote({});
    if (!result.ok) {
      if (options.isStartupRun === true && isGatewayNotReadyFailure(result)) {
        // Deliberately broader than the nightly sync and export smoke, which use
        // isGatewayUnreachedFailure: a client timeout or a 504 here may mean the
        // first request already ran the promotion, but a retry is harmless
        // because the promote endpoint is idempotent (see the module header).
        logger.warn(
          {
            kind: result.kind,
            status: result.status,
            error: result.error,
            retryInMs: STARTUP_RETRY_DELAY_MS,
          },
          'Gateway not ready on the startup promotion check — retrying once before alerting'
        );
        // Runs outside the interval scheduler's in-flight guard, so an overlap
        // with the six-hourly run would need a tick to land inside this retry's
        // window — it fires STARTUP_DELAY_MS + STARTUP_RETRY_DELAY_MS after
        // start, far below CHECK_INTERVAL_MS.
        startupRetry.schedule(() => runArchivePromotionCheck(client));
        return;
      }
      logger.warn(
        { kind: result.kind, status: result.status, error: result.error },
        'Archive promotion check failed'
      );
      await postOwnerChannelEmbed(client, buildFailureEmbed(result.error));
      return;
    }

    if (!result.data.enabled) {
      logger.info('Archive promotion is disabled (archivePromotionEnabled is off)');
      return;
    }

    if (result.data.promoted.length === 0) {
      logger.info(
        { evaluated: result.data.evaluated },
        'Archive promotion check: nothing to promote'
      );
      return;
    }

    await postOwnerChannelEmbed(client, buildPromotionEmbed(result.data.promoted));
  } catch (error) {
    logger.warn({ err: error }, 'Archive promotion check failed');
    await postOwnerChannelEmbed(
      client,
      buildFailureEmbed(error instanceof Error ? error.message : 'unknown error')
    );
  }
}
