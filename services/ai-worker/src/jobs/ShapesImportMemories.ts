/**
 * Shapes Import Memory Processing
 *
 * Handles the memory import loop for shapes.inc imports:
 * - Content-based deduplication against existing memories
 * - Per-memory error isolation (failures don't abort the import)
 * - Periodic progress updates to the ImportJob record
 *
 * Extracted from ShapesImportJob.ts to stay within the 400-line ESLint limit.
 */

import { createLogger, type PrismaClient } from '@tzurot/common-types';
import type { Prisma } from '@tzurot/common-types';
import type { PgvectorMemoryAdapter } from '../services/PgvectorMemoryAdapter.js';
import type { MemoryMetadata } from '../services/PgvectorTypes.js';

const logger = createLogger('ShapesImportMemories');

/**
 * Sentinel persona ID for imported memories.
 * Imported memories are global knowledge (not tied to any user's persona interaction),
 * so they use the nil UUID as a system-level placeholder.
 */
const IMPORT_PERSONA_ID = '00000000-0000-0000-0000-000000000000';

/** Update progress in DB every N memories */
const PROGRESS_UPDATE_INTERVAL = 25;

/**
 * Max memories to query for content-based deduplication.
 * 10k covers all known shapes.inc characters (largest observed: ~2k memories).
 * ~1-2MB in-memory Set. Beyond this limit, a warning is logged.
 */
const DEDUP_QUERY_LIMIT = 10_000;

export interface MemoryToImport {
  text: string;
  senders: string[];
  createdAt: number; // ms timestamp
}

export interface ImportMemoriesOpts {
  memoryAdapter: PgvectorMemoryAdapter;
  prisma: PrismaClient;
  memories: MemoryToImport[];
  personalityId: string;
  importJobId: string;
}

export async function importMemories(
  opts: ImportMemoriesOpts
): Promise<{ imported: number; failed: number; skipped: number }> {
  const { memoryAdapter, prisma, memories, personalityId, importJobId } = opts;

  // Build set of existing memory content for content-based deduplication.
  // This handles partial re-imports: if import fails at memory 50/200, retry
  // only imports the remaining 150 instead of skipping all or duplicating.
  // Trade-off: fetch all content upfront (~1-2MB for 10k memories) for O(1) dedup
  // vs. per-memory DB existence checks (slower, lower memory). Shapes.inc datasets
  // fit comfortably in memory; most characters have <2k memories.
  const existingMemories = await prisma.memory.findMany({
    where: { personalityId },
    select: { content: true },
    orderBy: { createdAt: 'desc' },
    take: DEDUP_QUERY_LIMIT,
  });
  const existingContentSet = new Set(existingMemories.map(m => m.content));

  if (existingContentSet.size > 0) {
    logger.info(
      { personalityId, existingCount: existingContentSet.size },
      '[ShapesImportMemories] Found existing memories — will deduplicate by content'
    );
  }
  if (existingMemories.length === DEDUP_QUERY_LIMIT) {
    logger.warn(
      { personalityId },
      '[ShapesImportMemories] Hit 10k memory dedup limit — duplicates beyond this threshold may not be detected'
    );
  }

  let imported = 0;
  let failed = 0;
  let skipped = 0;
  const total = memories.length;

  for (const memory of memories) {
    try {
      if (memory.text.trim().length === 0) {
        continue;
      }

      if (existingContentSet.has(memory.text)) {
        skipped++;
        continue;
      }

      const metadata: MemoryMetadata = {
        personaId: IMPORT_PERSONA_ID,
        personalityId,
        canonScope: 'global',
        createdAt: memory.createdAt,
        senders: memory.senders,
      };

      await memoryAdapter.addMemory({ text: memory.text, metadata });
      imported++;

      // Periodically update progress in the database.
      // Note: this overwrites the entire importMetadata field (not a merge).
      // This is intentional — during import, only progress data exists in the field.
      // markImportCompleted writes the final metadata after the loop finishes.
      if (imported % PROGRESS_UPDATE_INTERVAL === 0) {
        await prisma.importJob.update({
          where: { id: importJobId },
          data: {
            memoriesImported: imported,
            memoriesFailed: failed,
            importMetadata: {
              progress: { imported, failed, skipped, total },
            } as Prisma.InputJsonValue,
          },
        });
      }
    } catch (error) {
      failed++;
      logger.warn({ err: error, personalityId }, '[ShapesImportMemories] Failed to import memory');
    }
  }

  return { imported, failed, skipped };
}
