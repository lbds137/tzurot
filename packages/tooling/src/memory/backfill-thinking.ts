/**
 * Backfill `memories.thinking_content` from `conversation_history.thinking_content`.
 *
 * Pairs candidate v3 memories (first chunk, missing `thinking_content`, with a
 * stored Discord message id) back to their originating user turn and the first
 * subsequent row in the same channel, personality, and persona within 30 minutes.
 * When that row is an assistant turn with a non-empty `thinking_content` and its
 * 40-char prefix appears in the memory text, copies `thinking_content` via raw
 * SQL so `memories.updated_at` is not bumped.
 *
 * Privacy: never prints or logs `thinking_content` or message text — only
 * aggregate counts.
 */

import chalk from 'chalk';
import {
  type Environment,
  validateEnvironment,
  showEnvironmentBanner,
  requireProductionConfirmation,
} from '../utils/env-runner.js';
import { UsageError } from '../utils/errors.js';
import { getPrismaForEnv } from './prisma-env.js';

export const DEFAULT_BATCH_SIZE = 500;

const INITIAL_CURSOR_UUID = '00000000-0000-0000-0000-000000000000';

export interface BackfillThinkingCliOptions {
  env?: Environment;
  dryRun?: boolean;
  batchSize?: string;
  force?: boolean;
}

export interface BackfillThinkingOptions {
  env: Environment;
  dryRun?: boolean;
  batchSize?: number;
  force?: boolean;
}

export interface CandidatePairRow {
  id: string;
  user_found: boolean | null;
  assistant_role: string | null;
  thinking_content: string | null;
  guard_ok: boolean | null;
}

export interface BackfillThinkingResult {
  candidates: number;
  paired: number;
  skipped_no_history: number;
  skipped_interleaved: number;
  skipped_guard: number;
  skipped_no_trace: number;
  writable: number;
  updated: number;
}

export interface ThinkingBackfillPrisma {
  $queryRaw: <T = unknown>(query: TemplateStringsArray, ...values: unknown[]) => Promise<T>;
  $executeRaw: (query: TemplateStringsArray, ...values: unknown[]) => Promise<number>;
}

/**
 * Fetch one cursor page of candidate memories paired against `conversation_history`.
 * All pairing and head-40 guard checks run inside Postgres so message text never
 * crosses into application logs or stdout.
 */
export function queryCandidateBatch(
  prisma: ThinkingBackfillPrisma,
  cursor: string,
  batchSize: number
): Promise<CandidatePairRow[]> {
  return prisma.$queryRaw<CandidatePairRow[]>`
    SELECT
      m.id,
      u.id IS NOT NULL AS user_found,
      a.role AS assistant_role,
      a.thinking_content,
      (length(a.content) > 0 AND position(left(a.content, 40) IN m.content) > 0) AS guard_ok
    FROM memories m
    LEFT JOIN LATERAL (
      SELECT u.id, u.channel_id, u.personality_id, u.persona_id, u.created_at
      FROM conversation_history u
      WHERE u.role = 'user'
        AND m.message_ids[1] = ANY(u.discord_message_id)
        AND u.personality_id = m.personality_id
        AND u.persona_id = m.persona_id
      ORDER BY u.created_at ASC
      LIMIT 1
    ) u ON TRUE
    LEFT JOIN LATERAL (
      SELECT a.role, a.content, a.thinking_content
      FROM conversation_history a
      WHERE a.channel_id = u.channel_id
        AND a.personality_id = u.personality_id
        AND a.persona_id = u.persona_id
        AND a.created_at > u.created_at
        AND a.created_at < u.created_at + interval '30 minutes'
      ORDER BY a.created_at ASC
      LIMIT 1
    ) a ON u.id IS NOT NULL
    WHERE m.source_system = 'tzurot-v3'
      AND coalesce(m.chunk_index, 0) = 0
      AND m.thinking_content IS NULL
      AND m.message_ids[1] IS NOT NULL
      AND m.id > ${cursor}::uuid
    ORDER BY m.id ASC
    LIMIT ${batchSize}
  `;
}

/**
 * Write `thinking_content` via raw SQL so `updated_at` is not bumped
 * (see `.claude/rules/03-database.md` § Sync-Tracked Tables).
 */
export function updateThinkingContent(
  prisma: ThinkingBackfillPrisma,
  id: string,
  trace: string
): Promise<number> {
  return prisma.$executeRaw`
    UPDATE memories
    SET thinking_content = ${trace}
    WHERE id = ${id}::uuid
      AND thinking_content IS NULL
  `;
}

export type RowVerdict =
  | { verdict: 'write'; trace: string }
  | { verdict: 'no_history' }
  | { verdict: 'interleaved' }
  | { verdict: 'no_trace' }
  | { verdict: 'guard' };

/**
 * Classify a candidate row into its backfill verdict.
 */
export function classifyCandidateRow(row: CandidatePairRow): RowVerdict {
  if (row.user_found !== true) {
    return { verdict: 'no_history' };
  }

  if (row.assistant_role !== 'assistant') {
    return { verdict: 'interleaved' };
  }

  if (row.thinking_content === null || row.thinking_content.trim() === '') {
    return { verdict: 'no_trace' };
  }

  if (row.guard_ok !== true) {
    return { verdict: 'guard' };
  }

  return { verdict: 'write', trace: row.thinking_content };
}

async function processCandidateBatch(
  prisma: ThinkingBackfillPrisma,
  batch: CandidatePairRow[],
  stats: BackfillThinkingResult,
  dryRun: boolean
): Promise<void> {
  for (const row of batch) {
    stats.candidates++;
    const classified = classifyCandidateRow(row);

    if (classified.verdict === 'no_history') {
      stats.skipped_no_history++;
      continue;
    }

    if (classified.verdict === 'interleaved') {
      stats.skipped_interleaved++;
      continue;
    }
    stats.paired++;

    if (classified.verdict === 'no_trace') {
      stats.skipped_no_trace++;
      continue;
    }

    if (classified.verdict === 'guard') {
      stats.skipped_guard++;
      continue;
    }

    stats.writable++;
    if (!dryRun) {
      const updatedCount = await updateThinkingContent(prisma, row.id, classified.trace);
      stats.updated += updatedCount;
    }
  }
}

function printSummary(stats: BackfillThinkingResult, dryRun: boolean): void {
  console.log(chalk.cyan('\n🧠 Thinking Backfill Summary'));
  if (dryRun) {
    console.log(chalk.blue('   mode: dry-run'));
  }
  console.log(`   candidates: ${stats.candidates}`);
  console.log(`   paired: ${stats.paired}`);
  console.log(`   skipped_no_history: ${stats.skipped_no_history}`);
  console.log(`   skipped_interleaved: ${stats.skipped_interleaved}`);
  console.log(`   skipped_guard: ${stats.skipped_guard}`);
  console.log(`   skipped_no_trace: ${stats.skipped_no_trace}`);
  console.log(`   writable: ${stats.writable}`);
  console.log(`   updated: ${stats.updated}`);
}

/** Entry point for `pnpm ops memory:backfill-thinking`. */
export async function backfillThinking(
  options: BackfillThinkingOptions
): Promise<BackfillThinkingResult> {
  const { env, dryRun = false, batchSize = DEFAULT_BATCH_SIZE, force = false } = options;

  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new UsageError(`--batch-size must be a positive integer (got ${batchSize})`);
  }

  validateEnvironment(env);
  showEnvironmentBanner(env);

  if (env === 'prod' && !dryRun && !force) {
    await requireProductionConfirmation('backfill thinking_content onto memories');
  }

  const { prisma, disconnect } = await getPrismaForEnv(env);
  const stats: BackfillThinkingResult = {
    candidates: 0,
    paired: 0,
    skipped_no_history: 0,
    skipped_interleaved: 0,
    skipped_guard: 0,
    skipped_no_trace: 0,
    writable: 0,
    updated: 0,
  };

  try {
    let cursor = INITIAL_CURSOR_UUID;

    while (true) {
      const batch = await queryCandidateBatch(prisma, cursor, batchSize);
      if (batch.length === 0) {
        break;
      }

      await processCandidateBatch(prisma, batch, stats, dryRun);

      cursor = batch[batch.length - 1].id;
      if (batch.length < batchSize) {
        break;
      }
    }

    printSummary(stats, dryRun);
    return stats;
  } finally {
    await disconnect();
  }
}
