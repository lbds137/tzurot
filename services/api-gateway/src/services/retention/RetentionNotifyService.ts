/**
 * Retention Phase 3 — the reachable branch's notify orchestration.
 *
 * Resolves BOTH grace-cycle cohorts (eligibility.ts owns the predicates: the
 * warning, which starts the grace clock, and the reminder, sent partway
 * through grace), enforces the breaker on the warning cohort, and enqueues
 * notice-DM batches to the retention-notify queue for bot-client's worker.
 * Also owns the two write seams the worker reports back through: the
 * send-time still-eligible filter (routed per notice kind) and the
 * per-recipient outcome stamps.
 *
 * Reached through the notify route by two callers — the retention:notify CLI
 * and, in production, bot-client's daily retention job; the breaker below
 * holds for both unless a caller sends the explicit override, which the job
 * never does.
 *
 * Idempotency layers:
 *   - CROSS-RUN: the predicates themselves (retention_notified_at /
 *     retention_reminded_at IS NULL) — a re-run's cohorts exclude everyone
 *     already warned/reminded, so re-running resumes.
 *   - WITHIN-RUN: BullMQ job retries re-run the same batch; the worker's
 *     pre-send filter (routed to the matching predicate) drops anyone
 *     stamped by the earlier attempt, and every report stamp is
 *     IS NULL-guarded.
 */

import { type Queue } from 'bullmq';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import { JobType } from '@tzurot/common-types/constants/queue';
import type {
  RetentionNotifyResponse,
  RetentionNotifyReportRequestSchema,
  RetentionNoticeKind,
} from '@tzurot/common-types/schemas/api/internal';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { getOutboundDmAllowlist } from '@tzurot/common-types/utils/outboundDmAllowlist';
import type { z } from 'zod';
import { addValidatedJob } from '../../utils/validatedQueue.js';
import {
  filterStillNotifyEligible,
  filterStillRemindEligible,
  selectNotifyCohort,
  selectRemindCohort,
} from './eligibility.js';
import { BREAKER_HARD_FRACTION, BREAKER_WARN_FRACTION } from './RetentionPurgeService.js';
import { stampDmPermanentFailure } from './dmFailureStamps.js';

const logger = createLogger('RetentionNotifyService');

/** Mirror of the blast's batch size (also the job schema's recipients cap). */
const NOTIFY_BATCH_SIZE = 50;

type NotifyOutcome = z.infer<typeof RetentionNotifyReportRequestSchema>['outcomes'][number];

/**
 * Slice one cohort into batches and enqueue them; returns the batch count.
 * Job-id prefixes are distinct per notice kind (`retention-notify-` for
 * warnings, `retention-remind-` for reminders) so the deterministic-id
 * dedup space cannot collide a warning batch against a reminder batch that
 * shares the same runId.
 */
async function enqueueBatches(
  queue: Queue,
  runId: string,
  notice: RetentionNoticeKind,
  rows: readonly { userId: string; discordUserId: string; notifiedAt?: string }[]
): Promise<number> {
  const jobIdPrefix = notice === 'warning' ? 'retention-notify-' : 'retention-remind-';
  let batches = 0;
  for (let start = 0; start < rows.length; start += NOTIFY_BATCH_SIZE) {
    const slice = rows.slice(start, start + NOTIFY_BATCH_SIZE);
    await addValidatedJob(
      queue,
      JobType.RetentionNotifyDm,
      {
        requestId: `${runId}-${notice}-${String(batches)}`,
        jobType: JobType.RetentionNotifyDm,
        responseDestination: { type: 'api' },
        runId,
        notice,
        recipients: slice.map(row =>
          row.notifiedAt !== undefined
            ? { userId: row.userId, discordUserId: row.discordUserId, notifiedAt: row.notifiedAt }
            : { userId: row.userId, discordUserId: row.discordUserId }
        ),
      },
      { jobId: `${jobIdPrefix}${runId}-${String(batches)}` }
    );
    batches += 1;
  }
  return batches;
}

export interface NotifyRunOptions {
  dryRun?: boolean;
  breakerOverride?: boolean;
  runContext?: string;
  /** Injectable clock for tests (runId uniqueness). */
  now?: () => Date;
}

export class RetentionNotifyService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Resolve both cohorts and enqueue notice-DM batches (or report what would
   * be sent, for dryRun). The breaker bounds the WARNING send set — the
   * allowlist-narrowed warning cohort this run would actually DM — because
   * mass-DM is the action being guarded (both the mass-warning and the
   * quarantine risk). The reminder cohort is deliberately out of the
   * breaker's numerator: it can never exceed the warning cohort's historical
   * size (every reminder recipient was already counted, and breaker-checked,
   * when they were warned), so it never needs its own refusal.
   */
  async enqueueNotifyRun(
    queue: Queue | null,
    options: NotifyRunOptions
  ): Promise<RetentionNotifyResponse> {
    const { dryRun = false, breakerOverride = false, runContext } = options;
    const now = options.now ?? ((): Date => new Date());

    const [cohort, remindCohort, userbaseCount] = await Promise.all([
      selectNotifyCohort(this.prisma, getOutboundDmAllowlist()),
      selectRemindCohort(this.prisma, getOutboundDmAllowlist()),
      this.prisma.user.count(),
    ]);

    const percentOfUserbase =
      userbaseCount === 0 ? 0 : Math.round((cohort.length / userbaseCount) * 1000) / 10;
    const base = {
      cohortSize: cohort.length,
      userbaseCount,
      percentOfUserbase,
      breakerWarning: userbaseCount > 0 && cohort.length / userbaseCount > BREAKER_WARN_FRACTION,
      recipients: cohort.map(row => ({
        discordId: row.discordId,
        inactiveSince: row.inactiveSince.toISOString(),
      })),
      reminderCohortSize: remindCohort.length,
      reminderRecipients: remindCohort.map(row => ({
        discordId: row.discordId,
        inactiveSince: row.notifiedAt.toISOString(),
      })),
    };

    if (cohort.length === 0 && remindCohort.length === 0) {
      return { ...base, status: 'empty', batchesEnqueued: 0, reminderBatchesEnqueued: 0 };
    }

    if (
      userbaseCount > 0 &&
      cohort.length / userbaseCount > BREAKER_HARD_FRACTION &&
      !breakerOverride
    ) {
      const breakerDetail =
        `Notify cohort is ${String(cohort.length)} of ${String(userbaseCount)} users ` +
        `(${String(percentOfUserbase)}%), over the ${String(BREAKER_HARD_FRACTION * 100)}% hard ceiling. ` +
        'A cohort this large usually means a tracking-signal glitch, not real churn. ' +
        'Re-run with the breaker override only after confirming the numbers.';
      logger.warn({ cohortSize: cohort.length, userbaseCount }, 'Notify run refused by breaker');
      return {
        ...base,
        status: 'refused_breaker',
        batchesEnqueued: 0,
        reminderBatchesEnqueued: 0,
        breakerDetail,
      };
    }

    if (dryRun) {
      return { ...base, status: 'dry_run', batchesEnqueued: 0, reminderBatchesEnqueued: 0 };
    }

    if (queue === null) {
      // Only a REAL run needs the queue; dry runs and the empty/refused
      // branches never reach here. Loud beats a silent no-op enqueue.
      throw new Error('Retention notify queue is not configured');
    }

    // Unique per invocation — deliberately NOT deterministic across runs. The
    // blast's stable jobIds dedup a re-announce of the same release; here the
    // predicate is the cross-run dedup, and a reused jobId would silently
    // swallow a later run's batch behind a completed earlier one.
    // Colon-free: the runId lands inside a BullMQ custom jobId, and BullMQ
    // rejects colon-bearing ids (an ISO timestamp carries two of its own).
    const stamp = now().toISOString().replaceAll(':', '-');
    // runContext is an operator-supplied label; sanitize it the same way so a
    // colon in a context string can't hard-refuse the whole run at the guard.
    const context = runContext?.replaceAll(':', '-');
    const runId = `${stamp}${context !== undefined ? `-${context}` : ''}`;

    const batchesEnqueued = await enqueueBatches(
      queue,
      runId,
      'warning',
      cohort.map(row => ({ userId: row.userId, discordUserId: row.discordId }))
    );
    const reminderBatchesEnqueued = await enqueueBatches(
      queue,
      runId,
      'reminder',
      remindCohort.map(row => ({
        userId: row.userId,
        discordUserId: row.discordId,
        notifiedAt: row.notifiedAt.toISOString(),
      }))
    );

    logger.info(
      {
        cohortSize: cohort.length,
        batches: batchesEnqueued,
        reminderCohortSize: remindCohort.length,
        reminderBatches: reminderBatchesEnqueued,
        runContext: runContext ?? null,
      },
      'Retention notify run enqueued'
    );
    return { ...base, status: 'enqueued', batchesEnqueued, reminderBatchesEnqueued };
  }

  /** The worker's pre-send re-check, routed to the matching eligibility predicate. */
  async filterEligible(userIds: string[], notice: RetentionNoticeKind): Promise<string[]> {
    const eligible =
      notice === 'reminder'
        ? await filterStillRemindEligible(this.prisma, userIds)
        : await filterStillNotifyEligible(this.prisma, userIds);
    return userIds.filter(id => eligible.has(id));
  }

  /**
   * Apply per-recipient delivery outcomes, for either notice kind. A `sent`
   * warning stamps the grace clock (IS NULL-guarded: the grace clock starts
   * once, and a batch re-report after a worker retry is a no-op); a `sent`
   * reminder stamps the reminder clock, guarded the same way — a re-report is
   * a no-op, and a user whose warning was cleared by activity between send
   * and report (retention_notified_at now NULL) is NOT stamped reminded. A
   * permanent bounce stamps the unreachable column via the shared kernel —
   * the re-route that moves the user to the existing purge branch — for
   * either notice kind. Bot-level (20026) and transient outcomes stamp
   * nothing, for either notice kind.
   *
   * THROWS on database failure (unlike the blast's swallow): these stamps ARE
   * the terminal transition, and the worker's report retry is safe against
   * the idempotent guards — a 500 here must retry, not strand.
   */
  async reportOutcomes(outcomes: NotifyOutcome[]): Promise<number> {
    // `processed` counts rows a stamp actually WROTE — a guarded no-op (the
    // re-report of an already-stamped user, an unknown error code) adds 0, so
    // the number means the same thing in every branch.
    let processed = 0;
    for (const outcome of outcomes) {
      if (outcome.status === 'sent' && outcome.notice === 'reminder') {
        processed += await this.prisma.$executeRaw`
          UPDATE users SET retention_reminded_at = NOW()
          WHERE id = ${outcome.userId}::uuid
            AND retention_reminded_at IS NULL
            AND retention_notified_at IS NOT NULL
        `;
      } else if (outcome.status === 'sent') {
        processed += await this.prisma.$executeRaw`
          UPDATE users SET retention_notified_at = NOW()
          WHERE id = ${outcome.userId}::uuid AND retention_notified_at IS NULL
        `;
      } else if (outcome.status === 'failed_permanent') {
        processed += await stampDmPermanentFailure(this.prisma, outcome.userId, outcome.errorCode);
      } else {
        // failed_bot_level / failed_transient: recorded in logs only — a
        // quarantined bot or a network blip says nothing about the user, and
        // the un-stamped user simply rides the next notify run.
        logger.info(
          { userId: outcome.userId, status: outcome.status, errorCode: outcome.errorCode },
          'Notify outcome recorded without a stamp'
        );
      }
    }
    return processed;
  }
}
