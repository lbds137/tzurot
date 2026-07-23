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
import { DiscordAPIError, EmbedBuilder, type Client, type User } from 'discord.js';
import { getConfig } from '@tzurot/common-types/config/config';
import { DISCORD_COLORS } from '@tzurot/common-types/constants/discord';
import { RELEASE_BROADCAST_QUEUE_NAME } from '@tzurot/common-types/constants/queue';
import { TIMEOUTS } from '@tzurot/common-types/constants/timing';
import type { BroadcastCompletionSummary } from '@tzurot/common-types/schemas/api/broadcast';
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
import { postOwnerChannelEmbed } from '../../utils/ownerChannel.js';
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

/** Discord "Unknown Message" — the previous DM is already gone; goal state reached. */
const UNKNOWN_MESSAGE_CODE = 10008;

/** Classified failure kind → ledger status. bot_level is its own terminal outcome. */
const DELIVERY_STATUS_BY_KIND = {
  permanent: 'failed_permanent',
  bot_level: 'failed_bot_level',
  transient: 'failed_transient',
} as const satisfies Record<ReturnType<typeof classifyDmError>['kind'], DeliveryReport['status']>;

/**
 * Best-effort delete of the user's prior release DM so the channel holds at
 * most one release note. Never blocks the send: a failure just leaves the
 * old DM standing (its ledger row stays un-stamped, so /notifications
 * cleanup — or the next blast — retries it).
 */
async function deletePreviousDm(user: User, messageId: string): Promise<boolean> {
  try {
    const dm = await user.createDM();
    await dm.messages.delete(messageId);
    return true;
  } catch (error) {
    if (error instanceof DiscordAPIError && error.code === UNKNOWN_MESSAGE_CODE) {
      return true;
    }
    logger.warn(
      { userId: user.id, err: error },
      'Failed to delete previous release DM — left standing for a later cleanup'
    );
    return false;
  }
}

/** Send one DM (deleting the recipient's prior release DM first); returns the ledger outcome. */
async function sendOne(
  client: Client,
  recipient: ReleaseBroadcastRecipient,
  body: string
): Promise<{
  status: DeliveryReport['status'];
  errorCode?: string;
  sentMessageId?: string;
  deletedPreviousDeliveryLogId?: string;
}> {
  // Survives the send's catch: a deletion that happened must reach the
  // ledger even when the subsequent send fails, or the next blast would
  // hand out an already-deleted previousDm (harmless — 10008 re-stamps —
  // but a wasted call and a misleading ledger in the interim).
  let deletedPreviousDeliveryLogId: string | undefined;
  try {
    const user = await client.users.fetch(recipient.discordUserId);

    if (recipient.previousDm !== undefined) {
      const deleted = await deletePreviousDm(user, recipient.previousDm.messageId);
      if (deleted) {
        deletedPreviousDeliveryLogId = recipient.previousDm.deliveryLogId;
      }
    }

    const sent = await user.send({
      content: body + OPT_OUT_FOOTER,
      allowedMentions: { parse: [] },
    });
    return { status: 'sent', sentMessageId: sent.id, deletedPreviousDeliveryLogId };
  } catch (error) {
    const classified = classifyDmError(error);
    logger.warn(
      { userId: recipient.discordUserId, kind: classified.kind, code: dmErrorCode(classified) },
      'Broadcast DM failed'
    );
    return {
      status: DELIVERY_STATUS_BY_KIND[classified.kind],
      errorCode: dmErrorCode(classified),
      deletedPreviousDeliveryLogId,
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
    let completionSummary: BroadcastCompletionSummary | undefined;
    for (let i = 0; i < toSend.length; i++) {
      const recipient = toSend[i];
      const outcome = await sendOne(deps.client, recipient, data.body);
      const entry: DeliveryReport = { deliveryLogId: recipient.deliveryLogId, ...outcome };
      results.push(entry);
      // Report EACH outcome immediately: a mid-batch crash then leaves at most
      // ONE sent-but-unreported row for the stall-rerun to re-DM, instead of
      // the whole batch (the ledger, not this process, is the source of truth).
      // Exactly one report across the whole blast flips the announcement to
      // completed and carries the final tally — capture it for the ops post.
      const reportOutcome = await report(data.releaseId, [entry]);
      if (reportOutcome?.completed === true && reportOutcome.summary !== undefined) {
        completionSummary = reportOutcome.summary;
      }
      if (i < toSend.length - 1) {
        await sleep(DM_SEND_DELAY_MS);
      }
    }

    if (completionSummary !== undefined) {
      await postBlastCompletionReport(deps.client, completionSummary);
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

/**
 * One silent owner-channel embed per completed blast. Best-effort by
 * construction (the helper swallows failures) — the gateway logged the same
 * tally at flip time, so a lost post never loses the record.
 */
async function postBlastCompletionReport(
  client: Client,
  summary: BroadcastCompletionSummary
): Promise<void> {
  const optedOutNote =
    summary.optedOut > 0 ? `, ${summary.optedOut} excluded (opted out mid-blast)` : '';
  // Only surfaced when the bot is quarantined (Discord 20026) — a bot-level
  // failure, not the recipients', so it reads separately from the failure buckets.
  const botLevelNote =
    summary.failedBotLevel > 0 ? `, ${summary.failedBotLevel} bot-quarantined` : '';
  const embed = new EmbedBuilder()
    .setColor(DISCORD_COLORS.SUCCESS)
    .setTitle('📣 Release blast completed')
    .setDescription(
      `**${summary.version}** — ${summary.sent} sent, ` +
        `${summary.failedPermanent} permanent-failed, ` +
        `${summary.failedTransient} transient-failed${botLevelNote}${optedOutNote}`
    )
    .setTimestamp();
  await postOwnerChannelEmbed(client, embed);
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
