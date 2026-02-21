/**
 * Shapes.inc Export Job Processor
 *
 * BullMQ job handler that orchestrates async data export from shapes.inc:
 * 1. Decrypt session cookie from UserCredential
 * 2. Fetch data from shapes.inc via ShapesDataFetcher
 * 3. Format as JSON or Markdown
 * 4. Store formatted content in ExportJob.fileContent (PostgreSQL TEXT)
 * 5. Update ExportJob status with results
 */

import type { Job } from 'bullmq';
import {
  createLogger,
  type PrismaClient,
  type ShapesExportJobData,
  type ShapesExportJobResult,
} from '@tzurot/common-types';
import { ShapesDataFetcher } from '../services/shapes/ShapesDataFetcher.js';
import { formatExportAsMarkdown, formatExportAsJson } from './ShapesExportFormatters.js';
import {
  getDecryptedCookie,
  persistUpdatedCookie,
  classifyShapesError,
} from './shapesCredentials.js';

const logger = createLogger('ShapesExportJob');

interface ShapesExportJobDeps {
  prisma: PrismaClient;
}

/**
 * Process a shapes.inc export job.
 */
export async function processShapesExportJob(
  job: Job<ShapesExportJobData>,
  deps: ShapesExportJobDeps
): Promise<ShapesExportJobResult> {
  const { prisma } = deps;
  const { userId, sourceSlug, exportJobId, format } = job.data;

  logger.info(
    { jobId: job.id, sourceSlug, format, exportJobId },
    '[ShapesExportJob] Starting export'
  );

  // 1. Mark export as in_progress
  await prisma.exportJob.update({
    where: { id: exportJobId },
    data: { status: 'in_progress', startedAt: new Date() },
  });

  let fetcher: ShapesDataFetcher | null = null;
  try {
    // 2. Decrypt session cookie
    const sessionCookie = await getDecryptedCookie(prisma, userId);

    // 3. Fetch data from shapes.inc
    fetcher = new ShapesDataFetcher();
    const fetchResult = await fetcher.fetchShapeData(sourceSlug, { sessionCookie });
    await persistUpdatedCookie(prisma, userId, fetcher.getUpdatedCookie());

    // 4. Format export content
    const exportPayload = {
      exportedAt: new Date().toISOString(),
      sourceSlug,
      config: fetchResult.config,
      memories: fetchResult.memories,
      stories: fetchResult.stories,
      userPersonalization: fetchResult.userPersonalization,
      stats: {
        memoriesCount: fetchResult.stats.memoriesCount,
        storiesCount: fetchResult.stats.storiesCount,
        pagesTraversed: fetchResult.stats.pagesTraversed,
        hasUserPersonalization: fetchResult.userPersonalization !== null,
      },
    };

    const fileContent =
      format === 'markdown'
        ? formatExportAsMarkdown(exportPayload)
        : formatExportAsJson(exportPayload);

    const fileSizeBytes = Buffer.byteLength(fileContent, 'utf8');
    const fileExtension = format === 'markdown' ? 'md' : 'json';
    const fileName = `${sourceSlug}-export.${fileExtension}`;

    // 5. Store result in ExportJob
    await prisma.exportJob.update({
      where: { id: exportJobId },
      data: {
        status: 'completed',
        fileContent,
        fileName,
        fileSizeBytes,
        completedAt: new Date(),
        exportMetadata: {
          memoriesCount: fetchResult.stats.memoriesCount,
          storiesCount: fetchResult.stats.storiesCount,
          pagesTraversed: fetchResult.stats.pagesTraversed,
          hasUserPersonalization: fetchResult.userPersonalization !== null,
        },
      },
    });

    const result: ShapesExportJobResult = {
      success: true,
      fileSizeBytes,
      memoriesCount: fetchResult.stats.memoriesCount,
      storiesCount: fetchResult.stats.storiesCount,
    };

    logger.info({ jobId: job.id, ...result }, '[ShapesExportJob] Export completed successfully');

    return result;
  } catch (error) {
    // Persist rotated cookie before error handling — prevents stale cookie on retry
    if (fetcher !== null) {
      await persistUpdatedCookie(prisma, userId, fetcher.getUpdatedCookie());
    }
    return handleExportError({ error, prisma, exportJobId, jobId: job.id, sourceSlug, job });
  }
}

// ============================================================================
// Error Handling
// ============================================================================

interface HandleErrorOpts {
  error: unknown;
  prisma: PrismaClient;
  exportJobId: string;
  jobId: string | undefined;
  sourceSlug: string;
  job: Job<ShapesExportJobData>;
}

async function handleExportError(opts: HandleErrorOpts): Promise<ShapesExportJobResult> {
  const { isRetryable, errorMessage } = classifyShapesError(opts.error);
  const maxAttempts = opts.job.opts.attempts ?? 1;

  logger.error(
    {
      err: opts.error,
      jobId: opts.jobId,
      sourceSlug: opts.sourceSlug,
      errorType: opts.error instanceof Error ? opts.error.constructor.name : typeof opts.error,
      attemptsMade: opts.job.attemptsMade,
      maxAttempts,
    },
    isRetryable
      ? '[ShapesExportJob] Retryable error — BullMQ will retry'
      : '[ShapesExportJob] Export failed (non-retryable)'
  );

  // Re-throw retryable errors for BullMQ retry if attempts remain.
  // On the final attempt, fall through to mark the DB record as 'failed'
  // so users don't see a permanently stuck 'in_progress' status.
  if (isRetryable && opts.job.attemptsMade < maxAttempts - 1) {
    throw opts.error;
  }

  await opts.prisma.exportJob.update({
    where: { id: opts.exportJobId },
    data: { status: 'failed', completedAt: new Date(), errorMessage },
  });

  return {
    success: false,
    fileSizeBytes: 0,
    memoriesCount: 0,
    storiesCount: 0,
    error: errorMessage,
  };
}
