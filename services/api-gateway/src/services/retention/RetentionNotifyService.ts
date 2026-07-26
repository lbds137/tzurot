/**
 * Retention Phase 3 — the reachable branch's notify orchestration.
 *
 * Resolves the reachable-but-inactive cohort (eligibility.ts owns the
 * predicate), enforces the breaker, and enqueues warning-DM batches to the
 * retention-notify queue for bot-client's worker. Also owns the two write
 * seams the worker reports back through: the send-time still-eligible filter
 * and the per-recipient outcome stamps.
 *
 * Operator-driven only (manual-approval doctrine, like the purge) — nothing
 * calls enqueueNotifyRun on a schedule; autonomous execution is Phase 4.
 *
 * Idempotency layers:
 *   - CROSS-RUN: the predicate itself (retention_notified_at IS NULL) — a
 *     re-run's cohort excludes everyone already warned, so re-running resumes.
 *   - WITHIN-RUN: BullMQ job retries re-run the same batch; the worker's
 *     pre-send filter (filterStillNotifyEligible) drops anyone stamped by the
 *     earlier attempt, and every report stamp is IS NULL-guarded.
 */

import { type Queue } from 'bullmq';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import { JobType } from '@tzurot/common-types/constants/queue';
import type {
  RetentionNotifyResponse,
  RetentionNotifyReportRequestSchema,
} from '@tzurot/common-types/schemas/api/internal';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { getOutboundDmAllowlist } from '@tzurot/common-types/utils/outboundDmAllowlist';
import type { z } from 'zod';
import { addValidatedJob } from '../../utils/validatedQueue.js';
import {
  filterStillNotifyEligible,
  selectNotifyCohort,
  type NotifyCohortRow,
} from './eligibility.js';
import { BREAKER_HARD_FRACTION, BREAKER_WARN_FRACTION } from './RetentionPurgeService.js';
import { stampDmPermanentFailure } from './dmFailureStamps.js';

const logger = createLogger('RetentionNotifyService');

/** Mirror of the blast's batch size (also the job schema's recipients cap). */
const NOTIFY_BATCH_SIZE = 50;

type NotifyOutcome = z.infer<typeof RetentionNotifyReportRequestSchema>['outcomes'][number];

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
   * Resolve the cohort and enqueue warning-DM batches (or report what would
   * be sent, for dryRun). The breaker bounds the SEND SET — the
   * allowlist-narrowed cohort this run would actually DM — because mass-DM is
   * the action being guarded (both the mass-warning and the quarantine risk).
   */
  async enqueueNotifyRun(
    queue: Queue | null,
    options: NotifyRunOptions
  ): Promise<RetentionNotifyResponse> {
    const { dryRun = false, breakerOverride = false, runContext } = options;
    const now = options.now ?? ((): Date => new Date());

    const [cohort, userbaseCount] = await Promise.all([
      selectNotifyCohort(this.prisma, getOutboundDmAllowlist()),
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
    };

    if (cohort.length === 0) {
      return { ...base, status: 'empty', batchesEnqueued: 0 };
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
      return { ...base, status: 'refused_breaker', batchesEnqueued: 0, breakerDetail };
    }

    if (dryRun) {
      return { ...base, status: 'dry_run', batchesEnqueued: 0 };
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
    const runId = `${now().toISOString()}${runContext !== undefined ? `-${runContext}` : ''}`;

    let batches = 0;
    for (let start = 0; start < cohort.length; start += NOTIFY_BATCH_SIZE) {
      const slice: NotifyCohortRow[] = cohort.slice(start, start + NOTIFY_BATCH_SIZE);
      await addValidatedJob(
        queue,
        JobType.RetentionNotifyDm,
        {
          requestId: `${runId}:${String(batches)}`,
          jobType: JobType.RetentionNotifyDm,
          responseDestination: { type: 'api' },
          runId,
          recipients: slice.map(row => ({ userId: row.userId, discordUserId: row.discordId })),
        },
        { jobId: `retention-notify:${runId}:${String(batches)}` }
      );
      batches += 1;
    }

    logger.info(
      { cohortSize: cohort.length, batches, runContext: runContext ?? null },
      'Retention notify run enqueued'
    );
    return { ...base, status: 'enqueued', batchesEnqueued: batches };
  }

  /** The worker's pre-send re-check — see eligibility.filterStillNotifyEligible. */
  async filterEligible(userIds: string[]): Promise<string[]> {
    const eligible = await filterStillNotifyEligible(this.prisma, userIds);
    return userIds.filter(id => eligible.has(id));
  }

  /**
   * Apply per-recipient delivery outcomes. `sent` stamps the grace clock
   * (IS NULL-guarded: one notice per inactivity spell, and a batch re-report
   * after a worker retry is a no-op); a permanent bounce stamps the
   * unreachable column via the shared kernel — the re-route that moves the
   * user to the existing purge branch. Bot-level (20026) and transient
   * outcomes stamp nothing.
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
      if (outcome.status === 'sent') {
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
