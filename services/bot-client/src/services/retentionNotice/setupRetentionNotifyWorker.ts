/**
 * Retention warning-DM worker — bot-client's BullMQ consumer for the
 * retention-notify queue (api-gateway produces the batches; Phase 3).
 *
 * Delivery discipline mirrors the release-DM worker:
 *   - Re-filters the batch against the notify predicate before sending
 *     (a user active since cohort resolution must not get a deletion
 *     warning; a stalled-and-rerun batch never double-DMs).
 *   - Sends sequentially, 1/sec pacing — background sends must not
 *     head-of-line block the shared discord.js REST queue.
 *   - Classifies failures (dmErrorClassifier) and reports EACH outcome
 *     immediately: sent → the grace clock; a permanent bounce → the
 *     unreachable stamp that re-routes the user to the purge branch;
 *     bot-level (20026, dev quarantine) and transient → no stamp.
 *   - Posts a per-batch owner-channel tally — the operator's CLI returns at
 *     enqueue time, so this embed is where delivery results surface.
 */

import { Worker, type Job } from 'bullmq';
import { EmbedBuilder, type Client } from 'discord.js';
import { getConfig } from '@tzurot/common-types/config/config';
import { DISCORD_COLORS } from '@tzurot/common-types/constants/discord';
import { RETENTION_NOTIFY_QUEUE_NAME } from '@tzurot/common-types/constants/queue';
import { TIMEOUTS } from '@tzurot/common-types/constants/timing';
import {
  retentionNotifyDmJobDataSchema,
  type RetentionNotifyRecipient,
} from '@tzurot/common-types/types/jobs';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { parseRedisUrl, createBullMQRedisConfig } from '@tzurot/common-types/utils/redis';
import { classifyDmError, dmErrorCode } from '../../utils/dmErrorClassifier.js';
import {
  filterNotifyEligible,
  reportNotifyOutcomes,
  type NotifyOutcomeReport,
} from '../../utils/gatewayServiceCalls.js';
import { postOwnerChannelEmbed } from '../../utils/ownerChannel.js';
import { buildRetentionNotice, RETENTION_NOTICE_FOOTER } from './noticeContent.js';

const logger = createLogger('RetentionNotifyWorker');

/** Inter-DM delay — the same REST-queue-friendly pacing as the release worker. */
const DM_SEND_DELAY_MS = 1000;

/** Classified failure kind → report status (bot_level is its own terminal outcome). */
const OUTCOME_STATUS_BY_KIND = {
  permanent: 'failed_permanent',
  bot_level: 'failed_bot_level',
  transient: 'failed_transient',
} as const satisfies Record<
  ReturnType<typeof classifyDmError>['kind'],
  NotifyOutcomeReport['status']
>;

export interface RetentionNotifyWorkerDeps {
  client: Client;
  /** Injectable for fake-timer tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable gateway seams for tests (default: real calls). */
  filterEligible?: typeof filterNotifyEligible;
  report?: typeof reportNotifyOutcomes;
}

const defaultSleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/** Send one warning DM; returns the report outcome. */
async function sendOne(
  client: Client,
  recipient: RetentionNotifyRecipient,
  sentAt: Date
): Promise<Omit<NotifyOutcomeReport, 'userId'>> {
  try {
    const user = await client.users.fetch(recipient.discordUserId);
    await user.send({
      content: buildRetentionNotice(sentAt) + RETENTION_NOTICE_FOOTER,
      allowedMentions: { parse: [] },
    });
    return { status: 'sent' };
  } catch (error) {
    const classified = classifyDmError(error);
    logger.warn(
      { userId: recipient.userId, kind: classified.kind, code: dmErrorCode(classified) },
      'Retention notice DM failed'
    );
    return { status: OUTCOME_STATUS_BY_KIND[classified.kind], errorCode: dmErrorCode(classified) };
  }
}

/** The processor body — exported for direct seam-testing without a real queue. */
export function createRetentionNotifyProcessor(deps: RetentionNotifyWorkerDeps) {
  const sleep = deps.sleep ?? defaultSleep;
  const filterEligible = deps.filterEligible ?? filterNotifyEligible;
  const report = deps.report ?? reportNotifyOutcomes;

  return async (job: Job): Promise<{ sent: number; bounced: number; skipped: number }> => {
    const parsed = retentionNotifyDmJobDataSchema.safeParse(job.data);
    if (!parsed.success) {
      // Fail-to-skip: a malformed payload can never succeed on retry.
      logger.error({ jobId: job.id, issues: parsed.error.issues }, 'Invalid notify payload');
      return { sent: 0, bounced: 0, skipped: 0 };
    }
    const data = parsed.data;

    // Throws on gateway failure — BEFORE any spend, so BullMQ's retry re-runs
    // the whole batch rather than completing it silently undelivered.
    const eligibleIds = new Set(
      await filterEligible(data.recipients.map(recipient => recipient.userId))
    );
    const toSend = data.recipients.filter(recipient => eligibleIds.has(recipient.userId));
    const skipped = data.recipients.length - toSend.length;

    let sent = 0;
    let bounced = 0;
    // One anchor per batch: with 1/sec pacing a batch straddling midnight
    // would otherwise show different deletion DATES within the same run.
    const sentAt = new Date();
    for (let i = 0; i < toSend.length; i++) {
      const recipient = toSend[i];
      const outcome = await sendOne(deps.client, recipient, sentAt);
      // Report EACH outcome immediately. Nothing after the send can THROW
      // (sendOne catches, report retries-then-swallows), so the only mid-batch
      // interruption is process death: a stall re-run then re-sends at most
      // ONE sent-but-unstamped recipient (at-least-once, the accepted model).
      // Everyone reported with a TERMINAL outcome (sent / permanent bounce) is
      // dropped by the pre-send filter; bot-level and transient failures are
      // un-stamped by design and correctly ride the re-run — no DM reached them.
      await report([{ userId: recipient.userId, ...outcome }]);
      if (outcome.status === 'sent') {
        sent += 1;
      } else if (outcome.status === 'failed_permanent') {
        bounced += 1;
      }
      if (i < toSend.length - 1) {
        await sleep(DM_SEND_DELAY_MS);
      }
    }

    logger.info({ runId: data.runId, sent, bounced, skipped }, 'Retention notify batch processed');
    await postBatchReport(deps.client, { sent, bounced, skipped, total: toSend.length });
    return { sent, bounced, skipped };
  };
}

/**
 * Per-batch owner-channel tally (best-effort — the helper swallows failures).
 * Bounced users are the cohort-discovery yield: they just became purge-eligible.
 */
async function postBatchReport(
  client: Client,
  tally: { sent: number; bounced: number; skipped: number; total: number }
): Promise<void> {
  const failedOtherwise = tally.total - tally.sent - tally.bounced;
  const embed = new EmbedBuilder()
    .setColor(DISCORD_COLORS.BLURPLE)
    .setTitle('📪 Retention notice batch delivered')
    .setDescription(
      `${String(tally.sent)} warned (grace clock started), ` +
        `${String(tally.bounced)} bounced (now purge-eligible as unreachable), ` +
        `${String(failedOtherwise)} failed without a stamp, ` +
        `${String(tally.skipped)} skipped (active again or already warned)`
    )
    .setTimestamp();
  await postOwnerChannelEmbed(client, embed);
}

/** Construct (but don't start-gate) the worker; caller owns close(). */
export function setupRetentionNotifyWorker(deps: RetentionNotifyWorkerDeps): Worker {
  const config = getConfig();
  if (config.REDIS_URL === undefined || config.REDIS_URL.length === 0) {
    throw new Error('REDIS_URL environment variable is required');
  }
  const connection = createBullMQRedisConfig(parseRedisUrl(config.REDIS_URL));

  const worker = new Worker(RETENTION_NOTIFY_QUEUE_NAME, createRetentionNotifyProcessor(deps), {
    connection,
    // Sequential batches: notices are background work; the per-DM sleep paces.
    concurrency: 1,
    lockDuration: TIMEOUTS.WORKER_LOCK_DURATION,
    // One stall-recovery re-run for deploy-killed batches; the pre-send
    // filter makes the re-run spend-safe (no double-DMs).
    maxStalledCount: 1,
  });

  worker.on('failed', (job, err) => {
    logger.warn({ jobId: job?.id, err }, 'Notify batch failed (BullMQ will retry)');
  });
  worker.on('stalled', (jobId: string) => {
    logger.warn({ jobId }, 'Notify batch stalled (owning process died) — re-queued');
  });
  worker.on('error', err => {
    logger.error({ err }, 'Retention notify worker error');
  });

  return worker;
}
