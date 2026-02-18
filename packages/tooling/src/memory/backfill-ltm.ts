/**
 * LTM Backfill Script
 *
 * Recreates long-term memories from conversation_history for a given time range.
 * Useful when memories are lost due to infrastructure issues.
 *
 * Algorithm:
 * 1. Query conversation_history for the time range
 * 2. Group consecutive user/assistant pairs per (channelId, personalityId, personaId)
 * 3. Format as "{user}: <content>\n{assistant}: <content>" (matching LongTermMemoryService)
 * 4. Deduplicate via deterministic UUID
 * 5. Generate embeddings via LocalEmbeddingService
 * 6. Insert with ON CONFLICT DO NOTHING (idempotent)
 */

import chalk from 'chalk';
import {
  type Environment,
  validateEnvironment,
  showEnvironmentBanner,
  confirmProductionOperation,
} from '../utils/env-runner.js';
import { getPrismaForEnv } from './prisma-env.js';
import { deterministicMemoryUuid, Prisma, type PrismaClient } from '@tzurot/common-types';

export interface BackfillOptions {
  env: Environment;
  from: string;
  to: string;
  dryRun?: boolean;
  personalityId?: string;
  force?: boolean;
}

export interface ConversationRow {
  id: string;
  channel_id: string;
  guild_id: string | null;
  personality_id: string;
  persona_id: string;
  role: string;
  content: string;
  discord_message_id: string[];
  created_at: Date;
}

/** Default page size for conversation history queries (bounded per 03-database.md) */
const DEFAULT_PAGE_SIZE = 10_000;

export interface MemoryPair {
  personaId: string;
  personalityId: string;
  channelId: string;
  guildId: string | null;
  userContent: string;
  assistantContent: string;
  userMessageIds: string[];
  assistantMessageIds: string[];
  createdAt: Date;
}

interface PageCursor {
  createdAt: Date;
  id: string;
}

interface PageQuery {
  prisma: PrismaClient;
  from: Date;
  to: Date;
  limit: number;
  cursor: PageCursor | null;
  personalityId?: string;
}

/** Fetch a single page of conversation history using composite cursor pagination */
function queryPage(opts: PageQuery): Promise<ConversationRow[]> {
  const { prisma, from, to, limit, cursor, personalityId } = opts;
  const conditions: Prisma.Sql[] = [
    Prisma.sql`created_at >= ${from}`,
    Prisma.sql`created_at < ${to}`,
    Prisma.sql`deleted_at IS NULL`,
  ];
  if (personalityId !== undefined) {
    conditions.push(Prisma.sql`personality_id = ${personalityId}::uuid`);
  }
  if (cursor !== null) {
    conditions.push(Prisma.sql`(created_at, id) > (${cursor.createdAt}, ${cursor.id}::uuid)`);
  }
  const where = Prisma.join(conditions, ' AND ');

  return prisma.$queryRaw<ConversationRow[]>`
    SELECT id, channel_id, guild_id, personality_id, persona_id,
           role, content, discord_message_id, created_at
    FROM conversation_history
    WHERE ${where}
    ORDER BY created_at ASC, id ASC
    LIMIT ${limit}
  `;
}

/** Compare strings for sort (nulls first) */
function cmp(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  return a < b ? -1 : 1;
}

/**
 * Query all conversation history for the time range using paginated fetches.
 * All rows are accumulated in memory — use narrow --from/--to ranges for busy guilds
 * to avoid excessive memory usage (e.g., weeks of active data can produce 100k+ rows).
 */
export async function queryConversationHistory(
  prisma: PrismaClient,
  from: Date,
  to: Date,
  personalityId?: string,
  pageSize: number = DEFAULT_PAGE_SIZE
): Promise<ConversationRow[]> {
  const allRows: ConversationRow[] = [];
  let cursor: PageCursor | null = null;

  while (true) {
    const page = await queryPage({ prisma, from, to, limit: pageSize, cursor, personalityId });
    allRows.push(...page);

    if (page.length < pageSize) {
      break;
    }
    const last = page[page.length - 1];
    cursor = { createdAt: last.created_at, id: last.id };
  }

  // Pages are fetched in (created_at, id) order for stable cursor pagination,
  // but pairMessages needs rows grouped by conversation context.
  allRows.sort(
    (a, b) =>
      cmp(a.channel_id, b.channel_id) ||
      cmp(a.personality_id, b.personality_id) ||
      cmp(a.persona_id, b.persona_id) ||
      a.created_at.getTime() - b.created_at.getTime()
  );

  return allRows;
}

/**
 * Group consecutive user/assistant pairs.
 * Orphan messages (e.g., two assistants in a row, or a user at end-of-stream)
 * are silently skipped — this is expected for partial conversations.
 */
export function pairMessages(rows: ConversationRow[]): MemoryPair[] {
  const pairs: MemoryPair[] = [];

  for (let i = 0; i < rows.length - 1; i++) {
    const userRow = rows[i];
    const assistantRow = rows[i + 1];

    if (userRow.role !== 'user' || assistantRow.role !== 'assistant') {
      continue;
    }
    if (
      userRow.channel_id !== assistantRow.channel_id ||
      userRow.personality_id !== assistantRow.personality_id ||
      userRow.persona_id !== assistantRow.persona_id
    ) {
      continue;
    }

    pairs.push({
      personaId: userRow.persona_id,
      personalityId: userRow.personality_id,
      channelId: userRow.channel_id,
      guildId: userRow.guild_id,
      userContent: userRow.content,
      assistantContent: assistantRow.content,
      userMessageIds: userRow.discord_message_id,
      assistantMessageIds: assistantRow.discord_message_id,
      createdAt: assistantRow.created_at,
    });

    i++; // Consumed assistant at i+1; loop i++ will advance to i+2
  }

  return pairs;
}

/**
 * Deduplicate pairs via deterministic UUID, format as memory content.
 * Format must match LongTermMemoryService.ts:58 — "{user}: ...\n{assistant}: ..."
 * If the live path changes, backfill embeddings will diverge from live memories.
 */
export function deduplicatePairs(
  pairs: MemoryPair[]
): Map<string, { pair: MemoryPair; content: string }> {
  const uniquePairs = new Map<string, { pair: MemoryPair; content: string }>();
  for (const pair of pairs) {
    const content = `{user}: ${pair.userContent}\n{assistant}: ${pair.assistantContent}`;
    const id = deterministicMemoryUuid(pair.personaId, pair.personalityId, content);
    if (!uniquePairs.has(id)) {
      uniquePairs.set(id, { pair, content });
    }
  }
  return uniquePairs;
}

/** Insert a memory with embedding via raw SQL (idempotent) */
export async function insertMemory(
  prisma: PrismaClient,
  id: string,
  pair: MemoryPair,
  content: string,
  embedding: Float32Array
): Promise<boolean> {
  const embeddingStr = `[${Array.from(embedding).join(',')}]`;
  const messageIds = [...pair.userMessageIds, ...pair.assistantMessageIds];
  const now = new Date();

  const result = await prisma.$executeRaw`
    INSERT INTO memories (
      id, persona_id, personality_id, content, embedding,
      is_summarized, session_id, canon_scope, summary_type,
      channel_id, guild_id, message_ids, senders,
      created_at, updated_at, source_system, type, is_locked, visibility
    ) VALUES (
      ${id}::uuid, ${pair.personaId}::uuid, ${pair.personalityId}::uuid,
      ${content}, ${embeddingStr}::vector,
      false, NULL, 'personal', NULL,
      ${pair.channelId}, ${pair.guildId}, ${messageIds}, ARRAY[]::text[],
      ${pair.createdAt}, ${now}, 'tzurot-v3', 'memory', false, 'normal'
    )
    ON CONFLICT (id) DO NOTHING
  `;

  return result > 0;
}

/** Validate and parse date range options */
function parseDateRange(from: string, to: string): { fromDate: Date; toDate: Date } {
  const fromDate = new Date(from);
  const toDate = new Date(to);

  if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
    console.error(chalk.red('Invalid date format. Use YYYY-MM-DD.'));
    process.exit(1);
  }
  if (fromDate >= toDate) {
    console.error(chalk.red('--from must be before --to'));
    process.exit(1);
  }

  return { fromDate, toDate };
}

/** Print dry-run preview */
function printDryRunPreview(uniquePairs: Map<string, { content: string }>): void {
  console.log(chalk.blue(`\n🔬 DRY RUN — would backfill ${uniquePairs.size} memories`));
  let count = 0;
  for (const [id, { content }] of uniquePairs) {
    if (count >= 5) {
      console.log(chalk.dim(`   ... and ${uniquePairs.size - 5} more`));
      break;
    }
    const preview = content.length > 80 ? content.substring(0, 80) + '...' : content;
    console.log(chalk.dim(`   ${id}: ${preview}`));
    count++;
  }
}

/** Embed and insert all unique pairs, returning stats */
async function embedAndInsert(
  prisma: PrismaClient,
  uniquePairs: Map<string, { pair: MemoryPair; content: string }>
): Promise<{ inserted: number; skipped: number; failed: number }> {
  const { LocalEmbeddingService } = await import('@tzurot/embeddings');
  const embeddingService = new LocalEmbeddingService();
  const initialized = await embeddingService.initialize();
  if (!initialized) {
    console.error(chalk.red('   Failed to initialize embedding service'));
    process.exit(1);
  }

  let inserted = 0;
  let skipped = 0;
  let failed = 0;
  let processed = 0;

  for (const [id, { pair, content }] of uniquePairs) {
    processed++;
    if (processed % 100 === 0) {
      console.log(
        chalk.dim(
          `   Progress: ${processed}/${uniquePairs.size} (${inserted} new, ${skipped} existing)`
        )
      );
    }

    try {
      const embedding = await embeddingService.getEmbedding(content);
      if (embedding === undefined) {
        console.error(chalk.red(`   Failed to generate embedding for ${id}`));
        failed++;
        continue;
      }
      const wasInserted = await insertMemory(prisma, id, pair, content, embedding);
      if (wasInserted) {
        inserted++;
      } else {
        skipped++;
      }
    } catch (error) {
      console.error(
        chalk.red(`   Error inserting ${id}: ${error instanceof Error ? error.message : 'Unknown'}`)
      );
      failed++;
    }
  }

  await embeddingService.shutdown();
  return { inserted, skipped, failed };
}

export async function backfillLongTermMemories(options: BackfillOptions): Promise<void> {
  const { env, from, to, dryRun = false, personalityId, force = false } = options;

  validateEnvironment(env);
  showEnvironmentBanner(env);

  const { fromDate, toDate } = parseDateRange(from, to);

  console.log(chalk.cyan('\n🧠 LTM Backfill'));
  console.log(chalk.dim(`   Range: ${from} → ${to}`));
  if (personalityId !== undefined) {
    console.log(chalk.dim(`   Filter: personality ${personalityId}`));
  }
  if (dryRun) {
    console.log(chalk.blue('   Mode: DRY RUN'));
  }

  if (env === 'prod' && !dryRun && !force) {
    const confirmed = await confirmProductionOperation('backfill memories');
    if (!confirmed) {
      console.log(chalk.yellow('\nOperation cancelled.'));
      return;
    }
  }

  const { prisma, disconnect } = await getPrismaForEnv(env);

  try {
    console.log(chalk.dim('\n   Querying conversation history...'));
    const rows = await queryConversationHistory(prisma, fromDate, toDate, personalityId);
    console.log(chalk.dim(`   Found ${rows.length} messages`));

    if (rows.length === 0) {
      console.log(chalk.yellow('\n   No messages found in range.'));
      return;
    }

    const pairs = pairMessages(rows);
    console.log(chalk.dim(`   Paired into ${pairs.length} user↔assistant exchanges`));

    if (pairs.length === 0) {
      console.log(chalk.yellow('\n   No valid user/assistant pairs found.'));
      return;
    }

    const uniquePairs = deduplicatePairs(pairs);
    const dupCount = pairs.length - uniquePairs.size;
    console.log(
      chalk.dim(`   ${uniquePairs.size} unique memories (${dupCount} duplicates skipped)`)
    );

    if (dryRun) {
      printDryRunPreview(uniquePairs);
      return;
    }

    console.log(chalk.cyan(`\n   Inserting ${uniquePairs.size} memories...`));
    const { inserted, skipped, failed } = await embedAndInsert(prisma, uniquePairs);

    console.log(chalk.green(`\n✅ Backfill complete`));
    console.log(chalk.dim(`   Inserted: ${inserted}`));
    console.log(chalk.dim(`   Already existed: ${skipped}`));
    if (failed > 0) {
      console.log(chalk.yellow(`   Failed: ${failed}`));
    }
    console.log(chalk.dim(`   Total processed: ${uniquePairs.size}`));
  } finally {
    await disconnect();
  }
}
