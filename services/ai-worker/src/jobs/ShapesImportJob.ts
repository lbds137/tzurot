/**
 * Shapes.inc Import Job Processor
 *
 * BullMQ job handler that orchestrates the full shapes.inc import pipeline:
 * 1. Decrypt session cookie from UserCredential
 * 2. Fetch data from shapes.inc via ShapesDataFetcher
 * 3. Create Personality + SystemPrompt + LlmConfig via PersonalityMapper
 * 4. Import memories into pgvector
 * 5. Update ImportJob status with results
 *
 * For 'memory_only' imports, skips personality creation and just imports
 * memories into an existing personality.
 */

import type { Job } from 'bullmq';
import {
  createLogger,
  decryptApiKey,
  encryptApiKey,
  type PrismaClient,
  type ShapesImportJobData,
  type ShapesImportJobResult,
  type ShapesIncPersonalityConfig,
  type ShapesDataFetchResult,
  CREDENTIAL_SERVICES,
  CREDENTIAL_TYPES,
} from '@tzurot/common-types';
import type { Prisma } from '@tzurot/common-types';
import {
  ShapesDataFetcher,
  ShapesAuthError,
  ShapesNotFoundError,
  ShapesRateLimitError,
} from '../services/shapes/ShapesDataFetcher.js';
import { createFullPersonality, downloadAndStoreAvatar } from './ShapesImportHelpers.js';
import type { PgvectorMemoryAdapter } from '../services/PgvectorMemoryAdapter.js';
import type { MemoryMetadata } from '../services/PgvectorTypes.js';

const logger = createLogger('ShapesImportJob');

/**
 * Sentinel persona ID for imported memories.
 * Imported memories are global knowledge (not tied to any user's persona interaction),
 * so they use the nil UUID as a system-level placeholder.
 */
const IMPORT_PERSONA_ID = '00000000-0000-0000-0000-000000000000';

/** Update progress in DB every N memories */
const PROGRESS_UPDATE_INTERVAL = 25;

interface ShapesImportJobDeps {
  prisma: PrismaClient;
  memoryAdapter: PgvectorMemoryAdapter;
}

/**
 * Process a shapes.inc import job.
 */
export async function processShapesImportJob(
  job: Job<ShapesImportJobData>,
  deps: ShapesImportJobDeps
): Promise<ShapesImportJobResult> {
  const { prisma, memoryAdapter } = deps;
  const { userId, discordUserId, sourceSlug, importJobId, importType, existingPersonalityId } =
    job.data;

  logger.info(
    { jobId: job.id, sourceSlug, importType, userId: discordUserId },
    '[ShapesImportJob] Starting import'
  );

  // 1. Mark import as in_progress
  await updateImportJobStatus(prisma, importJobId, 'in_progress');

  try {
    // 2. Decrypt session cookie
    const sessionCookie = await getDecryptedCookie(prisma, userId);

    // 3. Fetch data from shapes.inc
    const fetcher = new ShapesDataFetcher();
    const fetchResult = await fetcher.fetchShapeData(sourceSlug, { sessionCookie });
    await persistUpdatedCookie(prisma, userId, fetcher.getUpdatedCookie());

    // 4. Create or resolve personality
    const { personalityId, slug: personalitySlug } = await resolvePersonality({
      prisma,
      config: fetchResult.config,
      sourceSlug,
      userId,
      importType,
      existingPersonalityId,
    });

    // 5. Download and store avatar
    if (fetchResult.config.avatar !== '' && importType !== 'memory_only') {
      await downloadAndStoreAvatar(prisma, personalityId, fetchResult.config.avatar);
    }

    // 6. Import memories (skips if personality already has memories — prevents duplicates on re-import)
    const memoryStats = await importMemories({
      memoryAdapter,
      prisma,
      memories: fetchResult.memories.map(m => ({
        text: m.result,
        senders: m.senders,
        createdAt: m.metadata.created_at * 1000,
      })),
      personalityId,
      importJobId,
    });

    // 7. Mark completed
    await markImportCompleted({ prisma, importJobId, personalityId, memoryStats, fetchResult });

    const result: ShapesImportJobResult = {
      success: true,
      personalityId,
      personalitySlug,
      memoriesImported: memoryStats.imported,
      memoriesFailed: memoryStats.failed,
      importType,
    };
    logger.info({ jobId: job.id, ...result }, '[ShapesImportJob] Import completed successfully');
    return result;
  } catch (error) {
    return handleImportError({ error, prisma, importJobId, importType, jobId: job.id, sourceSlug });
  }
}

// ============================================================================
// Helpers
// ============================================================================

async function getDecryptedCookie(prisma: PrismaClient, userId: string): Promise<string> {
  const credential = await prisma.userCredential.findFirst({
    where: {
      userId,
      service: CREDENTIAL_SERVICES.SHAPES_INC,
      credentialType: CREDENTIAL_TYPES.SESSION_COOKIE,
    },
  });

  if (credential === null) {
    throw new ShapesAuthError('No shapes.inc credentials found. Use /shapes auth first.');
  }

  return decryptApiKey({
    iv: credential.iv,
    content: credential.content,
    tag: credential.tag,
  });
}

async function persistUpdatedCookie(
  prisma: PrismaClient,
  userId: string,
  updatedCookie: string
): Promise<void> {
  try {
    const encrypted = encryptApiKey(updatedCookie);
    await prisma.userCredential.updateMany({
      where: {
        userId,
        service: CREDENTIAL_SERVICES.SHAPES_INC,
        credentialType: CREDENTIAL_TYPES.SESSION_COOKIE,
      },
      data: {
        iv: encrypted.iv,
        content: encrypted.content,
        tag: encrypted.tag,
        lastUsedAt: new Date(),
      },
    });
  } catch (error) {
    // Non-fatal — cookie may be stale for next use, but import already succeeded
    logger.warn({ err: error }, '[ShapesImportJob] Failed to persist updated cookie');
  }
}

async function updateImportJobStatus(
  prisma: PrismaClient,
  importJobId: string,
  status: string
): Promise<void> {
  await prisma.importJob.update({
    where: { id: importJobId },
    data: {
      status,
      startedAt: status === 'in_progress' ? new Date() : undefined,
    },
  });
}

const IMPORT_TYPE_MEMORY_ONLY = 'memory_only' as const;

interface ResolvePersonalityOpts {
  prisma: PrismaClient;
  config: ShapesIncPersonalityConfig;
  sourceSlug: string;
  userId: string;
  importType: string;
  existingPersonalityId?: string;
}

async function resolvePersonality(
  opts: ResolvePersonalityOpts
): Promise<{ personalityId: string; slug: string }> {
  if (opts.importType !== IMPORT_TYPE_MEMORY_ONLY) {
    return createFullPersonality(opts.prisma, opts.config, opts.sourceSlug, opts.userId);
  }
  if (opts.existingPersonalityId === undefined) {
    throw new Error('existingPersonalityId is required for memory_only imports');
  }
  return { personalityId: opts.existingPersonalityId, slug: opts.sourceSlug };
}

interface MarkCompletedOpts {
  prisma: PrismaClient;
  importJobId: string;
  personalityId: string;
  memoryStats: { imported: number; failed: number; skipped: number };
  fetchResult: ShapesDataFetchResult;
}

async function markImportCompleted(opts: MarkCompletedOpts): Promise<void> {
  await opts.prisma.importJob.update({
    where: { id: opts.importJobId },
    data: {
      status: 'completed',
      personalityId: opts.personalityId,
      memoriesImported: opts.memoryStats.imported,
      memoriesFailed: opts.memoryStats.failed,
      completedAt: new Date(),
      importMetadata: {
        storiesCount: opts.fetchResult.stats.storiesCount,
        pagesTraversed: opts.fetchResult.stats.pagesTraversed,
        hasUserPersonalization: opts.fetchResult.userPersonalization !== null,
        memoriesSkipped: opts.memoryStats.skipped,
      } as Prisma.InputJsonValue,
    },
  });
}

interface HandleErrorOpts {
  error: unknown;
  prisma: PrismaClient;
  importJobId: string;
  importType: 'full' | typeof IMPORT_TYPE_MEMORY_ONLY;
  jobId: string | undefined;
  sourceSlug: string;
}

async function handleImportError(opts: HandleErrorOpts): Promise<ShapesImportJobResult> {
  const errorMessage = opts.error instanceof Error ? opts.error.message : String(opts.error);

  const isRateLimited = opts.error instanceof ShapesRateLimitError;
  logger.error(
    {
      err: opts.error,
      jobId: opts.jobId,
      sourceSlug: opts.sourceSlug,
      isAuthError: opts.error instanceof ShapesAuthError,
      isNotFound: opts.error instanceof ShapesNotFoundError,
      isRateLimited,
    },
    isRateLimited
      ? '[ShapesImportJob] Rate limited by shapes.inc — BullMQ will retry'
      : '[ShapesImportJob] Import failed'
  );

  await opts.prisma.importJob.update({
    where: { id: opts.importJobId },
    data: { status: 'failed', completedAt: new Date(), errorMessage },
  });

  return {
    success: false,
    memoriesImported: 0,
    memoriesFailed: 0,
    importType: opts.importType,
    error: errorMessage,
  };
}

interface MemoryToImport {
  text: string;
  senders: string[];
  createdAt: number; // ms timestamp
}

interface ImportMemoriesOpts {
  memoryAdapter: PgvectorMemoryAdapter;
  prisma: PrismaClient;
  memories: MemoryToImport[];
  personalityId: string;
  importJobId: string;
}

async function importMemories(
  opts: ImportMemoriesOpts
): Promise<{ imported: number; failed: number; skipped: number }> {
  const { memoryAdapter, prisma, memories, personalityId, importJobId } = opts;

  // Build set of existing memory content for content-based deduplication.
  // This handles partial re-imports: if import fails at memory 50/200, retry
  // only imports the remaining 150 instead of skipping all or duplicating.
  const existingMemories = await prisma.memory.findMany({
    where: { personalityId },
    select: { content: true },
    take: 10_000,
  });
  const existingContentSet = new Set(existingMemories.map(m => m.content));

  if (existingContentSet.size > 0) {
    logger.info(
      { personalityId, existingCount: existingContentSet.size },
      '[ShapesImportJob] Found existing memories — will deduplicate by content'
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

      // Periodically update progress in the database
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
      logger.warn({ err: error, personalityId }, '[ShapesImportJob] Failed to import memory');
    }
  }

  return { imported, failed, skipped };
}
