#!/usr/bin/env tsx
/**
 * Cleanup Corrupted Memories
 *
 * Deletes memories with invalid timestamps (year > 9999) that were created
 * due to the timestamp * 1000 bug before the fix.
 *
 * Run with DRY_RUN=true to preview without deleting.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function log(message: string, data?: any) {
  console.log(`[CleanupCorruptedMemories] ${message}`, data || '');
}

const DRY_RUN = process.env.DRY_RUN === 'true';

async function main() {
  logger.info('=== Cleaning up corrupted memories ===');
  logger.info(`Mode: ${DRY_RUN ? 'DRY RUN (no deletes)' : 'LIVE (will delete)'}`);

  try {
    // Find memories with timestamps beyond year 9999
    // (These are corrupted from the timestamp * 1000 bug)
    const corrupted = await prisma.$queryRaw<Array<{ id: string; created_at: Date }>>`
      SELECT id, created_at
      FROM memories
      WHERE created_at > '9999-12-31'::timestamptz
      ORDER BY created_at DESC
    `;

    logger.info(`Found ${corrupted.length} corrupted memories`);

    if (corrupted.length === 0) {
      logger.info('No corrupted memories to clean up!');
      await prisma.$disconnect();
      return;
    }

    // Show sample of corrupted timestamps
    logger.info('Sample of corrupted timestamps:');
    corrupted.slice(0, 5).forEach(m => {
      logger.info(`  ${m.id}: ${m.created_at}`);
    });

    if (!DRY_RUN) {
      // Delete corrupted memories
      const result = await prisma.$executeRaw`
        DELETE FROM memories
        WHERE created_at > '9999-12-31'::timestamptz
      `;

      logger.info(`Deleted ${result} corrupted memories`);
    } else {
      logger.info(`[DRY RUN] Would delete ${corrupted.length} corrupted memories`);
    }

    // Also check pending_memories for corrupted data
    const corruptedPending = await prisma.pendingMemory.findMany({
      select: { id: true, createdAt: true },
    });

    const futurePending = corruptedPending.filter(p => {
      return p.createdAt.getFullYear() > 9999;
    });

    if (futurePending.length > 0) {
      logger.info(`Found ${futurePending.length} corrupted pending_memories`);

      if (!DRY_RUN) {
        for (const p of futurePending) {
          await prisma.pendingMemory.delete({ where: { id: p.id } });
        }
        logger.info(`Deleted ${futurePending.length} corrupted pending_memories`);
      } else {
        logger.info(`[DRY RUN] Would delete ${futurePending.length} corrupted pending_memories`);
      }
    }
  } catch (error) {
    logger.error({ err: error }, 'Failed to cleanup corrupted memories');
    throw error;
  } finally {
    await prisma.$disconnect();
  }

  logger.info('Cleanup complete!');
}

main().catch(error => {
  logger.error({ err: error }, 'Fatal error');
  process.exit(1);
});
