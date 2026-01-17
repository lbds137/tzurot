/**
 * Backfill Local Embeddings Script
 *
 * Migrates existing memories from OpenAI embeddings (1536 dims) to local BGE embeddings (384 dims).
 * This is Phase 2c of the OpenAI Embedding Eviction plan.
 *
 * Usage:
 *   pnpm --filter @tzurot/scripts run db:backfill-local-embeddings
 *
 * Environment:
 *   DATABASE_URL - PostgreSQL connection string (required)
 *
 * Features:
 * - Processes memories in batches to avoid memory issues
 * - Progress logging with ETA
 * - Graceful interrupt handling (Ctrl+C saves progress)
 * - Resumes from where it left off (skips already-backfilled rows)
 */

import 'dotenv/config';
import { getPrismaClient, createLogger } from '@tzurot/common-types';
import { LocalEmbeddingService, LOCAL_EMBEDDING_DIMENSIONS } from '@tzurot/embeddings';

const logger = createLogger('BackfillLocalEmbeddings');

// Configuration
const BATCH_SIZE = 100;
const PROGRESS_LOG_INTERVAL = 100; // Log progress every N memories

interface BackfillStats {
  total: number;
  processed: number;
  skipped: number;
  failed: number;
  startTime: number;
}

/**
 * Format a vector as PostgreSQL array string for raw SQL
 */
function formatAsVector(embedding: Float32Array): string {
  // Validate: check for NaN or Infinity
  for (let i = 0; i < embedding.length; i++) {
    if (!Number.isFinite(embedding[i])) {
      throw new Error(`Invalid embedding value at index ${i}: ${embedding[i]}`);
    }
  }
  return `[${Array.from(embedding).join(',')}]`;
}

/**
 * Detect which embedding column to use based on current schema state.
 * Pre-cleanup migration: 'embedding_local' column exists
 * Post-cleanup migration: column renamed to 'embedding'
 */
async function detectEmbeddingColumn(
  prisma: ReturnType<typeof getPrismaClient>
): Promise<'embedding_local' | 'embedding'> {
  const result = await prisma.$queryRaw<{ column_name: string }[]>`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'memories' AND column_name IN ('embedding_local', 'embedding')
  `;

  const columns = result.map(r => r.column_name);

  // If embedding_local exists, we're pre-cleanup (use that column)
  if (columns.includes('embedding_local')) {
    return 'embedding_local';
  }

  // Otherwise, we're post-cleanup (use embedding column)
  if (columns.includes('embedding')) {
    return 'embedding';
  }

  throw new Error('No embedding column found in memories table');
}

/**
 * Log progress with ETA
 */
function logProgress(stats: BackfillStats): void {
  const elapsed = (Date.now() - stats.startTime) / 1000;
  const rate = stats.processed / elapsed;
  const remaining = stats.total - stats.processed - stats.skipped;
  const eta = remaining > 0 ? Math.ceil(remaining / rate) : 0;

  const etaFormatted =
    eta > 3600
      ? `${Math.floor(eta / 3600)}h ${Math.floor((eta % 3600) / 60)}m`
      : eta > 60
        ? `${Math.floor(eta / 60)}m ${eta % 60}s`
        : `${eta}s`;

  logger.info(
    {
      processed: stats.processed,
      skipped: stats.skipped,
      failed: stats.failed,
      total: stats.total,
      rate: rate.toFixed(1),
      eta: etaFormatted,
    },
    `[Backfill] Progress: ${stats.processed + stats.skipped}/${stats.total} (${((100 * (stats.processed + stats.skipped)) / stats.total).toFixed(1)}%)`
  );
}

async function main(): Promise<void> {
  logger.info('[Backfill] Starting local embedding backfill...');

  // Validate environment
  if (!process.env.DATABASE_URL) {
    logger.error({}, '[Backfill] DATABASE_URL environment variable is required');
    process.exit(1);
  }

  const prisma = getPrismaClient();

  // Detect schema state (pre or post cleanup migration)
  const embeddingColumn = await detectEmbeddingColumn(prisma);
  logger.info({ embeddingColumn }, '[Backfill] Detected embedding column');

  const embeddingService = new LocalEmbeddingService();

  // Initialize embedding service
  logger.info('[Backfill] Initializing local embedding service...');
  const initialized = await embeddingService.initialize();
  if (!initialized) {
    logger.error({}, '[Backfill] Failed to initialize embedding service');
    process.exit(1);
  }
  logger.info('[Backfill] Embedding service ready');

  // Get count of memories needing backfill (dynamic column name)
  const countResult = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
    `SELECT COUNT(*) as count FROM memories WHERE ${embeddingColumn} IS NULL`
  );
  const totalToBackfill = Number(countResult[0].count);

  const totalResult = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*) as count FROM memories
  `;
  const totalMemories = Number(totalResult[0].count);

  logger.info(
    {
      needsBackfill: totalToBackfill,
      totalMemories,
      alreadyDone: totalMemories - totalToBackfill,
    },
    '[Backfill] Memory statistics'
  );

  if (totalToBackfill === 0) {
    logger.info('[Backfill] All memories already have local embeddings. Nothing to do.');
    await embeddingService.shutdown();
    process.exit(0);
  }

  const stats: BackfillStats = {
    total: totalToBackfill,
    processed: 0,
    skipped: 0,
    failed: 0,
    startTime: Date.now(),
  };

  // Handle graceful shutdown
  let interrupted = false;
  const handleInterrupt = (): void => {
    if (interrupted) {
      logger.warn({}, '[Backfill] Force quitting...');
      process.exit(1);
    }
    interrupted = true;
    logger.warn({}, '[Backfill] Interrupt received, finishing current batch...');
  };
  process.on('SIGINT', handleInterrupt);
  process.on('SIGTERM', handleInterrupt);

  // Process in batches
  while (!interrupted) {
    // Fetch batch of memories without embeddings (dynamic column name)
    const memories = await prisma.$queryRawUnsafe<{ id: string; content: string }[]>(
      `SELECT id, content FROM memories
       WHERE ${embeddingColumn} IS NULL
       ORDER BY created_at ASC
       LIMIT ${BATCH_SIZE}`
    );

    if (memories.length === 0) {
      logger.info('[Backfill] No more memories to process');
      break;
    }

    // Process each memory in the batch
    for (const memory of memories) {
      if (interrupted) break;

      try {
        const embedding = await embeddingService.getEmbedding(memory.content);

        if (embedding === undefined) {
          logger.warn({ memoryId: memory.id }, '[Backfill] Failed to generate embedding');
          stats.failed++;
          continue;
        }

        // Validate dimensions
        if (embedding.length !== LOCAL_EMBEDDING_DIMENSIONS) {
          logger.error(
            {
              memoryId: memory.id,
              expected: LOCAL_EMBEDDING_DIMENSIONS,
              got: embedding.length,
            },
            '[Backfill] Embedding dimension mismatch'
          );
          stats.failed++;
          continue;
        }

        // Update memory with local embedding (dynamic column name)
        const vectorStr = formatAsVector(embedding);
        await prisma.$executeRawUnsafe(
          `UPDATE memories
           SET ${embeddingColumn} = '${vectorStr}'::vector(384)
           WHERE id = '${memory.id}'::uuid`
        );

        stats.processed++;

        // Log progress periodically
        if ((stats.processed + stats.failed) % PROGRESS_LOG_INTERVAL === 0) {
          logProgress(stats);
        }
      } catch (error) {
        logger.error({ err: error, memoryId: memory.id }, '[Backfill] Error processing memory');
        stats.failed++;
      }
    }
  }

  // Final progress log
  logProgress(stats);

  // Post-backfill operations (only if not interrupted)
  if (!interrupted && stats.processed > 0) {
    // Create index CONCURRENTLY (doesn't block reads/writes)
    const indexName =
      embeddingColumn === 'embedding_local'
        ? 'idx_memories_embedding_local'
        : 'idx_memories_embedding';

    logger.info({ indexName }, '[Backfill] Creating IVFFlat index CONCURRENTLY...');
    try {
      await prisma.$executeRawUnsafe(
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS ${indexName}
         ON memories USING ivfflat (${embeddingColumn} vector_cosine_ops)
         WITH (lists = 50)`
      );
      logger.info({ indexName }, '[Backfill] Index created successfully');
    } catch (error) {
      logger.error({ err: error }, '[Backfill] Failed to create index - create manually');
    }

    // Update table statistics for query planner
    logger.info('[Backfill] Running VACUUM ANALYZE...');
    try {
      await prisma.$executeRaw`VACUUM ANALYZE memories`;
      logger.info('[Backfill] VACUUM ANALYZE complete');
    } catch (error) {
      logger.error({ err: error }, '[Backfill] VACUUM ANALYZE failed - run manually');
    }
  }

  // Shutdown
  await embeddingService.shutdown();

  const elapsed = ((Date.now() - stats.startTime) / 1000).toFixed(1);
  logger.info(
    {
      processed: stats.processed,
      failed: stats.failed,
      elapsed: `${elapsed}s`,
      avgRate: (stats.processed / parseFloat(elapsed)).toFixed(1),
    },
    '[Backfill] Backfill complete!'
  );

  if (interrupted) {
    logger.warn(
      {},
      '[Backfill] Script was interrupted. Run again to continue from where it left off.'
    );
  }

  process.exit(stats.failed > 0 ? 1 : 0);
}

main().catch((error: unknown) => {
  logger.fatal({ err: error }, '[Backfill] Fatal error');
  process.exit(1);
});
