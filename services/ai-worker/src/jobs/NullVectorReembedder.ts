/**
 * NULL-vector memory self-healing sweep (PendingMemoryProcessor sibling).
 *
 * A memory's embedding goes NULL when an edit lands during embedding-service
 * downtime — correct at write time (invisible beats wrongly-matched), but
 * nothing re-embedded it afterward: the memory silently stayed out of RAG
 * until the user coincidentally edited it again. For a product whose core IS
 * persona memory, that's the platform quietly forgetting while appearing to
 * work.
 *
 * This sweep finds `embedding IS NULL AND visibility = 'normal'` rows and
 * re-embeds them (bounded batch, oldest first). Idempotent: the adapter's
 * UPDATE re-checks the NULL guard, so concurrent edits and repeat runs are
 * safe. Runs on the scheduled-jobs queue; deliberately minimal so the
 * memory-architecture Phase-5 consolidation work subsumes it cleanly.
 */

import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { type PgvectorMemoryAdapter } from '../services/PgvectorMemoryAdapter.js';

const logger = createLogger('NullVectorReembedder');

/** Bounded batch per run — a backlog heals over successive runs. */
const SWEEP_BATCH_SIZE = 50;

export interface SweepStats {
  scanned: number;
  reembedded: number;
  failed: number;
}

export class NullVectorReembedder {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly memoryManager?: PgvectorMemoryAdapter
  ) {}

  /** One sweep pass. Never throws — a failed row logs and counts. */
  async sweep(): Promise<SweepStats> {
    if (this.memoryManager === undefined) {
      return { scanned: 0, reembedded: 0, failed: 0 };
    }

    // Raw SQL: `embedding` is Unsupported("vector") in Prisma, so the typed
    // client can't express `embedding IS NULL`.
    const rows = await this.prisma.$queryRaw<{ id: string; content: string }[]>`
      SELECT id, content FROM memories
      WHERE embedding IS NULL AND visibility = 'normal'
      ORDER BY created_at ASC
      LIMIT ${SWEEP_BATCH_SIZE}
    `;
    if (rows.length === 0) {
      return { scanned: 0, reembedded: 0, failed: 0 };
    }

    let reembedded = 0;
    let failed = 0;
    for (const row of rows) {
      try {
        const updated = await this.memoryManager.reembedMemory(row.id, row.content);
        if (updated) {
          reembedded += 1;
        }
        // !updated = the row healed or changed state concurrently — not a failure.
      } catch (error) {
        failed += 1;
        logger.warn(
          { err: error, memoryId: row.id },
          'NULL-vector re-embed failed — row stays invisible until the next sweep'
        );
      }
    }

    logger.info({ scanned: rows.length, reembedded, failed }, 'NULL-vector sweep complete');
    return { scanned: rows.length, reembedded, failed };
  }
}
