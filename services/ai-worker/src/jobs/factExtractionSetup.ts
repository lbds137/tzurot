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
import { getZaiCodingPlanContextLength } from '@tzurot/common-types/constants/ai';
import { factExtractionJobDataSchema } from '@tzurot/common-types/types/jobs';
import { getConfig } from '@tzurot/common-types/config/config';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { ExtractionBudget } from '../services/extraction/ExtractionBudget.js';
import { ExtractionTrigger } from '../services/extraction/ExtractionTrigger.js';
import { FactStore } from '../services/extraction/FactStore.js';
import {
  FactExtractionService,
  ExtractionProviderBusyError,
} from '../services/extraction/FactExtractionService.js';

const logger = createLogger('FactExtractionSetup');

/**
 * Queue pause when the extraction provider is busy (z.ai peak hours,
 * OpenRouter 429/5xx). Peak windows last hours — the 5s-exponential job
 * backoff is the wrong scale, so busy conditions pause the whole queue for
 * this window instead. Requeues consume no retry attempts (Worker.RateLimitError).
 */
const EXTRACTION_BUSY_DELAY_MS = 30 * 60 * 1000;

/**
 * Consecutive busy cycles before the per-cycle info log escalates to error.
 * 12 cycles × 30 min ≈ 6 hours — past any normal z.ai peak window, so
 * reaching it signals a stuck state needing a human (drained system key,
 * account problem) rather than ordinary peak-hours delay. In-process counter:
 * a restart resets it, which is fine — the loop re-accumulates within hours
 * if the condition persists.
 */
const SUSTAINED_BUSY_ERROR_THRESHOLD = 12;

/**
 * Boot-time coherence checks for the zai-coding route — both fail-loud-but-
 * SOFT (log error, keep booting; extraction must never kill worker boot):
 *
 * 1. 'zai-coding' without the system key silently bills OpenRouter instead
 *    (the per-call resolver applies the same fallback).
 * 2. 'zai-coding' with a model that isn't on the coding plan means every call
 *    4xxes into the PERMANENT fail-to-skip path — a silent, indefinite
 *    extraction outage. (The null-context-length lookup is the prefix-tolerant
 *    catalog membership idiom — see modelValidation's z.ai gate.)
 */
function logZaiCoherenceMisconfigurations(config: ReturnType<typeof getConfig>): void {
  if (config.EXTRACTION_PROVIDER !== 'zai-coding') {
    return;
  }
  if (config.ZAI_CODING_API_KEY === undefined) {
    logger.error(
      {},
      'EXTRACTION_PROVIDER=zai-coding but ZAI_CODING_API_KEY is not set — extraction falls back to OpenRouter (paid)'
    );
  } else if (getZaiCodingPlanContextLength(config.EXTRACTION_MODEL) === null) {
    logger.error(
      { model: config.EXTRACTION_MODEL },
      'EXTRACTION_PROVIDER=zai-coding but EXTRACTION_MODEL is not on the z.ai coding-plan catalog — every extraction call will fail until the model is switched'
    );
  }
}

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
  const budget = new ExtractionBudget(redis, config.EXTRACTION_DAILY_LIMIT);
  const extractionService = new FactExtractionService(prisma, factStore, budget);
  const trigger = new ExtractionTrigger(redis, queue, config.EXTRACTION_BATCH_THRESHOLD);

  logZaiCoherenceMisconfigurations(config);

  // Consecutive-busy tracker (concurrency 1, so no race). Ordinary peak-hours
  // delay logs at info; a loop past SUSTAINED_BUSY_ERROR_THRESHOLD escalates
  // to error because busy classification includes human-remedy states
  // (drained credits, exhausted quota) that never self-resolve.
  let consecutiveBusyCycles = 0;

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
      try {
        const written = await extractionService.processBatch(parsed.data);
        consecutiveBusyCycles = 0;
        return { written };
      } catch (error) {
        if (error instanceof ExtractionProviderBusyError) {
          // Delay, never downgrade: facts aren't time-sensitive, so a busy
          // provider (z.ai peak hours, OpenRouter 429/5xx) pauses the queue and
          // requeues WITHOUT consuming a retry attempt. The requeued payload is
          // shrunk to the UNFINISHED groups' episode ids so completed groups
          // are never re-billed on retries of a sustained busy window.
          if (error.remainingMemoryIds.length > 0) {
            await job.updateData({
              ...parsed.data,
              sourceMemoryIds: error.remainingMemoryIds,
            });
          }
          consecutiveBusyCycles += 1;
          const logFields = {
            jobId: job.id,
            category: error.category,
            delayMs: EXTRACTION_BUSY_DELAY_MS,
            remaining: error.remainingMemoryIds.length,
            consecutiveBusyCycles,
          };
          if (consecutiveBusyCycles >= SUSTAINED_BUSY_ERROR_THRESHOLD) {
            logger.error(
              logFields,
              'Extraction provider busy far past a normal peak window — the system key may need human attention (credits/quota/account)'
            );
          } else {
            logger.info(
              logFields,
              'Extraction provider busy — delaying remaining batch (never downgrading provider)'
            );
          }
          await worker.rateLimit(EXTRACTION_BUSY_DELAY_MS);
          throw Worker.RateLimitError();
        }
        throw error;
      }
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
