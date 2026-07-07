/**
 * Fact-extraction wiring (memory Phase 2 slice 2 — shadow mode)
 *
 * Constructs the whole extraction assembly behind the EXTRACTION_ENABLED kill
 * switch: the dedicated queue, its worker (concurrency 1 — background work
 * must never compete with user-facing generation), and the write-path trigger
 * that LongTermMemoryService tail-calls. Returns undefined when disabled —
 * callers treat that as "feature absent" and today's behavior is unchanged.
 */

import { Queue, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import type { BullMQRedisConfig } from '@tzurot/common-types/utils/redis';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import type { LocalEmbeddingService } from '@tzurot/embeddings';
import { FACT_EXTRACTION_QUEUE_NAME, QUEUE_CONFIG } from '@tzurot/common-types/constants/queue';
import { factExtractionJobDataSchema } from '@tzurot/common-types/types/jobs';
import { getConfig } from '@tzurot/common-types/config/config';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { ExtractionBudget } from '../services/extraction/ExtractionBudget.js';
import { ExtractionTrigger } from '../services/extraction/ExtractionTrigger.js';
import { FactStore } from '../services/extraction/FactStore.js';
import { FactExtractionService } from '../services/extraction/FactExtractionService.js';

const logger = createLogger('FactExtractionSetup');

export interface FactExtractionAssembly {
  queue: Queue;
  worker: Worker;
  /** Inject into LongTermMemoryService (via the RAG service chain). */
  trigger: ExtractionTrigger;
}

export function setupFactExtraction(
  prisma: PrismaClient,
  /** Plain client for the trigger's EVAL/LRANGE and the budget counter. */
  redis: Redis,
  /** BullMQ-shaped connection (maxRetriesPerRequest: null) for Queue/Worker —
   * a plain client's default retry cap fights BullMQ's own blocking-command
   * retry logic (see createBullMQRedisConfig's doc). */
  bullmqConnection: BullMQRedisConfig,
  embeddingService: LocalEmbeddingService | undefined
): FactExtractionAssembly | undefined {
  const config = getConfig();
  if (config.EXTRACTION_ENABLED !== 'true') {
    logger.info('Fact extraction disabled (EXTRACTION_ENABLED != true)');
    return undefined;
  }
  if (embeddingService === undefined) {
    logger.warn('Fact extraction enabled but embedding service unavailable — staying disabled');
    return undefined;
  }

  const queue = new Queue(FACT_EXTRACTION_QUEUE_NAME, {
    connection: bullmqConnection,
    defaultJobOptions: {
      removeOnComplete: { count: QUEUE_CONFIG.COMPLETED_HISTORY_LIMIT },
      removeOnFail: { count: QUEUE_CONFIG.FAILED_HISTORY_LIMIT },
    },
  });

  const factStore = new FactStore(prisma, embeddingService);
  const budget = new ExtractionBudget(redis);
  const extractionService = new FactExtractionService(prisma, factStore, budget);
  const trigger = new ExtractionTrigger(redis, queue, config.EXTRACTION_BATCH_THRESHOLD);

  const worker = new Worker(
    FACT_EXTRACTION_QUEUE_NAME,
    async job => {
      const parsed = factExtractionJobDataSchema.safeParse(job.data);
      if (!parsed.success) {
        // fail-to-skip: a malformed payload is dead on arrival, not retryable
        logger.warn(
          { jobId: job.id, issues: parsed.error.issues.slice(0, 3) },
          'Fact-extraction job payload failed validation — skipping'
        );
        return { written: 0 };
      }
      const written = await extractionService.processBatch(parsed.data);
      return { written };
    },
    { connection: bullmqConnection, concurrency: 1 }
  );

  worker.on('failed', (job, err) => {
    logger.warn({ jobId: job?.id, err }, 'Fact-extraction job failed (BullMQ will retry)');
  });
  // Connection-level errors (Redis blips, lock renewal) emit 'error', not
  // 'failed' — an unhandled 'error' event throws synchronously and would
  // crash the whole ai-worker process.
  worker.on('error', err => {
    logger.error({ err }, 'Fact-extraction worker error');
  });

  logger.info(
    { batchThreshold: config.EXTRACTION_BATCH_THRESHOLD },
    'Fact extraction enabled (shadow mode — facts written, nothing reads them yet)'
  );
  return { queue, worker, trigger };
}
