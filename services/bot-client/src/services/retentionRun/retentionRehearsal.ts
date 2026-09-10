/**
 * Retention job — rehearsal mode (non-production).
 *
 * Run by `RetentionRunScheduler` outside production: previews the cohort and
 * dry-runs notify, then reports what a live run here would have started from
 * — nothing is sent or deleted. Live retention runs are production-only (see
 * that module's mode table), so this is the only signal a dev/local
 * environment ever gets about the retention job's behavior.
 */

import type { Client } from 'discord.js';
import type { Redis } from 'ioredis';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { getServiceClient } from '../../utils/gatewayClients.js';
import { postOwnerChannelEmbed } from '../../utils/ownerChannel.js';
import { callRetentionNotify } from './retentionLiveRun.js';
import { buildRehearsalEmbed, shouldReportRehearsal } from './retentionRunReport.js';

const logger = createLogger('retention-rehearsal');

export const REHEARSAL_RUN_CONTEXT = 'job:retention-rehearsal';

/** At most one rehearsal report per week, across restarts. */
const REHEARSAL_COOLDOWN_SECONDS = 7 * 24 * 60 * 60;
const REHEARSAL_COOLDOWN_KEY = 'retention-rehearsal:cooldown';

/**
 * One rehearsal cycle. Never calls `retentionRunBegin`, `retentionRunEnd`,
 * `retentionPurge`, `retentionReconcileOffDb`, or a notify without
 * `dryRun: true` — this mode reads and reports only. May throw; the
 * scheduler's tick wrapper is what swallows errors, not this function.
 */
export async function runRetentionRehearsal(client: Client, redis: Redis): Promise<void> {
  const cooling = await redis.get(REHEARSAL_COOLDOWN_KEY);
  if (cooling !== null) {
    logger.debug('Retention rehearsal is in cooldown');
    return;
  }

  const serviceClient = getServiceClient();
  const previewResult = await serviceClient.retentionPreview();
  if (!previewResult.ok) {
    logger.warn(
      { error: previewResult.error },
      'Retention preview fetch failed; skipping rehearsal'
    );
    return;
  }
  const preview = previewResult.data;

  const notify = await callRetentionNotify(serviceClient, {
    dryRun: true,
    runContext: REHEARSAL_RUN_CONTEXT,
  });

  if (!shouldReportRehearsal(preview, notify)) {
    // A completed quiet rehearsal still waits out the week — logged, not posted.
    await redis.setex(REHEARSAL_COOLDOWN_KEY, REHEARSAL_COOLDOWN_SECONDS, new Date().toISOString());
    logger.info({ eligibleCount: preview.totals.eligibleCount }, 'Quiet retention rehearsal');
    return;
  }

  const delivered = await postOwnerChannelEmbed(
    client,
    buildRehearsalEmbed(preview, notify, REHEARSAL_RUN_CONTEXT)
  );
  if (delivered) {
    await redis.setex(REHEARSAL_COOLDOWN_KEY, REHEARSAL_COOLDOWN_SECONDS, new Date().toISOString());
    logger.info({ eligibleCount: preview.totals.eligibleCount }, 'Posted retention rehearsal');
  } else {
    logger.warn(
      { eligibleCount: preview.totals.eligibleCount },
      'Retention rehearsal embed was not delivered; will retry next tick'
    );
  }
}
