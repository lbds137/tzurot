/**
 * Memory-archive summarizer queue wiring (slice B1, write side).
 *
 * Mirrors `factExtractionSetup.ts`'s assembly shape: constructs the queue,
 * worker, budget, and trigger; the runtime `archiveSummaryEnqueueEnabled` and
 * `archiveSummaryModelEnabled` system settings are the kill switches, checked
 * per trigger-fire and per job respectively — no restart needed in either
 * direction.
 *
 * `removeOnComplete`/`removeOnFail` are plain booleans, not history counts:
 * the memory ROW is the ledger (summary_status, summary_attempts,
 * summary_last_error), so Redis only needs to keep the in-flight job set. A
 * completed job leaving Redis immediately is what lets a later re-enqueue of
 * the same memory id (the deterministic jobId) be accepted rather than
 * silently deduped against a stale completed entry.
 */

import { Queue, Worker, DelayedError } from 'bullmq';
import type { Redis } from 'ioredis';
import type { BullMQRedisConfig } from '@tzurot/common-types/utils/redis';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import { ARCHIVE_SUMMARY_QUEUE_NAME } from '@tzurot/common-types/constants/queue';
import { TIMEOUTS } from '@tzurot/common-types/constants/timing';
import { archiveSummaryJobDataSchema } from '@tzurot/common-types/types/jobs';
import { getSystemSetting } from '@tzurot/common-types/services/SystemSettingsService';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { ArchiveSummaryBudget } from '../services/archiveSummary/ArchiveSummaryBudget.js';
import { ArchiveSummaryTrigger } from '../services/archiveSummary/ArchiveSummaryTrigger.js';
import { ArchiveSummaryProcessor } from '../services/archiveSummary/ArchiveSummaryProcessor.js';
import { ARCHIVE_SUMMARY_RATE_LIMIT } from '../services/archiveSummary/constants.js';

const logger = createLogger('ArchiveSummarySetup');

export interface ArchiveSummaryAssembly {
  queue: Queue;
  worker: Worker;
  /** Inject into PgvectorMemoryAdapter's write path. */
  trigger: ArchiveSummaryTrigger;
}

export function setupArchiveSummary(
  prisma: PrismaClient,
  /** Plain client for the budget counter's INCR/EXPIRE/DECR. */
  cacheRedis: Redis,
  /** BullMQ-shaped connection (maxRetriesPerRequest: null) for Queue/Worker. */
  bullmqConnection: BullMQRedisConfig
): ArchiveSummaryAssembly {
  const queue = new Queue(ARCHIVE_SUMMARY_QUEUE_NAME, {
    connection: bullmqConnection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 30_000 },
      removeOnComplete: true,
      removeOnFail: true,
    },
  });

  const budget = new ArchiveSummaryBudget(cacheRedis, () =>
    getSystemSetting('archiveSummaryDailyCap')
  );
  const trigger = new ArchiveSummaryTrigger(prisma, queue, () =>
    getSystemSetting('archiveSummaryEnqueueEnabled')
  );
  const processor = new ArchiveSummaryProcessor({ prisma, budget });

  const worker = new Worker(
    ARCHIVE_SUMMARY_QUEUE_NAME,
    async (job, token) => {
      const parsed = archiveSummaryJobDataSchema.safeParse(job.data);
      if (!parsed.success) {
        logger.warn(
          { jobId: job.id, issues: parsed.error.issues.slice(0, 3) },
          'Archive-summary job payload failed validation — skipping'
        );
        return;
      }
      // DelayedError propagates untouched — BullMQ interprets it as "this job
      // already called moveToDelayed; do not also mark it failed."
      return processor.process(job, token, parsed.data);
    },
    {
      connection: bullmqConnection,
      concurrency: 1,
      lockDuration: TIMEOUTS.WORKER_LOCK_DURATION,
      maxStalledCount: 1,
      limiter: ARCHIVE_SUMMARY_RATE_LIMIT,
    }
  );

  worker.on('failed', (job, err) => {
    if (err instanceof DelayedError) {
      return;
    }
    logger.warn({ jobId: job?.id, err }, 'Archive-summary job failed (BullMQ will retry)');
  });
  worker.on('stalled', (jobId: string) => {
    logger.warn({ jobId }, 'Archive-summary job stalled (owning process died) — re-queued');
  });
  worker.on('error', err => {
    logger.error({ err }, 'Archive-summary worker error');
  });

  logger.info(
    {
      enqueueEnabled: getSystemSetting('archiveSummaryEnqueueEnabled'),
      modelEnabled: getSystemSetting('archiveSummaryModelEnabled'),
    },
    'Archive-summary assembly constructed'
  );

  return { queue, worker, trigger };
}
