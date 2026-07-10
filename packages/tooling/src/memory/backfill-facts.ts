/**
 * Fact-extraction backfill (memory Phase 2 — the beta.157 historical run)
 *
 * Enqueues FACT_EXTRACTION jobs for memories that predate the live extraction
 * trigger. No Redis counters involved — the worker reads episode ids from the
 * job payload, so windows are built here directly from Postgres and enqueued
 * onto the existing queue. The Railway ai-worker (which holds the z.ai system
 * key) does all model work; this command only reads memories and enqueues.
 *
 * Safety properties:
 * - Deterministic jobIds (channel sentinel 'backfill') dedup re-enqueues
 *   within BullMQ retention; fact writes are content-hash idempotent anyway.
 * - `budgetExempt: true` skips the per-personality daily tripwire (finite,
 *   owner-initiated job set — the tripwire bounds malfunctions, not backfills).
 * - `priority: 10` keeps live extraction ahead of the backfill (BullMQ runs
 *   unprioritized jobs first).
 * - Skip-covered (default): memories already cited by any fact's
 *   source_memory_ids are excluded, so re-runs only touch new ground.
 */

import chalk from 'chalk';
import { FACT_EXTRACTION_QUEUE_NAME, JobType } from '@tzurot/common-types/constants/queue';
import { generateFactExtractionJobUuid } from '@tzurot/common-types/utils/deterministicUuid';
import type { FactExtractionJobData } from '@tzurot/common-types/types/jobs';
import {
  type Environment,
  validateEnvironment,
  showEnvironmentBanner,
  confirmProductionOperation,
} from '../utils/env-runner.js';
import { getPrismaForEnv } from './prisma-env.js';
import { getRailwayRedisUrl, createInspectorQueue } from '../inspect/bullmqConnection.js';

/** channelId sentinel — provenance-only downstream (jobId + fact extractionJobId
 * namespace); real channel ids are meaningless for cross-channel windows. */
const BACKFILL_CHANNEL_SENTINEL = 'backfill';

/** BullMQ runs unprioritized (live) jobs before any prioritized job. */
const BACKFILL_JOB_PRIORITY = 10;

/** Mirrors the live trigger's EXTRACTION_BATCH_THRESHOLD default. */
const DEFAULT_WINDOW_SIZE = 6;

/** The worker re-queries a window's episodes with `take: 100` — a larger
 * window would silently truncate its tail (unmarked, resurfacing next run).
 * Cap here so the operator gets an error instead of a silent partial batch. */
const MAX_WINDOW_SIZE = 100;

const ENQUEUE_PROGRESS_INTERVAL = 500;

export interface BackfillFactsOptions {
  env: Environment;
  dryRun?: boolean;
  /** Cap on enqueued windows — the canary knob. */
  limit?: number;
  personalityId?: string;
  windowSize?: number;
  /** Re-enqueue memories already cited by existing facts (default: skip them). */
  includeCovered?: boolean;
  force?: boolean;
}

export interface EligibleMemoryRow {
  id: string;
  personality_id: string;
  persona_id: string;
}

export interface BackfillWindow {
  personalityId: string;
  personaId: string;
  sourceMemoryIds: string[];
  windowStart: string;
}

/**
 * Group eligible rows per (personality, persona) and chunk each group into
 * extraction windows, preserving the rows' incoming (created_at ASC) order.
 * Pure — the unit-testable core of the command.
 */
export function buildWindows(rows: EligibleMemoryRow[], windowSize: number): BackfillWindow[] {
  // Number.isInteger rejects NaN (a mistyped CLI value) — a bare `< 1` check
  // would let NaN through and crash confusingly in the chunking loop.
  if (!Number.isInteger(windowSize) || windowSize < 1 || windowSize > MAX_WINDOW_SIZE) {
    throw new Error(`windowSize must be an integer in 1..${MAX_WINDOW_SIZE} (got ${windowSize})`);
  }
  const groups = new Map<string, EligibleMemoryRow[]>();
  for (const row of rows) {
    const key = `${row.personality_id}|${row.persona_id}`;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }

  const windows: BackfillWindow[] = [];
  for (const group of groups.values()) {
    for (let i = 0; i < group.length; i += windowSize) {
      const chunk = group.slice(i, i + windowSize);
      windows.push({
        personalityId: chunk[0].personality_id,
        personaId: chunk[0].persona_id,
        sourceMemoryIds: chunk.map(r => r.id),
        windowStart: chunk[0].id,
      });
    }
  }
  return windows;
}

/** Build one window's deterministic BullMQ jobId + the exact worker payload. */
export function buildJobData(window: BackfillWindow): {
  jobId: string;
  jobData: FactExtractionJobData;
} {
  const jobId = generateFactExtractionJobUuid(
    BACKFILL_CHANNEL_SENTINEL,
    window.personalityId,
    window.windowStart
  );
  return {
    jobId,
    jobData: {
      requestId: `fact-backfill-${jobId}`,
      jobType: JobType.FactExtraction,
      responseDestination: { type: 'api' },
      version: 1,
      channelId: BACKFILL_CHANNEL_SENTINEL,
      personalityId: window.personalityId,
      sourceMemoryIds: window.sourceMemoryIds,
      windowStart: window.windowStart,
      budgetExempt: true,
    },
  };
}

interface PrismaLike {
  $queryRawUnsafe: <T = unknown>(query: string, ...values: unknown[]) => Promise<T>;
}

/**
 * Fetch eligible memories in window-build order. Eligibility mirrors the
 * worker's own re-filter (visibility + non-null persona); the covered-set
 * subtraction happens in JS (a Set over UNNESTed fact sources) because
 * source_memory_ids has no index and the id sets are small at this scale.
 */
async function queryEligibleRows(
  prisma: PrismaLike,
  personalityId: string | undefined,
  includeCovered: boolean
): Promise<EligibleMemoryRow[]> {
  const filter = personalityId === undefined ? '' : `AND personality_id = $1::uuid`;
  const params = personalityId === undefined ? [] : [personalityId];
  const rows = await prisma.$queryRawUnsafe<EligibleMemoryRow[]>(
    `SELECT id, personality_id, persona_id
     FROM memories
     WHERE visibility = 'normal' AND persona_id IS NOT NULL ${filter}
     ORDER BY personality_id, persona_id, created_at ASC`,
    ...params
  );
  if (includeCovered) {
    return rows;
  }
  // Unbounded whole-table scan by design: this is a one-shot ops command and
  // the covered set fits trivially in memory at current scale. Scope it (or
  // index source_memory_ids) if this ever becomes a frequent operation.
  const covered = await prisma.$queryRawUnsafe<{ src: string }[]>(
    `SELECT DISTINCT UNNEST(source_memory_ids) AS src FROM memory_facts`
  );
  const coveredSet = new Set(covered.map(r => r.src));
  return rows.filter(r => !coveredSet.has(r.id));
}

function printSummary(
  rows: EligibleMemoryRow[],
  totalWindows: number,
  enqueueingWindows: number
): void {
  const perPersonality = new Map<string, number>();
  for (const row of rows) {
    perPersonality.set(row.personality_id, (perPersonality.get(row.personality_id) ?? 0) + 1);
  }
  console.log(chalk.bold('\nBackfill scope:'));
  console.log(`  Eligible episodes:  ${rows.length}`);
  console.log(`  Windows (total):    ${totalWindows}`);
  console.log(`  Enqueueing now:     ${enqueueingWindows}`);
  console.log(`  Personalities:      ${perPersonality.size}`);
  const top = [...perPersonality.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  console.log(chalk.dim('  Top personalities by episode count:'));
  for (const [id, count] of top) {
    console.log(chalk.dim(`    ${id.slice(0, 8)}…  ${count} episodes`));
  }
}

/** Entry point for `pnpm ops memory:backfill-facts`. */
export async function backfillFacts(options: BackfillFactsOptions): Promise<void> {
  const { env, dryRun = false, force = false, includeCovered = false } = options;
  const windowSize = options.windowSize ?? DEFAULT_WINDOW_SIZE;

  // Fail loudly on malformed numeric flags: a NaN limit would silently
  // UNCAP the run (NaN comparisons are false), turning a mistyped 5-window
  // canary into the full budget-exempt backfill.
  if (options.limit !== undefined && (!Number.isInteger(options.limit) || options.limit < 1)) {
    throw new Error(`--limit must be a positive integer (got ${options.limit})`);
  }

  validateEnvironment(env);
  showEnvironmentBanner(env);
  if (env === 'prod' && !dryRun && !force) {
    const confirmed = await confirmProductionOperation('enqueue fact-extraction backfill jobs');
    if (!confirmed) {
      console.log(chalk.yellow('\nOperation cancelled.'));
      return;
    }
  }

  const { prisma, disconnect } = await getPrismaForEnv(env);
  try {
    const rows = await queryEligibleRows(prisma, options.personalityId, includeCovered);
    let windows = buildWindows(rows, windowSize);
    const totalWindows = windows.length;
    if (options.limit !== undefined && options.limit < windows.length) {
      windows = windows.slice(0, options.limit);
      console.log(
        chalk.yellow(
          `--limit ${options.limit}: enqueueing ${windows.length} of ${totalWindows} windows`
        )
      );
    }
    printSummary(rows, totalWindows, windows.length);

    if (windows.length === 0) {
      console.log(
        chalk.green('\nNothing to backfill — every eligible episode is already covered.')
      );
      return;
    }
    if (dryRun) {
      console.log(chalk.yellow('\nDry run — no jobs enqueued.'));
      return;
    }

    const redisUrl = await getRailwayRedisUrl(env);
    if (redisUrl === null) {
      throw new Error(`Could not resolve a Redis URL for ${env}`);
    }
    const queue = createInspectorQueue(redisUrl, FACT_EXTRACTION_QUEUE_NAME);
    try {
      let enqueued = 0;
      for (const window of windows) {
        const { jobId, jobData } = buildJobData(window);
        // Options mirror the live trigger's (ExtractionTrigger), plus the
        // backfill deltas: deterministic-jobId dedup + below-live priority.
        await queue.add(JobType.FactExtraction, jobData, {
          jobId,
          priority: BACKFILL_JOB_PRIORITY,
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: { count: 50, age: 24 * 3600 },
          removeOnFail: { count: 100, age: 7 * 24 * 3600 },
        });
        enqueued += 1;
        if (enqueued % ENQUEUE_PROGRESS_INTERVAL === 0) {
          console.log(chalk.dim(`  enqueued ${enqueued}/${windows.length}…`));
        }
      }
      console.log(
        chalk.green(`\n✅ Enqueued ${enqueued} backfill windows onto ${FACT_EXTRACTION_QUEUE_NAME}`)
      );
      console.log(
        chalk.dim(
          'The worker paces itself: live jobs take priority, and z.ai busy windows pause the queue (delay-not-downgrade).'
        )
      );
    } finally {
      await queue.close();
    }
  } finally {
    await disconnect();
  }
}
