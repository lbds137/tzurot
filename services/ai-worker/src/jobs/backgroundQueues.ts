/**
 * Background-queue assembly wrapper (fact extraction + memory-archive
 * summarizer).
 *
 * Extracted out of `index.ts` purely to stay under the `max-lines` limit —
 * `index.ts` had 9 lines of headroom left and wiring the archive-summary
 * assembly needed more than that. No behavior change: this is the same two
 * `setup*` calls and the same dispose ordering index.ts used inline.
 */

import type { Redis } from 'ioredis';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import type { BullMQRedisConfig } from '@tzurot/common-types/utils/redis';
import type { LocalEmbeddingService } from '@tzurot/embeddings';
import { setupFactExtraction, type FactExtractionAssembly } from './factExtractionSetup.js';
import { setupArchiveSummary, type ArchiveSummaryAssembly } from './archiveSummarySetup.js';

export interface BackgroundQueues {
  factExtraction: FactExtractionAssembly | undefined;
  archiveSummary: ArchiveSummaryAssembly;
}

export function setupBackgroundQueues(
  prisma: PrismaClient,
  cacheRedis: Redis,
  bullmqConnection: BullMQRedisConfig,
  embeddingService: LocalEmbeddingService | undefined
): BackgroundQueues {
  const factExtraction = setupFactExtraction(
    prisma,
    cacheRedis,
    bullmqConnection,
    embeddingService
  );
  const archiveSummary = setupArchiveSummary(prisma, cacheRedis, bullmqConnection);
  return { factExtraction, archiveSummary };
}

export async function disposeBackgroundQueues(queues: BackgroundQueues): Promise<void> {
  if (queues.factExtraction !== undefined) {
    await queues.factExtraction.worker.close();
    await queues.factExtraction.queue.close();
  }
  await queues.archiveSummary.worker.close();
  await queues.archiveSummary.queue.close();
}
