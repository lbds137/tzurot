/**
 * Memory Duplicate Cleanup
 *
 * Finds and removes duplicate memories caused by the swiss cheese retry loop bug.
 * Duplicates occur when the same user message generates multiple AI responses
 * during retry attempts, each storing a separate memory.
 *
 * Detection criteria:
 * - Same persona_id + personality_id
 * - Same user message prefix (content before "\n{assistant}:")
 * - Created within 60 seconds of each other (retry window)
 *
 * Strategy: Keep the LAST memory (most recent created_at), delete older ones.
 * The most recent memory contains the AI response that users actually saw
 * (the one that passed duplicate detection after all retries completed).
 */

import chalk from 'chalk';
import {
  type Environment,
  validateEnvironment,
  showEnvironmentBanner,
  getRailwayDatabaseUrl,
  confirmProductionOperation,
} from '../utils/env-runner.js';
import { type PrismaClient } from '@tzurot/common-types';

export interface CleanupOptions {
  env: Environment;
  dryRun?: boolean;
  force?: boolean;
  verbose?: boolean;
}

interface DuplicateGroup {
  persona_id: string;
  personality_id: string;
  user_msg_prefix: string;
  count: number;
  first_created: Date;
  last_created: Date;
  ids_to_delete: string[];
}

interface DuplicateSummary {
  totalGroups: number;
  totalDuplicates: number;
  earliestDuplicate: Date | null;
  latestDuplicate: Date | null;
  groups: DuplicateGroup[];
  /** True if results were truncated due to LIMIT (run again after cleanup) */
  truncated: boolean;
}

/**
 * Get Prisma client configured for the specified environment
 *
 * Creates a new PrismaClient with the PrismaPg driver adapter,
 * configured for the specified environment's database URL.
 */
async function getPrismaForEnv(env: Environment): Promise<{
  prisma: PrismaClient;
  disconnect: () => Promise<void>;
}> {
  // Dynamically import to avoid loading Prisma until needed
  const { PrismaClient: PrismaClientClass } = await import('@tzurot/common-types');
  const { PrismaPg } = await import('@prisma/adapter-pg');

  // Get DATABASE_URL for the environment
  let databaseUrl: string;
  if (env === 'local') {
    databaseUrl = process.env.DATABASE_URL ?? '';
    if (!databaseUrl) {
      throw new Error('DATABASE_URL not set for local environment');
    }
  } else {
    // Fetch URL from Railway
    databaseUrl = getRailwayDatabaseUrl(env);
  }

  // Prisma 7.0: Use driver adapter for PostgreSQL
  const adapter = new PrismaPg({ connectionString: databaseUrl });

  // Create a new client instance with the adapter
  const prisma = new PrismaClientClass({
    adapter,
    log: ['error'],
  });

  return {
    prisma,
    disconnect: () => prisma.$disconnect(),
  };
}

/**
 * Find duplicate memory groups
 */
async function findDuplicates(prisma: PrismaClient): Promise<DuplicateSummary> {
  // Use raw SQL for the complex duplicate detection query.
  // The 60-second window is chosen because:
  // 1. Retry loops complete in seconds (typically 3 attempts max with exponential backoff)
  // 2. Network issues or rate limits could extend this, but 60s is generous
  // 3. Legitimate identical messages within 60s are extremely rare in conversation
  // If a user truly sends the same message twice intentionally, they'd likely wait longer.
  const results = await prisma.$queryRaw<
    {
      persona_id: string;
      personality_id: string;
      user_msg_prefix: string;
      count: bigint;
      first_created: Date;
      last_created: Date;
      all_ids: string[];
    }[]
  >`
    WITH memory_with_user_msg AS (
      SELECT
        id,
        persona_id,
        personality_id,
        created_at,
        content,
        SPLIT_PART(content, E'\n{assistant}:', 1) as user_msg_prefix
      FROM memories
      WHERE content LIKE '{user}:%'
        AND content LIKE '%{assistant}:%'
        AND source_system = 'tzurot-v3'
    ),
    duplicate_groups AS (
      SELECT
        persona_id,
        personality_id,
        user_msg_prefix,
        COUNT(*) as count,
        MIN(created_at) as first_created,
        MAX(created_at) as last_created,
        ARRAY_AGG(id ORDER BY created_at DESC) as all_ids
      FROM memory_with_user_msg
      WHERE user_msg_prefix IS NOT NULL AND user_msg_prefix != ''
      GROUP BY persona_id, personality_id, user_msg_prefix
      HAVING COUNT(*) > 1
        AND MAX(created_at) - MIN(created_at) < INTERVAL '60 seconds'
    )
    SELECT * FROM duplicate_groups
    ORDER BY count DESC, first_created DESC
    LIMIT 1000
  `;

  // Query is limited to 1000 groups for bounded memory usage
  const QUERY_LIMIT = 1000;
  const truncated = results.length >= QUERY_LIMIT;

  if (results.length === 0) {
    return {
      totalGroups: 0,
      totalDuplicates: 0,
      earliestDuplicate: null,
      latestDuplicate: null,
      groups: [],
      truncated: false,
    };
  }

  const groups: DuplicateGroup[] = results.map(row => ({
    persona_id: row.persona_id,
    personality_id: row.personality_id,
    user_msg_prefix: row.user_msg_prefix,
    count: Number(row.count),
    first_created: row.first_created,
    last_created: row.last_created,
    // Keep first ID (most recent), delete the older ones
    // The most recent memory is the one users actually saw (after retry loop completed)
    ids_to_delete: row.all_ids.slice(1),
  }));

  const totalDuplicates = groups.reduce((sum, g) => sum + g.ids_to_delete.length, 0);

  return {
    totalGroups: groups.length,
    totalDuplicates,
    earliestDuplicate: groups.length > 0 ? groups[groups.length - 1].first_created : null,
    latestDuplicate: groups.length > 0 ? groups[0].last_created : null,
    groups,
    truncated,
  };
}

/**
 * Delete duplicate memories by their IDs
 * Uses Prisma's deleteMany for type-safe, injection-proof deletion.
 */
async function deleteDuplicates(prisma: PrismaClient, idsToDelete: string[]): Promise<number> {
  if (idsToDelete.length === 0) {
    return 0;
  }

  // Delete in batches to avoid overly long IN clauses
  const BATCH_SIZE = 100;
  let totalDeleted = 0;

  for (let i = 0; i < idsToDelete.length; i += BATCH_SIZE) {
    const batch = idsToDelete.slice(i, i + BATCH_SIZE);
    const result = await prisma.memory.deleteMany({
      where: { id: { in: batch } },
    });
    totalDeleted += result.count;
  }

  return totalDeleted;
}

/** Display the duplicate memory analysis summary */
function displaySummary(summary: DuplicateSummary, verbose: boolean): void {
  console.log(chalk.yellow('📊 Duplicate Memory Analysis'));
  console.log(chalk.yellow('─'.repeat(50)));
  console.log(`   Groups with duplicates: ${chalk.bold(summary.totalGroups)}`);
  console.log(`   Total duplicates to remove: ${chalk.bold(summary.totalDuplicates)}`);
  if (summary.truncated) {
    console.log(chalk.cyan(`   ⚠️  Results truncated to 1000 groups - run again after cleanup`));
  }
  if (summary.earliestDuplicate !== null) {
    console.log(`   Earliest duplicate: ${chalk.dim(summary.earliestDuplicate.toISOString())}`);
  }
  if (summary.latestDuplicate !== null) {
    console.log(`   Latest duplicate: ${chalk.dim(summary.latestDuplicate.toISOString())}`);
  }

  if (verbose) {
    console.log(chalk.dim('\nDetailed breakdown:'));
    for (const group of summary.groups.slice(0, 10)) {
      const preview =
        group.user_msg_prefix.length > 60
          ? group.user_msg_prefix.substring(0, 60) + '...'
          : group.user_msg_prefix;
      console.log(
        chalk.dim(
          `  - ${group.count} copies: "${preview}" (deleting ${group.ids_to_delete.length})`
        )
      );
    }
    if (summary.groups.length > 10) {
      console.log(chalk.dim(`  ... and ${summary.groups.length - 10} more groups`));
    }
  }
}

/** Prompt user for confirmation (non-prod environments) */
async function promptNonProdConfirmation(deleteCount: number): Promise<boolean> {
  const readline = await import('node:readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const answer = await new Promise<string>(resolve => {
    rl.question(chalk.yellow(`\nDelete ${deleteCount} duplicate memories? (y/N): `), resolve);
  });
  rl.close();

  return answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes';
}

/** Print deletion audit log */
function printAuditLog(env: Environment, deletedCount: number, groupCount: number): void {
  console.log(chalk.dim(`\nAudit log:`));
  console.log(chalk.dim(`  Environment: ${env}`));
  console.log(chalk.dim(`  Timestamp: ${new Date().toISOString()}`));
  console.log(chalk.dim(`  Duplicates deleted: ${deletedCount}`));
  console.log(chalk.dim(`  Groups affected: ${groupCount}`));
}

/**
 * Interactive cleanup of duplicate memories
 */
export async function cleanupDuplicateMemories(options: CleanupOptions): Promise<void> {
  const { env, dryRun = false, force = false, verbose = false } = options;

  validateEnvironment(env);
  showEnvironmentBanner(env);
  console.log(chalk.cyan('\n🔍 Analyzing duplicate memories...\n'));

  const { prisma, disconnect } = await getPrismaForEnv(env);

  try {
    const summary = await findDuplicates(prisma);

    if (summary.totalGroups === 0) {
      console.log(chalk.green('✅ No duplicate memories found!'));
      return;
    }

    displaySummary(summary, verbose);

    const allIdsToDelete = summary.groups.flatMap(g => g.ids_to_delete);

    if (dryRun) {
      console.log(chalk.blue('\n🔬 DRY RUN - No changes made'));
      console.log(chalk.blue(`   Would delete ${allIdsToDelete.length} duplicate memories`));
      return;
    }

    // Handle confirmation based on environment
    if (env === 'prod' && !force) {
      console.log('');
      const confirmed = await confirmProductionOperation(
        `delete ${allIdsToDelete.length} duplicate memories`
      );
      if (!confirmed) {
        console.log(chalk.yellow('\nOperation cancelled.'));
        return;
      }
    } else if (env !== 'prod') {
      const confirmed = await promptNonProdConfirmation(allIdsToDelete.length);
      if (!confirmed) {
        console.log(chalk.yellow('Operation cancelled.'));
        return;
      }
    }

    console.log(chalk.cyan('\n🗑️  Deleting duplicates...'));
    const deletedCount = await deleteDuplicates(prisma, allIdsToDelete);
    console.log(chalk.green(`\n✅ Successfully deleted ${deletedCount} duplicate memories`));

    printAuditLog(env, deletedCount, summary.totalGroups);
  } finally {
    await disconnect();
  }
}

/**
 * Analysis-only mode - just show statistics without any prompts
 */
export async function analyzeDuplicateMemories(options: {
  env: Environment;
  verbose?: boolean;
}): Promise<void> {
  const { env, verbose = false } = options;

  validateEnvironment(env);
  showEnvironmentBanner(env);

  console.log(chalk.cyan('\n🔍 Analyzing duplicate memories...\n'));

  const { prisma, disconnect } = await getPrismaForEnv(env);

  try {
    const summary = await findDuplicates(prisma);

    if (summary.totalGroups === 0) {
      console.log(chalk.green('✅ No duplicate memories found!'));
      return;
    }

    // Reuse displaySummary for consistent output
    displaySummary(summary, verbose);

    console.log(chalk.dim('\nRun with --cleanup to remove duplicates'));
    console.log(chalk.dim('Run with --cleanup --dry-run to preview changes'));
  } finally {
    await disconnect();
  }
}
