/**
 * Archive-summary pre-warm sweep (memory-archive slice C2)
 *
 * Enqueues archive-summary jobs for one personality's eligible rows ahead
 * of a per-personality flip to split-render summaries, and reports the
 * summarized-share flip gate (95%), fact coverage, and dead-row error
 * classes. Idempotent by memory id — the enqueue path and the pending
 * stamp both key off `memories.id`, so a re-run only touches rows still
 * eligible.
 *
 * The flip itself is deliberately NOT done here: this command reads system
 * settings through `SystemSettingsService` (read-only) and reports whether
 * the gate is READY, but the operator flips `archiveSplitRenderPersonalities`
 * by hand via `/admin settings set` once satisfied.
 */

import chalk from 'chalk';
import { UsageError } from '../utils/errors.js';
import {
  type Environment,
  validateEnvironment,
  showEnvironmentBanner,
  requireProductionConfirmation,
} from '../utils/env-runner.js';
import { getPrismaForEnv } from './prisma-env.js';
import {
  getRailwayRedisUrl,
  createInspectorQueue,
  createInspectorRedis,
} from '../inspect/bullmqConnection.js';
import { ARCHIVE_SUMMARY_QUEUE_NAME, JobType } from '@tzurot/common-types/constants/queue';
import { CACHE_KEY_PREFIXES } from '@tzurot/common-types/constants/redis-keys';
import {
  ARCHIVE_SUMMARY_PROMPT_VERSION,
  ARCHIVE_SUMMARY_JOB_OPTIONS,
} from '@tzurot/common-types/constants/memoryArchive';
import { buildArchiveSummaryJobData } from '@tzurot/common-types/types/jobs';
import { SystemSettingsService } from '@tzurot/common-types/services/SystemSettingsService';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import {
  buildSelectionSql,
  PENDING_STAMP_SQL,
  PERSONALITY_ID_BY_SLUG_SQL,
  WINDOW_COUNTS_SQL,
  FACT_COVERAGE_SQL,
  DEAD_BY_ERROR_CLASS_SQL,
} from './summarize-sweep-sql.js';
import {
  estimateInputTokens,
  summarizedShare,
  factCoverageShare,
  formatGateLine,
  formatFactCoverageLine,
  type SelectedRow,
  type WindowCounts,
} from './summarize-sweep-report.js';

const DEFAULT_WINDOW_DAYS = 30;
const DEFAULT_LIMIT = 5000;
const PENDING_STAMP_BATCH_SIZE = 200;

/** BullMQ runs unprioritized (live) jobs before any prioritized job, so a
 *  sweep-priority job never starves a live archive-summary write.
 *  Verified against bullmq 5.81.3: `moveToActive-11.lua` pops the plain wait
 *  list (`RPOPLPUSH wait → active`) before it falls back to
 *  `moveJobFromPrioritizedToActive`, and `scripts.js` routes any truthy
 *  `priority` to the prioritized set — so a job added without a priority is
 *  always dequeued ahead of a priority-10 job. Re-probe on a BullMQ major
 *  bump. */
const SWEEP_JOB_PRIORITY = 10;

/** Mirrors the live queue's `defaultJobOptions` in
 *  `services/ai-worker/src/jobs/archiveSummarySetup.ts` — that `Queue`
 *  instance's options apply client-side, and the inspector queue this
 *  command constructs is a SEPARATE instance with none configured, so
 *  without an explicit mirror a sweep job gets one attempt and is never
 *  removed on completion. A completed job left under a memory's id then
 *  dedupes every later re-enqueue of that same memory (the deterministic
 *  jobId). `ARCHIVE_SUMMARY_JOB_OPTIONS` is the shared constant that keeps
 *  the two queues' options in step. */

export interface SummarizeSweepOptions {
  env: Environment;
  personality: string;
  windowDays?: number;
  limit?: number;
  dryRun?: boolean;
  includeCold?: boolean;
  force?: boolean;
}

interface PrismaLike {
  $queryRawUnsafe: <T = unknown>(query: string, ...values: unknown[]) => Promise<T>;
  $executeRawUnsafe: (query: string, ...values: unknown[]) => Promise<number>;
}

/** Raw parameterized SQL rather than the typed Prisma client, so this whole
 *  module stays on the narrow `PrismaLike` interface
 *  (`$queryRawUnsafe`/`$executeRawUnsafe`) its tests mock. */
async function resolvePersonalityId(prisma: PrismaLike, slug: string): Promise<string> {
  const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(PERSONALITY_ID_BY_SLUG_SQL, slug);
  const row = rows[0];
  if (row === undefined) {
    throw new UsageError(`No personality with slug '${slug}'`);
  }
  return row.id;
}

/** @spec MEM-ARCH-029 */
async function selectRows(
  prisma: PrismaLike,
  personalityId: string,
  windowDays: number,
  limit: number,
  includeCold: boolean
): Promise<{ hot: SelectedRow[]; cold: SelectedRow[]; selected: SelectedRow[] }> {
  const hot = await prisma.$queryRawUnsafe<SelectedRow[]>(
    buildSelectionSql('hot'),
    personalityId,
    ARCHIVE_SUMMARY_PROMPT_VERSION,
    windowDays,
    limit
  );
  const remaining = limit - hot.length;
  const cold =
    includeCold && remaining > 0
      ? await prisma.$queryRawUnsafe<SelectedRow[]>(
          buildSelectionSql('cold'),
          personalityId,
          ARCHIVE_SUMMARY_PROMPT_VERSION,
          windowDays,
          remaining
        )
      : [];
  return { hot, cold, selected: [...hot, ...cold] };
}

/** @spec MEM-ARCH-030 */
async function printReport(
  prisma: PrismaLike,
  personalityId: string,
  windowDays: number
): Promise<void> {
  const [counts] = await prisma.$queryRawUnsafe<WindowCounts[]>(
    WINDOW_COUNTS_SQL,
    personalityId,
    ARCHIVE_SUMMARY_PROMPT_VERSION,
    windowDays
  );
  const [factCoverage] = await prisma.$queryRawUnsafe<{ covered: number }[]>(
    FACT_COVERAGE_SQL,
    personalityId,
    windowDays
  );
  const deadRows = await prisma.$queryRawUnsafe<{ error_class: string; row_count: number }[]>(
    DEAD_BY_ERROR_CLASS_SQL,
    personalityId
  );

  console.log(chalk.bold('\nSweep report:'));
  console.log(`  Total non-chunk rows:   ${counts.total_non_chunk}`);
  console.log(`  Retrieved in window:    ${counts.retrieved_in_window}`);
  console.log(
    chalk.dim('  Of the rows retrieved in the window (all counts below share that scope):')
  );
  console.log(`    done (current prompt):  ${counts.done_current}`);
  console.log(`    done (older prompt, re-swept): ${counts.done_older}`);
  console.log(`    done (newer prompt, not re-swept): ${counts.done_newer}`);
  console.log(`    pending:                ${counts.pending}`);
  console.log(`    failed:                 ${counts.failed}`);
  console.log(`    dead (in window):       ${counts.dead}`);
  console.log(`    never attempted:        ${counts.never_attempted}`);
  console.log(`  ${formatGateLine(summarizedShare(counts))}`);
  console.log(
    `  ${formatFactCoverageLine(factCoverageShare(factCoverage.covered, counts.retrieved_in_window))}`
  );
  if (deadRows.length > 0) {
    console.log(
      chalk.dim(
        '  Dead rows by error class (ALL dead rows for this personality, not just the window):'
      )
    );
    for (const row of deadRows) {
      console.log(chalk.dim(`    ${row.error_class}  ${row.row_count}`));
    }
  }
}

/** Loaded state of the settings read, so the caller can decide whether to
 *  honor `archiveSummaryEnqueueEnabled` (unavailable settings fail OPEN,
 *  mirroring the live trigger's own fail-open reading of the switch). */
interface SwitchesAndBudget {
  loaded: boolean;
  enqueueEnabled: boolean | null;
}

/** Degrades to `unavailable` on any failure — never throws. */
async function printSwitchesAndBudget(
  redisUrl: string | null,
  prisma: PrismaClient
): Promise<SwitchesAndBudget> {
  console.log(chalk.bold('\nSwitches:'));
  const settings = new SystemSettingsService(prisma);
  await settings.prime();
  const loaded = settings.isLoaded();
  let enqueueEnabled: boolean | null = null;
  if (loaded) {
    enqueueEnabled = settings.get('archiveSummaryEnqueueEnabled');
    console.log(`  archiveSummaryDailyCap:       ${settings.get('archiveSummaryDailyCap')}`);
    console.log(`  archiveSummaryEnqueueEnabled: ${enqueueEnabled}`);
    console.log(`  archiveSummaryModelEnabled:   ${settings.get('archiveSummaryModelEnabled')}`);
    if (settings.get('archiveSummaryModelEnabled') === false) {
      console.log(
        chalk.yellow(
          '  Model switch is off — enqueued jobs will sit delayed until it is flipped on.'
        )
      );
    }
  } else {
    console.log('  archiveSummaryDailyCap:       unavailable');
    console.log('  archiveSummaryEnqueueEnabled: unavailable');
    console.log('  archiveSummaryModelEnabled:   unavailable');
    console.log(
      chalk.yellow(
        '  Settings unavailable — the model switch may be off; enqueued jobs sit delayed until it is on.'
      )
    );
  }

  let budgetToday = 'unavailable';
  try {
    if (redisUrl !== null) {
      const redis = createInspectorRedis(redisUrl);
      const key = CACHE_KEY_PREFIXES.ARCHIVE_SUMMARY_BUDGET + new Date().toISOString().slice(0, 10);
      const count = await redis.get(key);
      // Capture the read into `budgetToday` BEFORE quitting: a `quit()`
      // rejection below must not clobber a value `get()` already returned
      // successfully.
      budgetToday = count ?? '0';
      try {
        await redis.quit();
      } catch {
        // The read already succeeded and is captured above; a failed
        // disconnect leaves nothing else to clean up here.
      }
    }
  } catch {
    budgetToday = 'unavailable';
  }
  console.log(`  archiveSummaryBudget (today): ${budgetToday}`);
  return { loaded, enqueueEnabled };
}

/** Stamps at most one batch (≤200 ids) in a single statement. */
async function stampBatch(prisma: PrismaLike, ids: string[]): Promise<void> {
  await prisma.$executeRawUnsafe(PENDING_STAMP_SQL, ids);
}

/**
 * @spec MEM-ARCH-029
 *
 * Enqueue and stamp are interleaved batch-by-batch, both inside the `try`
 * that owns the queue — a crash mid-run then leaves stamped every COMPLETED
 * batch; at most one batch (up to 200 rows — a crash between the batch's
 * last add and its stamp leaves the whole batch enqueued but unstamped),
 * and the deterministic jobId makes their re-enqueue on the next sweep a
 * no-op.
 */
async function enqueueSelected(
  redisUrl: string | null,
  env: Environment,
  prisma: PrismaLike,
  personalityId: string,
  selected: SelectedRow[]
): Promise<void> {
  if (redisUrl === null) {
    throw new Error(`Could not resolve a Redis URL for ${env}`);
  }
  const queue = createInspectorQueue(redisUrl, ARCHIVE_SUMMARY_QUEUE_NAME);
  try {
    for (let i = 0; i < selected.length; i += PENDING_STAMP_BATCH_SIZE) {
      const batch = selected.slice(i, i + PENDING_STAMP_BATCH_SIZE);
      for (const row of batch) {
        await queue.add(
          JobType.ArchiveSummary,
          buildArchiveSummaryJobData({ memoryId: row.id, personalityId, reason: 'sweep' }),
          { jobId: row.id, priority: SWEEP_JOB_PRIORITY, ...ARCHIVE_SUMMARY_JOB_OPTIONS }
        );
      }
      await stampBatch(
        prisma,
        batch.map(row => row.id)
      );
    }
  } finally {
    await queue.close();
  }
  console.log(chalk.green(`\n✅ Enqueued ${selected.length} archive-summary sweep jobs`));
}

function assertPositiveInt(value: number, flag: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new UsageError(`${flag} must be a positive integer (got ${value})`);
  }
}

/** Entry point for `pnpm ops memory:summarize`. */
export async function summarizeSweep(options: SummarizeSweepOptions): Promise<void> {
  const windowDays = options.windowDays ?? DEFAULT_WINDOW_DAYS;
  const limit = options.limit ?? DEFAULT_LIMIT;
  assertPositiveInt(limit, '--limit');
  assertPositiveInt(windowDays, '--window');

  validateEnvironment(options.env);
  showEnvironmentBanner(options.env);

  const { prisma, disconnect } = await getPrismaForEnv(options.env);
  try {
    // Resolving the slug is a connect + SELECT, not a mutation — it runs
    // ahead of the prod confirmation so an unknown slug fails fast instead
    // of after the owner has already confirmed.
    const personalityId = await resolvePersonalityId(prisma, options.personality);

    if (options.env === 'prod' && !options.dryRun && !options.force) {
      await requireProductionConfirmation('enqueue archive-summary pre-warm jobs');
    }

    const redisUrl = await getRailwayRedisUrl(options.env);

    const { hot, cold, selected } = await selectRows(
      prisma,
      personalityId,
      windowDays,
      limit,
      options.includeCold === true
    );

    await printReport(prisma, personalityId, windowDays);

    console.log(chalk.bold('\nSelection:'));
    console.log(`  Hot rows:      ${hot.length}`);
    console.log(`  Cold rows:     ${cold.length}`);
    console.log(`  Selected:      ${selected.length}`);
    console.log(`  Estimated input tokens: ${estimateInputTokens(selected)}`);

    const { enqueueEnabled } = await printSwitchesAndBudget(redisUrl, prisma);

    if (options.dryRun === true) {
      console.log(chalk.yellow('\nDry run — no jobs enqueued, no rows stamped.'));
      return;
    }

    // Honors the same kill switch as the live trigger
    // (`ArchiveSummaryTrigger.enqueue`) — `--force` bypasses only the prod
    // confirmation prompt above, never the owner's job-creation switch.
    // `enqueueEnabled === null` means settings were unavailable, which fails
    // OPEN to match the runtime's own fail-open reading of the switch.
    if (enqueueEnabled === false) {
      throw new UsageError(
        'archiveSummaryEnqueueEnabled is off — the sweep creates archive-summary jobs and honors the same kill switch as the live trigger; flip it on with /admin settings set, or re-run with --dry-run for the report only'
      );
    }

    await enqueueSelected(redisUrl, options.env, prisma, personalityId, selected);
  } finally {
    await disconnect();
  }
}
