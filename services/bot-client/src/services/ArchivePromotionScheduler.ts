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
 */

import { EmbedBuilder, type Client } from 'discord.js';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { createIntervalScheduler } from '@tzurot/common-types/utils/intervalScheduler';
import type { MemoryArchivePromotion } from '@tzurot/common-types/schemas/api/memoryArchive';
import { getOwnerClient } from '../utils/gatewayClients.js';
import { postOwnerChannelEmbed } from '../utils/ownerChannel.js';
import { cappedInlineField, clampEmbedText, EMBED_CAPS } from '../utils/embedLimits.js';

const logger = createLogger('archive-promotion');

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const STARTUP_DELAY_MS = 60_000;
/** Discord's embed field cap (no shared `DISCORD_LIMITS` entry for field COUNT, only per-field size). */
const MAX_PROMOTION_FIELDS = 25;

const scheduler = createIntervalScheduler<[Client]>({
  intervalMs: CHECK_INTERVAL_MS,
  startupDelayMs: STARTUP_DELAY_MS,
  logger,
  run: client => runArchivePromotionCheck(client),
});

/** Start the six-hourly check (call once from the composition root). */
export function startArchivePromotionScheduler(client: Client): void {
  scheduler.start(client);
}

/** Stop the scheduler (graceful shutdown). */
export function stopArchivePromotionScheduler(): void {
  scheduler.stop();
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
export async function runArchivePromotionCheck(client: Client): Promise<void> {
  try {
    const result = await getOwnerClient().memoryArchivePromote({});
    if (!result.ok) {
      logger.warn({ error: result.error }, 'Archive promotion check failed');
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
