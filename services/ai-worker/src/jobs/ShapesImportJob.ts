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
} from '../services/shapes/ShapesDataFetcher.js';
import { mapShapesConfigToPersonality } from '../services/shapes/ShapesPersonalityMapper.js';
import type { PgvectorMemoryAdapter } from '../services/PgvectorMemoryAdapter.js';
import type { MemoryMetadata } from '../services/PgvectorTypes.js';

const logger = createLogger('ShapesImportJob');

/** Default persona ID for imported memories (system-level) */
const IMPORT_PERSONA_ID = '00000000-0000-0000-0000-000000000000';

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

    // 5. Import memories (skips if personality already has memories — prevents duplicates on re-import)
    const memoryStats = await importMemories(
      memoryAdapter,
      prisma,
      fetchResult.memories.map(m => ({
        text: m.result,
        senders: m.senders,
        createdAt: m.metadata.created_at * 1000,
      })),
      personalityId
    );

    // 6. Mark completed
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

  logger.error(
    {
      err: opts.error,
      jobId: opts.jobId,
      sourceSlug: opts.sourceSlug,
      isAuthError: opts.error instanceof ShapesAuthError,
      isNotFound: opts.error instanceof ShapesNotFoundError,
    },
    '[ShapesImportJob] Import failed'
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

async function createFullPersonality(
  prisma: PrismaClient,
  config: ShapesIncPersonalityConfig,
  slug: string,
  ownerId: string
): Promise<{ personalityId: string; slug: string }> {
  const mapped = mapShapesConfigToPersonality(config, slug);

  // Create system prompt
  await prisma.systemPrompt.upsert({
    where: { id: mapped.systemPrompt.id },
    create: {
      id: mapped.systemPrompt.id,
      name: mapped.systemPrompt.name,
      content: mapped.systemPrompt.content,
    },
    update: {
      content: mapped.systemPrompt.content,
    },
  });

  // Create personality
  const customFieldsJson = (mapped.personality.customFields ?? undefined) as
    | Prisma.InputJsonValue
    | undefined;
  await prisma.personality.upsert({
    where: { slug: mapped.personality.slug },
    create: {
      ...mapped.personality,
      customFields: customFieldsJson,
      ownerId,
      systemPromptId: mapped.systemPrompt.id,
    },
    update: {
      characterInfo: mapped.personality.characterInfo,
      personalityTraits: mapped.personality.personalityTraits,
      personalityTone: mapped.personality.personalityTone,
      personalityAge: mapped.personality.personalityAge,
      personalityAppearance: mapped.personality.personalityAppearance,
      personalityLikes: mapped.personality.personalityLikes,
      personalityDislikes: mapped.personality.personalityDislikes,
      conversationalGoals: mapped.personality.conversationalGoals,
      conversationalExamples: mapped.personality.conversationalExamples,
      errorMessage: mapped.personality.errorMessage,
      customFields: customFieldsJson,
      systemPromptId: mapped.systemPrompt.id,
    },
  });

  // Create LLM config and link as default
  const advancedParamsJson = mapped.llmConfig.advancedParameters as Prisma.InputJsonValue;
  await prisma.llmConfig.upsert({
    where: { id: mapped.llmConfig.id },
    create: {
      id: mapped.llmConfig.id,
      name: mapped.llmConfig.name,
      description: mapped.llmConfig.description,
      model: mapped.llmConfig.model,
      provider: mapped.llmConfig.provider,
      advancedParameters: advancedParamsJson,
      memoryScoreThreshold: mapped.llmConfig.memoryScoreThreshold,
      memoryLimit: mapped.llmConfig.memoryLimit,
      contextWindowTokens: mapped.llmConfig.contextWindowTokens,
      maxMessages: mapped.llmConfig.maxMessages,
      ownerId,
      isGlobal: false,
      isDefault: false,
    },
    update: {
      model: mapped.llmConfig.model,
      advancedParameters: advancedParamsJson,
      memoryScoreThreshold: mapped.llmConfig.memoryScoreThreshold,
      memoryLimit: mapped.llmConfig.memoryLimit,
      maxMessages: mapped.llmConfig.maxMessages,
    },
  });

  // Link as default config for this personality
  await prisma.personalityDefaultConfig.upsert({
    where: { personalityId: mapped.personality.id },
    create: {
      personalityId: mapped.personality.id,
      llmConfigId: mapped.llmConfig.id,
    },
    update: {
      llmConfigId: mapped.llmConfig.id,
    },
  });

  logger.info(
    { personalityId: mapped.personality.id, slug: mapped.personality.slug },
    '[ShapesImportJob] Created/updated personality with LLM config'
  );

  return { personalityId: mapped.personality.id, slug: mapped.personality.slug };
}

interface MemoryToImport {
  text: string;
  senders: string[];
  createdAt: number; // ms timestamp
}

async function importMemories(
  memoryAdapter: PgvectorMemoryAdapter,
  prisma: PrismaClient,
  memories: MemoryToImport[],
  personalityId: string
): Promise<{ imported: number; failed: number; skipped: number }> {
  // Check for existing memories to prevent duplicates on re-import
  const existingCount = await prisma.memory.count({
    where: { personalityId },
  });

  if (existingCount > 0) {
    logger.info(
      { personalityId, existingCount },
      '[ShapesImportJob] Personality already has memories — skipping memory import to prevent duplicates'
    );
    return { imported: 0, failed: 0, skipped: memories.length };
  }

  let imported = 0;
  let failed = 0;

  for (const memory of memories) {
    try {
      if (memory.text.trim().length === 0) {
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
    } catch (error) {
      failed++;
      logger.warn({ err: error, personalityId }, '[ShapesImportJob] Failed to import memory');
    }
  }

  return { imported, failed, skipped: 0 };
}
