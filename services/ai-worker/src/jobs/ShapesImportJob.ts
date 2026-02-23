/**
 * Shapes.inc Import Job Processor
 *
 * BullMQ job handler that orchestrates the full shapes.inc import pipeline:
 * 1. Validate credentials (fail fast before expensive operations)
 * 2. Resolve user info + normalize slug
 * 3. Fetch data from shapes.inc via ShapesDataFetcher
 * 4. Create Personality + SystemPrompt + LlmConfig via PersonalityMapper
 * 5. Import memories into pgvector
 * 6. Update ImportJob status with results
 *
 * For 'memory_only' imports, skips personality creation and just imports
 * memories into an existing personality resolved by slug. The gateway no
 * longer validates memory_only preconditions at enqueue time — if the
 * target personality doesn't exist, the job fails asynchronously. This is
 * an intentional tradeoff for simpler UX (no explicit personality ID needed).
 */

import type { Job } from 'bullmq';
import {
  createLogger,
  normalizeSlugForUser,
  type Prisma,
  type PrismaClient,
  type ShapesImportJobData,
  type ShapesImportJobResult,
  type ShapesDataFetchResult,
} from '@tzurot/common-types';
import { ShapesDataFetcher } from '../services/shapes/ShapesDataFetcher.js';
import {
  getDecryptedCookie,
  persistUpdatedCookie,
  classifyShapesError,
} from './shapesCredentials.js';
import { downloadAndStoreAvatar } from './ShapesImportHelpers.js';
import { importMemories } from './ShapesImportMemories.js';
import { resolvePersonality } from './ShapesImportResolver.js';
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
  const { userId, discordUserId, sourceSlug, importJobId, importType } = job.data;

  logger.info(
    { jobId: job.id, sourceSlug, importType, userId: discordUserId },
    '[ShapesImportJob] Starting import'
  );

  // 1. Mark import as in_progress
  await updateImportJobStatus(prisma, importJobId, 'in_progress');

  let fetcher: ShapesDataFetcher | null = null;
  try {
    // 2. Decrypt session cookie — fail fast on expired/missing credentials
    const sessionCookie = await getDecryptedCookie(prisma, userId);

    // 3. Look up user info (username for slug normalization, persona for memory ownership)
    const { username, personaId } = await resolveImportUser(prisma, userId);

    // 4. Normalize slug — non-bot-owners get username suffix to prevent collisions
    const normalizedSlug = normalizeSlugForUser(sourceSlug, discordUserId, username);

    // 5. Fetch data from shapes.inc (uses original sourceSlug — the shapes.inc API
    //    identifier — not normalizedSlug which is the local personality slug)
    fetcher = new ShapesDataFetcher();
    const fetchResult = await fetcher.fetchShapeData(sourceSlug, { sessionCookie });
    await persistUpdatedCookie(prisma, userId, fetcher.getUpdatedCookie());

    // 6. Create or resolve personality
    const { personalityId, slug: personalitySlug } = await resolvePersonality({
      prisma,
      config: fetchResult.config,
      sourceSlug: normalizedSlug,
      rawSourceSlug: sourceSlug,
      shapesId: fetchResult.config.id,
      internalUserId: userId,
      discordUserId,
      importType,
    });

    // 7. Download and store avatar
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

    // 8. Import memories (skips if personality already has memories — prevents duplicates on re-import)
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
          // senders[0] is the shapes.inc user UUID by convention; validated to
          // silently skip non-UUID values (bot names, display names) if the
          // format ever changes
          legacyShapesUserId: UUID_RE.test(m.senders[0] ?? '') ? m.senders[0] : undefined,
        })),
      personalityId,
      personaId,
      importJobId,
    });

    // 9. Mark completed
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
    // Persist rotated cookie before error handling — prevents stale cookie on retry
    if (fetcher !== null) {
      await persistUpdatedCookie(prisma, userId, fetcher.getUpdatedCookie());
    }
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
    select: { username: true, defaultPersonaId: true },
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  importType: 'full' | 'memory_only';
  jobId: string | undefined;
  sourceSlug: string;
  job: Job<ShapesImportJobData>;
}

async function handleImportError(opts: HandleErrorOpts): Promise<ShapesImportJobResult> {
  const { isRetryable, errorMessage } = classifyShapesError(opts.error);
  const maxAttempts = opts.job.opts.attempts ?? 1;
  const willRetry = isRetryable && opts.job.attemptsMade < maxAttempts - 1;

  const logMessage = willRetry
    ? '[ShapesImportJob] Retryable error — BullMQ will retry'
    : isRetryable
      ? '[ShapesImportJob] Retries exhausted — marking as failed'
      : '[ShapesImportJob] Import failed (non-retryable)';

  logger.error(
    {
      err: opts.error,
      jobId: opts.jobId,
      sourceSlug: opts.sourceSlug,
      errorType: opts.error instanceof Error ? opts.error.constructor.name : typeof opts.error,
      attemptsMade: opts.job.attemptsMade,
      maxAttempts,
      willRetry,
    },
    logMessage
  );

  // Re-throw retryable errors for BullMQ retry if attempts remain.
  // On the final attempt, fall through to mark the DB record as 'failed'.
  if (willRetry) {
    throw opts.error;
  }

  await opts.prisma.importJob.update({
    where: { id: opts.importJobId },
    data: { status: 'failed', completedAt: new Date(), errorMessage },
  });

  logger.warn(
    { jobId: opts.jobId, sourceSlug: opts.sourceSlug },
    '[ShapesImportJob] Import marked as failed in database'
  );

  return {
    success: false,
    memoriesImported: 0,
    memoriesFailed: 0,
    importType: opts.importType,
    error: errorMessage,
  };
}
