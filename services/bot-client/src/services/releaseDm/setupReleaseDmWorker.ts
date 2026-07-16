/**
 * Release-broadcast DM worker — bot-client's BullMQ consumer for the
 * release-broadcast queue (api-gateway produces the batches).
 *
 * Delivery discipline:
 *   - Re-filters the batch against the gateway's delivery ledger before
 *     sending (pending-only), so a stalled-and-rerun batch never double-DMs.
 *   - Sends sequentially with a 1/sec injected sleep between DMs — the
 *     StartupDMPrewarmer precedent: background sends must not head-of-line
 *     block the shared discord.js REST queue.
 *   - Classifies failures (dmErrorClassifier) and reports every outcome to
 *     the gateway ledger; permanent failures never retry.
 */

import { Worker, type Job } from 'bullmq';
import type { Client } from 'discord.js';
import { getConfig } from '@tzurot/common-types/config/config';
import { RELEASE_BROADCAST_QUEUE_NAME } from '@tzurot/common-types/constants/queue';
import { TIMEOUTS } from '@tzurot/common-types/constants/timing';
import {
  releaseBroadcastDmJobDataSchema,
  type ReleaseBroadcastDmJobData,
  type ReleaseBroadcastRecipient,
} from '@tzurot/common-types/types/jobs';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { parseRedisUrl, createBullMQRedisConfig } from '@tzurot/common-types/utils/redis';
import { classifyDmError, dmErrorCode } from '../../utils/dmErrorClassifier.js';
import {
  filterPendingDeliveries,
  reportDeliveries,
  type DeliveryReport,
} from '../../utils/gatewayServiceCalls.js';
import { OPT_OUT_FOOTER } from './releaseDmContext.js';

const logger = createLogger('ReleaseDmWorker');

/** Inter-DM delay — mirrors StartupDMPrewarmer's REST-queue-friendly pacing. */
const DM_SEND_DELAY_MS = 1000;

export interface ReleaseDmWorkerDeps {
  client: Client;
  /** Injectable for fake-timer tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable ledger seams for tests (default: real gateway calls). */
  filterPending?: typeof filterPendingDeliveries;
  report?: typeof reportDeliveries;
}

const defaultSleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/** Send one DM; returns the ledger outcome. */
async function sendOne(
  client: Client,
  discordUserId: string,
  body: string
): Promise<{ status: DeliveryReport['status']; errorCode?: string }> {
  try {
    const user = await client.users.fetch(discordUserId);
    await user.send({
      content: body + OPT_OUT_FOOTER,
      allowedMentions: { parse: [] },
    });
    return { status: 'sent' };
  } catch (error) {
    const classified = classifyDmError(error);
    logger.warn(
      { userId: discordUserId, kind: classified.kind, code: dmErrorCode(classified) },
      'Broadcast DM failed'
    );
    return {
      status: classified.kind === 'permanent' ? 'failed_permanent' : 'failed_transient',
      errorCode: dmErrorCode(classified),
    };
  }
}

/** The processor body — exported for direct seam-testing without a real queue. */
export function createReleaseDmProcessor(deps: ReleaseDmWorkerDeps) {
  const sleep = deps.sleep ?? defaultSleep;
  const filterPending = deps.filterPending ?? filterPendingDeliveries;
  const report = deps.report ?? reportDeliveries;

  return async (job: Job): Promise<{ sent: number; failed: number; skipped: number }> => {
    const parsed = releaseBroadcastDmJobDataSchema.safeParse(job.data);
    if (!parsed.success) {
      // Fail-to-skip: a malformed payload can never succeed on retry.
      logger.error({ jobId: job.id, issues: parsed.error.issues }, 'Invalid broadcast payload');
      return { sent: 0, failed: 0, skipped: 0 };
    }
    const data: ReleaseBroadcastDmJobData = parsed.data;

    const pendingIds = new Set(
      await filterPending(
        data.releaseId,
        data.recipients.map(recipient => recipient.deliveryLogId)
      )
    );
    const toSend: ReleaseBroadcastRecipient[] = data.recipients.filter(recipient =>
      pendingIds.has(recipient.deliveryLogId)
    );
    const skipped = data.recipients.length - toSend.length;

    const results: DeliveryReport[] = [];
    for (let i = 0; i < toSend.length; i++) {
      const recipient = toSend[i];
      const outcome = await sendOne(deps.client, recipient.discordUserId, data.body);
      const entry: DeliveryReport = { deliveryLogId: recipient.deliveryLogId, ...outcome };
      results.push(entry);
      // Report EACH outcome immediately: a mid-batch crash then leaves at most
      // ONE sent-but-unreported row for the stall-rerun to re-DM, instead of
      // the whole batch (the ledger, not this process, is the source of truth).
      await report(data.releaseId, [entry]);
      if (i < toSend.length - 1) {
        await sleep(DM_SEND_DELAY_MS);
      }
    }

    const sent = results.filter(result => result.status === 'sent').length;
    const failed = results.length - sent;
    logger.info(
      { releaseId: data.releaseId, version: data.version, sent, failed, skipped },
      'Broadcast batch processed'
    );
    return { sent, failed, skipped };
  };
}

/** Construct (but don't start-gate) the worker; caller owns close(). */
export function setupReleaseDmWorker(deps: ReleaseDmWorkerDeps): Worker {
  const config = getConfig();
  if (config.REDIS_URL === undefined || config.REDIS_URL.length === 0) {
    throw new Error('REDIS_URL environment variable is required');
  }
  const connection = createBullMQRedisConfig(parseRedisUrl(config.REDIS_URL));

  const worker = new Worker(RELEASE_BROADCAST_QUEUE_NAME, createReleaseDmProcessor(deps), {
    connection,
    // Sequential batches: a blast is background work, and the per-DM sleep
    // does the real pacing.
    concurrency: 1,
    lockDuration: TIMEOUTS.WORKER_LOCK_DURATION,
    // One stall-recovery re-run for deploy-killed batches; the pending-filter
    // makes the re-run spend-safe (no double-DMs).
    maxStalledCount: 1,
  });

  worker.on('failed', (job, err) => {
    logger.warn({ jobId: job?.id, err }, 'Broadcast batch failed (BullMQ will retry)');
  });
  // Stall = lock expired because the owning process died (deploy/crash);
  // BullMQ re-queues the batch — the pending-filter absorbs the overlap.
  worker.on('stalled', (jobId: string) => {
    logger.warn({ jobId }, 'Broadcast batch stalled (owning process died) — re-queued');
  });
  worker.on('error', err => {
    logger.error({ err }, 'Release DM worker error');
  });

  return worker;
}
