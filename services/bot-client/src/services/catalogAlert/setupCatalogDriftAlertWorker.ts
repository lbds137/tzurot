/**
 * Catalog-drift alert worker — bot-client's BullMQ consumer for the
 * catalog-drift-alert queue. api-gateway's CatalogDriftChecker produces one
 * batched job per catalog-refresh cycle with newly-detected drift; this
 * worker renders the whole batch as ONE owner-channel embed naming each
 * drifted config and its missing model id, truncated at Discord's 25-field
 * embed cap with a closing pointer to the api-gateway logs.
 *
 * Silent no-op when FEEDBACK_CHANNEL_ID is unset — `postOwnerChannelEmbed`
 * degrades on its own, so the worker needs no extra guard.
 *
 * Delivery discipline mirrors the retention-notice worker: payload passes the
 * shared schema's safeParse gate before anything is posted (fail-to-skip on a
 * malformed payload — it can never succeed on retry), and the post is
 * best-effort (the checker's Redis sentinel already recorded the alert, so a
 * failed post loses the notification, not the dedup).
 */

import { Worker, type Job } from 'bullmq';
import { EmbedBuilder, escapeMarkdown, type Client } from 'discord.js';
import { getConfig } from '@tzurot/common-types/config/config';
import { DISCORD_COLORS } from '@tzurot/common-types/constants/discord';
import { CATALOG_DRIFT_ALERT_QUEUE_NAME } from '@tzurot/common-types/constants/queue';
import { TIMEOUTS } from '@tzurot/common-types/constants/timing';
import {
  catalogDriftAlertJobDataSchema,
  type CatalogDriftEntry,
} from '@tzurot/common-types/types/jobs';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { parseRedisUrl, createBullMQRedisConfig } from '@tzurot/common-types/utils/redis';
import { postOwnerChannelEmbed } from '../../utils/ownerChannel.js';

const logger = createLogger('CatalogDriftAlertWorker');

/** Owner-facing label per configured role. */
const KIND_LABELS: Record<CatalogDriftEntry['kind'], string> = {
  default: 'global default',
  'free-default': 'free default',
  global: 'global preset',
};

/** Discord embed field-name cap — discord.js throws at build time over it. */
const MAX_FIELD_NAME_LENGTH = 256;

/** Discord embed field-value cap — same build-time validation as the name cap. */
const MAX_FIELD_VALUE_LENGTH = 1024;

/**
 * Discord caps ONE embed at 25 fields TOTAL (the batched job schema's 104
 * ceiling far exceeds it). @discordjs/builders' addFields throws over 25
 * cumulative fields, so the closing remainder field shares the budget: a
 * truncating batch renders 24 config fields + 1 remainder field.
 */
const MAX_EMBED_FIELDS = 25;

/**
 * One embed per job: each drift in the batch is a field naming the config
 * and its missing model id; past the 25-field cap the listing truncates and
 * a closing field points at the api-gateway logs for the rest. Exported for
 * the worker's seam tests.
 */
export function buildCatalogDriftEmbed(drifts: readonly CatalogDriftEntry[]): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle('⚠️ Configured model left the OpenRouter catalog')
    .setColor(DISCORD_COLORS.WARNING)
    .setDescription(
      `${String(drifts.length)} configured model id(s) no longer resolve against the OpenRouter catalog. ` +
        'Turns using them fall to the fallback chain until the config is re-pointed.'
    )
    .setTimestamp();
  // The remainder field rides inside the cap, so a truncating batch renders
  // one fewer config field than MAX_EMBED_FIELDS.
  const renderedDrifts =
    drifts.length > MAX_EMBED_FIELDS ? drifts.slice(0, MAX_EMBED_FIELDS - 1) : drifts;
  for (const drift of renderedDrifts) {
    embed.addFields({
      // Config names are admin-authored, but escaping is free hygiene and the
      // capped slice must apply to what is actually rendered.
      name: `${escapeMarkdown(drift.configName)} (${KIND_LABELS[drift.kind]})`.slice(
        0,
        MAX_FIELD_NAME_LENGTH
      ),
      // Slice the RAW id (backticks stripped — a stray one would break out of
      // the code span), reserving room for both backticks — slicing the
      // wrapped form would cut the closing backtick on an over-long id.
      value: `\`${drift.modelId.replaceAll('`', '').slice(0, MAX_FIELD_VALUE_LENGTH - 2)}\``,
      inline: true,
    });
  }
  const remainder = drifts.length - renderedDrifts.length;
  if (remainder > 0) {
    embed.addFields({
      name: 'Truncated list',
      value: `…and ${String(remainder)} more configs (full list in the api-gateway logs)`,
      inline: false,
    });
  }
  return embed;
}

export interface CatalogDriftAlertWorkerDeps {
  client: Client;
}

/** The processor body — exported for direct seam-testing without a real queue. */
export function createCatalogDriftAlertProcessor(deps: CatalogDriftAlertWorkerDeps) {
  return async (job: Job): Promise<{ posted: boolean; driftCount: number }> => {
    const parsed = catalogDriftAlertJobDataSchema.safeParse(job.data);
    if (!parsed.success) {
      // Fail-to-skip: a malformed payload can never succeed on retry.
      logger.error(
        { jobId: job.id, issues: parsed.error.issues },
        'Invalid catalog drift alert payload'
      );
      return { posted: false, driftCount: 0 };
    }
    const posted = await postOwnerChannelEmbed(
      deps.client,
      buildCatalogDriftEmbed(parsed.data.drifts)
    );
    logger.info(
      { jobId: job.id, driftCount: parsed.data.drifts.length, posted },
      'Catalog drift alert processed'
    );
    return { posted, driftCount: parsed.data.drifts.length };
  };
}

/**
 * Constructs the worker NOT running (`autorun: false`); the caller starts it
 * via `startWorkersOnClientReady` and owns close().
 */
export function setupCatalogDriftAlertWorker(deps: CatalogDriftAlertWorkerDeps): Worker {
  const config = getConfig();
  if (config.REDIS_URL === undefined || config.REDIS_URL.length === 0) {
    throw new Error('REDIS_URL environment variable is required');
  }
  const connection = createBullMQRedisConfig(parseRedisUrl(config.REDIS_URL));

  const worker = new Worker(
    CATALOG_DRIFT_ALERT_QUEUE_NAME,
    createCatalogDriftAlertProcessor(deps),
    {
      connection,
      // One embed per cycle — nothing here benefits from concurrency.
      concurrency: 1,
      lockDuration: TIMEOUTS.WORKER_LOCK_DURATION,
      // One stall-recovery re-run; a duplicate embed is the accepted
      // at-least-once cost, same trade as the retention worker.
      maxStalledCount: 1,
      // The worker is started by the ready gate once the Discord client is
      // ready; autorunning at construction would post with a token-less
      // client during boot.
      autorun: false,
    }
  );

  worker.on('failed', (job, err) => {
    logger.warn({ jobId: job?.id, err }, 'Catalog drift alert failed (BullMQ will retry)');
  });
  worker.on('stalled', (jobId: string) => {
    logger.warn({ jobId }, 'Catalog drift alert stalled (owning process died) — re-queued');
  });
  worker.on('error', err => {
    logger.error({ err }, 'Catalog drift alert worker error');
  });

  return worker;
}
