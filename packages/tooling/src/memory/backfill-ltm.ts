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

import crypto from 'crypto';
import { v5 as uuidv5 } from 'uuid';
import chalk from 'chalk';
import {
  type Environment,
  validateEnvironment,
  showEnvironmentBanner,
  confirmProductionOperation,
} from '../utils/env-runner.js';
import { getPrismaForEnv } from './prisma-env.js';
import type { PrismaClient } from '@tzurot/common-types';

// Deterministic UUID namespace (must match ai-worker/src/utils/memoryUtils.ts)
const DNS_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
const MEMORY_NAMESPACE = uuidv5('tzurot-v3-memory', DNS_NAMESPACE);

export function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 32);
}

export function deterministicMemoryUuid(
  personaId: string,
  personalityId: string,
  content: string
): string {
  const key = `${personaId}:${personalityId}:${hashContent(content)}`;
  return uuidv5(key, MEMORY_NAMESPACE);
}

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

/** Query conversation history for the time range */
export async function queryConversationHistory(
  prisma: PrismaClient,
  from: Date,
  to: Date,
  personalityId?: string
): Promise<ConversationRow[]> {
  if (personalityId !== undefined) {
    return prisma.$queryRaw<ConversationRow[]>`
      SELECT id, channel_id, guild_id, personality_id, persona_id,
             role, content, discord_message_id, created_at
      FROM conversation_history
      WHERE created_at >= ${from}
        AND created_at < ${to}
        AND deleted_at IS NULL
        AND personality_id = ${personalityId}::uuid
      ORDER BY channel_id, personality_id, persona_id, created_at ASC
    `;
  }

  return prisma.$queryRaw<ConversationRow[]>`
    SELECT id, channel_id, guild_id, personality_id, persona_id,
           role, content, discord_message_id, created_at
    FROM conversation_history
    WHERE created_at >= ${from}
      AND created_at < ${to}
      AND deleted_at IS NULL
    ORDER BY channel_id, personality_id, persona_id, created_at ASC
  `;
}

/** Group consecutive user/assistant pairs */
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

    i++; // Skip consumed assistant row
  }

  return pairs;
}

/** Deduplicate pairs via deterministic UUID, format as memory content */
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
