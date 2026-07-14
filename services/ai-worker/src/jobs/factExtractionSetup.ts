/**
 * Fact-extraction wiring (memory Phase 2)
 *
 * Constructs the whole extraction assembly unconditionally (queue, worker at
 * concurrency 1 — background work must never compete with user-facing
 * generation, and the write-path trigger that LongTermMemoryService
 * tail-calls). The kill switch is the RUNTIME `extractionEnabled` system
 * setting, checked per trigger-fire: when off, no episode is counted and no
 * batch enqueues, so the worker idles on an empty queue and flipping the
 * switch needs no restart in either direction. Construction must stay
 * side-effect-free beyond queue/worker registration — an infra dependency
 * added here would turn the always-on assembly into a boot risk.
 *
 * Returns undefined only when the embedding service is down (an infra
 * precondition, not configuration).
 */

import { Queue, Worker, DelayedError } from 'bullmq';
import type { Redis } from 'ioredis';
import type { BullMQRedisConfig } from '@tzurot/common-types/utils/redis';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import type { LocalEmbeddingService } from '@tzurot/embeddings';
import { FACT_EXTRACTION_QUEUE_NAME, QUEUE_CONFIG } from '@tzurot/common-types/constants/queue';
import { TIMEOUTS } from '@tzurot/common-types/constants/timing';
import { getZaiCodingPlanContextLength } from '@tzurot/common-types/constants/ai';
import {
  factExtractionJobDataSchema,
  type FactExtractionJobData,
} from '@tzurot/common-types/types/jobs';
import { getConfig } from '@tzurot/common-types/config/config';
import { getSystemSetting } from '@tzurot/common-types/services/SystemSettingsService';
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
 * Per-job delay when the extraction provider is busy (z.ai peak hours,
 * OpenRouter 429/5xx). Peak windows last hours — the 5s-exponential job
 * backoff is the wrong scale, so the busy job moves to the DELAYED set for
 * this window (moveToDelayed + DelayedError: no retry attempt consumed, and
 * other jobs keep flowing — a single slow batch can't block the queue head).
 * worker.rateLimit()-based whole-queue pausing is NOT used: it is deprecated
 * in BullMQ v5 and its pause was observed as a no-op at runtime (busy cycles
 * ~90s apart instead of 30 min).
 */
const EXTRACTION_BUSY_DELAY_MS = 30 * 60 * 1000;

/**
 * Per-JOB cap on busy-delay cycles (tracked on the payload, surviving
 * restarts). A batch that fails EVERY attempt — e.g. one whose extraction
 * call reliably exceeds the model timeout — is a poison batch: without a cap
 * it would cycle in the queue forever. Past the cap it fail-to-skips (its
 * episodes stay eligible for a future backfill re-run via skip-covered).
 * 48 cycles × 30 min ≈ 24h of genuine-outage tolerance before a batch is
 * given up on.
 */
const MAX_BUSY_CYCLES_PER_JOB = 48;

/**
 * Consecutive busy cycles before the per-cycle info log escalates to error.
 * 12 cycles × 30 min ≈ 6 hours — past any normal z.ai peak window, so
 * reaching it signals a stuck state needing a human (drained system key,
 * account problem) rather than ordinary peak-hours delay. In-process counter:
 * a restart resets it, which is fine — the loop re-accumulates within hours
 * if the condition persists.
 */
const SUSTAINED_BUSY_ERROR_THRESHOLD = 12;

interface BusyJobContext {
  job: {
    id?: string;
    updateData: (data: unknown) => Promise<void>;
    moveToDelayed: (timestamp: number, token?: string) => Promise<void>;
  };
  token: string | undefined;
  data: FactExtractionJobData;
  error: ExtractionProviderBusyError;
  consecutiveBusyCycles: number;
}

/**
 * Delay, never downgrade: facts aren't time-sensitive, so a busy provider
 * (z.ai peak hours, OpenRouter 429/5xx) moves THIS job to the delayed set
 * WITHOUT consuming a retry attempt (moveToDelayed + DelayedError). The
 * requeued payload is shrunk to the UNFINISHED groups' episode ids so
 * completed groups are never re-billed, and busyCycles rides the payload so
 * the poison-batch cap survives worker restarts. Past the cap the batch
 * fail-to-skips — its episodes remain uncovered, so a later backfill re-run
 * retries them.
 */
async function delayOrEjectBusyJob(ctx: BusyJobContext): Promise<{ written: number }> {
  const { job, token, data, error, consecutiveBusyCycles } = ctx;
  const busyCycles = (data.busyCycles ?? 0) + 1;
  const logFields = {
    jobId: job.id,
    category: error.category,
    delayMs: EXTRACTION_BUSY_DELAY_MS,
    remaining: error.remainingMemoryIds.length,
    busyCycles,
    consecutiveBusyCycles,
  };
  if (busyCycles > MAX_BUSY_CYCLES_PER_JOB) {
    logger.error(
      logFields,
      'Extraction batch exceeded the busy-cycle cap — skipping it (episodes stay eligible for a future backfill re-run)'
    );
    return { written: 0 };
  }
  await job.updateData({
    ...data,
    ...(error.remainingMemoryIds.length > 0 ? { sourceMemoryIds: error.remainingMemoryIds } : {}),
    busyCycles,
  });
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
  await job.moveToDelayed(Date.now() + EXTRACTION_BUSY_DELAY_MS, token);
  throw new DelayedError();
}

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
function logZaiCoherenceMisconfigurations(): void {
  if (getSystemSetting('extractionProvider') !== 'zai-coding') {
    return;
  }
  const model = getSystemSetting('extractionModel');
  if (getConfig().ZAI_CODING_API_KEY === undefined) {
    logger.error(
      {},
      'extractionProvider=zai-coding but ZAI_CODING_API_KEY is not set — extraction falls back to OpenRouter (paid)'
    );
  } else if (getZaiCodingPlanContextLength(model) === null) {
    logger.error(
      { model },
      'extractionProvider=zai-coding but extractionModel is not on the z.ai coding-plan catalog — every extraction call will fail until the model is switched (the write path warns on save; this covers a bag edited out-of-band)'
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
  if (embeddingService === undefined) {
    logger.warn('Embedding service unavailable — fact extraction staying disabled');
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
  const budget = new ExtractionBudget(redis, getConfig().EXTRACTION_DAILY_LIMIT);
  const extractionService = new FactExtractionService(prisma, factStore, budget);
  const trigger = new ExtractionTrigger(
    redis,
    queue,
    () => getSystemSetting('extractionBatchThreshold'),
    () => getSystemSetting('extractionEnabled')
  );

  logZaiCoherenceMisconfigurations();

  // Consecutive-busy tracker (concurrency 1, so no race). Ordinary peak-hours
  // delay logs at info; a loop past SUSTAINED_BUSY_ERROR_THRESHOLD escalates
  // to error because busy classification includes human-remedy states
  // (drained credits, exhausted quota) that never self-resolve.
  let consecutiveBusyCycles = 0;

  const worker = new Worker(
    FACT_EXTRACTION_QUEUE_NAME,
    async (job, token) => {
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
          consecutiveBusyCycles += 1;
          return delayOrEjectBusyJob({
            job,
            token,
            data: parsed.data,
            error,
            consecutiveBusyCycles,
          });
        }
        throw error;
      }
    },
    {
      connection: bullmqConnection,
      concurrency: 1,
      // Explicit rather than BullMQ's 30s default: the extraction call may
      // legitimately run to EXTRACTION_TIMEOUT_MS (180s). Auto-renewal covers
      // I/O-bound waits, but after one timing surprise in this worker the
      // safety margin should be self-documenting (mirrors index.ts; 5-min
      // lock = dead-process detection, not a runtime bound).
      lockDuration: TIMEOUTS.WORKER_LOCK_DURATION,
      // One stall-recovery re-run for deploy-killed jobs (spend-safe: the
      // busy path shrinks remainingMemoryIds via job.updateData, so a re-run
      // never re-bills completed sub-units); a second stall fails the job.
      maxStalledCount: 1,
    }
  );

  worker.on('failed', (job, err) => {
    logger.warn({ jobId: job?.id, err }, 'Fact-extraction job failed (BullMQ will retry)');
  });
  // Stall = lock expired because the owning process died mid-extraction
  // (deploy/crash); BullMQ has re-queued the job for a re-run.
  worker.on('stalled', (jobId: string) => {
    logger.warn({ jobId }, 'Fact-extraction job stalled (owning process died) — re-queued');
  });
  // Connection-level errors (Redis blips, lock renewal) emit 'error', not
  // 'failed' — an unhandled 'error' event throws synchronously and would
  // crash the whole ai-worker process.
  worker.on('error', err => {
    logger.error({ err }, 'Fact-extraction worker error');
  });

  logger.info(
    {
      batchThreshold: getSystemSetting('extractionBatchThreshold'),
      extractionEnabled: getSystemSetting('extractionEnabled'),
    },
    'Fact-extraction assembly constructed (runtime kill switch: extractionEnabled; reads gated separately by factsInPromptEnabled)'
  );
  return { queue, worker, trigger };
}
