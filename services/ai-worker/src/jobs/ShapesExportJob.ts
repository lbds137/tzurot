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
  decryptApiKey,
  encryptApiKey,
  type PrismaClient,
  type ShapesExportJobData,
  type ShapesExportJobResult,
  CREDENTIAL_SERVICES,
  CREDENTIAL_TYPES,
} from '@tzurot/common-types';
import {
  ShapesDataFetcher,
  ShapesAuthError,
  ShapesNotFoundError,
  ShapesRateLimitError,
} from '../services/shapes/ShapesDataFetcher.js';
import { formatExportAsMarkdown, formatExportAsJson } from './ShapesExportFormatters.js';

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

  try {
    // 2. Decrypt session cookie
    const sessionCookie = await getDecryptedCookie(prisma, userId);

    // 3. Fetch data from shapes.inc
    const fetcher = new ShapesDataFetcher();
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
    return handleExportError({ error, prisma, exportJobId, jobId: job.id, sourceSlug });
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
    logger.warn({ err: error }, '[ShapesExportJob] Failed to persist updated cookie');
  }
}

interface HandleErrorOpts {
  error: unknown;
  prisma: PrismaClient;
  exportJobId: string;
  jobId: string | undefined;
  sourceSlug: string;
}

async function handleExportError(opts: HandleErrorOpts): Promise<ShapesExportJobResult> {
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
      ? '[ShapesExportJob] Rate limited by shapes.inc — BullMQ will retry'
      : '[ShapesExportJob] Export failed'
  );

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
