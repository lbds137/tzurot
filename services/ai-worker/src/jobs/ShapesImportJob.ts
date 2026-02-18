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
  normalizeSlugForUser,
  type Prisma,
  type PrismaClient,
  type ShapesImportJobData,
  type ShapesImportJobResult,
  type ShapesIncPersonalityConfig,
  type ShapesDataFetchResult,
  CREDENTIAL_SERVICES,
  CREDENTIAL_TYPES,
} from '@tzurot/common-types';
import {
  ShapesDataFetcher,
  ShapesAuthError,
  ShapesNotFoundError,
  ShapesRateLimitError,
  ShapesServerError,
} from '../services/shapes/ShapesDataFetcher.js';
import { createFullPersonality, downloadAndStoreAvatar } from './ShapesImportHelpers.js';
import { importMemories } from './ShapesImportMemories.js';
import type { PgvectorMemoryAdapter } from '../services/PgvectorMemoryAdapter.js';

const logger = createLogger('ShapesImportJob');

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
    // 2. Look up user info (username for slug normalization, persona for memory ownership)
    const { username, personaId } = await resolveImportUser(prisma, userId);

    // 3. Normalize slug — non-bot-owners get username suffix to prevent collisions
    const normalizedSlug = normalizeSlugForUser(sourceSlug, discordUserId, username);

    // 4. Decrypt session cookie
    const sessionCookie = await getDecryptedCookie(prisma, userId);

    // 5. Fetch data from shapes.inc
    const fetcher = new ShapesDataFetcher();
    const fetchResult = await fetcher.fetchShapeData(sourceSlug, { sessionCookie });
    await persistUpdatedCookie(prisma, userId, fetcher.getUpdatedCookie());

    // 6. Create or resolve personality
    const { personalityId, slug: personalitySlug } = await resolvePersonality({
      prisma,
      config: fetchResult.config,
      sourceSlug: normalizedSlug,
      userId,
      importType,
      existingPersonalityId,
    });

    // 6. Download and store avatar
    let avatarDownloaded = false;
    let avatarError: string | undefined;
    if (fetchResult.config.avatar !== '' && importType !== 'memory_only') {
      try {
        await downloadAndStoreAvatar(prisma, personalityId, fetchResult.config.avatar);
        avatarDownloaded = true;
      } catch (error) {
        avatarError = error instanceof Error ? error.message : String(error);
        logger.warn(
          { err: error, personalityId },
          '[ShapesImportJob] Avatar download failed — continuing without avatar'
        );
      }
    }

    // 7. Import memories (skips if personality already has memories — prevents duplicates on re-import)
    const memoryStats = await importMemories({
      memoryAdapter,
      prisma,
      memories: fetchResult.memories
        .filter(m => m.deleted !== true)
        .map(m => ({
          text: m.result,
          senders: m.senders,
          createdAt: m.metadata.created_at * 1000,
          channelId:
            m.metadata.discord_channel_id !== '' ? m.metadata.discord_channel_id : undefined,
          guildId: m.metadata.discord_guild_id !== '' ? m.metadata.discord_guild_id : undefined,
          messageIds: m.metadata.msg_ids,
          summaryType: m.summary_type,
          legacyShapesUserId: m.senders[0],
        })),
      personalityId,
      personaId,
      importJobId,
    });

    // 8. Mark completed
    await markImportCompleted({
      prisma,
      importJobId,
      personalityId,
      memoryStats,
      fetchResult,
      avatarDownloaded,
      avatarError,
    });

    const result: ShapesImportJobResult = {
      success: true,
      personalityId,
      personalitySlug,
      memoriesImported: memoryStats.imported,
      memoriesFailed: memoryStats.failed,
      memoriesSkipped: memoryStats.skipped,
      importType,
    };
    logger.info({ jobId: job.id, ...result }, '[ShapesImportJob] Import completed successfully');
    return result;
  } catch (error) {
    return handleImportError({
      error,
      prisma,
      importJobId,
      importType,
      jobId: job.id,
      sourceSlug,
      job,
    });
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Look up the importing user's username (for slug normalization) and
 * default persona ID (for memory FK ownership). Both are required.
 */
async function resolveImportUser(
  prisma: PrismaClient,
  userId: string
): Promise<{ username: string; personaId: string }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { username: true, discordId: true, defaultPersonaId: true },
  });

  if (user === null) {
    throw new Error('Cannot import: user not found.');
  }

  if (user.defaultPersonaId === null) {
    throw new Error(
      'Cannot import memories: user has no default persona. Use /persona create first.'
    );
  }

  return { username: user.username, personaId: user.defaultPersonaId };
}

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

  // memory_only: look up existing personality by slug (or explicit ID if provided)
  if (opts.existingPersonalityId !== undefined) {
    return { personalityId: opts.existingPersonalityId, slug: opts.sourceSlug };
  }

  const existing = await opts.prisma.personality.findFirst({
    where: { slug: opts.sourceSlug },
    select: { id: true, slug: true },
  });
  if (existing === null) {
    throw new Error(
      `No personality found with slug "${opts.sourceSlug}". Run a full import first, or provide an explicit personality ID.`
    );
  }
  return { personalityId: existing.id, slug: existing.slug };
}

interface MarkCompletedOpts {
  prisma: PrismaClient;
  importJobId: string;
  personalityId: string;
  memoryStats: { imported: number; failed: number; skipped: number };
  fetchResult: ShapesDataFetchResult;
  avatarDownloaded: boolean;
  avatarError?: string;
}

async function markImportCompleted(opts: MarkCompletedOpts): Promise<void> {
  const metadata: Record<string, unknown> = {
    storiesCount: opts.fetchResult.stats.storiesCount,
    pagesTraversed: opts.fetchResult.stats.pagesTraversed,
    hasUserPersonalization: opts.fetchResult.userPersonalization !== null,
    memoriesSkipped: opts.memoryStats.skipped,
    avatarDownloaded: opts.avatarDownloaded,
  };
  if (opts.avatarError !== undefined) {
    metadata.avatarError = opts.avatarError;
  }

  await opts.prisma.importJob.update({
    where: { id: opts.importJobId },
    data: {
      status: 'completed',
      personalityId: opts.personalityId,
      memoriesImported: opts.memoryStats.imported,
      memoriesFailed: opts.memoryStats.failed,
      completedAt: new Date(),
      importMetadata: metadata as Prisma.InputJsonValue,
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
  job: Job<ShapesImportJobData>;
}

async function handleImportError(opts: HandleErrorOpts): Promise<ShapesImportJobResult> {
  const errorMessage = opts.error instanceof Error ? opts.error.message : String(opts.error);

  const isRateLimited = opts.error instanceof ShapesRateLimitError;
  const isServerError = opts.error instanceof ShapesServerError;
  const isRetryable = isRateLimited || isServerError;

  logger.error(
    {
      err: opts.error,
      jobId: opts.jobId,
      sourceSlug: opts.sourceSlug,
      isAuthError: opts.error instanceof ShapesAuthError,
      isNotFound: opts.error instanceof ShapesNotFoundError,
      isRateLimited,
      isServerError,
    },
    isRetryable
      ? '[ShapesImportJob] Retryable error — BullMQ will retry'
      : '[ShapesImportJob] Import failed'
  );

  // Re-throw retryable errors for BullMQ retry if attempts remain.
  // On the final attempt, fall through to mark the DB record as 'failed'.
  const maxAttempts = opts.job.opts.attempts ?? 1;
  if (isRetryable && opts.job.attemptsMade < maxAttempts - 1) {
    throw opts.error;
  }

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
