/**
 * Shapes.inc Export Routes (Async)
 *
 * POST /user/shapes/export   - Start an async export job
 * GET  /user/shapes/export/jobs - List export job history
 *
 * Export data is fetched asynchronously by ai-worker and stored in PostgreSQL.
 * Users download completed exports via GET /exports/:jobId (public endpoint).
 */

import { Router, type Response } from 'express';
import type { Queue } from 'bullmq';
import { StatusCodes } from 'http-status-codes';
import {
  createLogger,
  type PrismaClient,
  UserService,
  generateExportJobUuid,
  IMPORT_SOURCES,
  JobType,
  JOB_PREFIXES,
  type ShapesExportJobData,
  CREDENTIAL_SERVICES,
  CREDENTIAL_TYPES,
  getConfig,
  Prisma,
} from '@tzurot/common-types';
import { requireUserAuth } from '../../../services/AuthMiddleware.js';
import { asyncHandler } from '../../../utils/asyncHandler.js';
import { sendError, sendCustomSuccess } from '../../../utils/responseHelpers.js';
import { ErrorResponses } from '../../../utils/errorResponses.js';
import type { AuthenticatedRequest } from '../../../types.js';

const logger = createLogger('shapes-export');

/** Export jobs expire after 24 hours */
const EXPORT_EXPIRY_HOURS = 24;

interface CreateOrConflictResult {
  exportJobId: string;
  conflictStatus: string | null;
}

/**
 * Atomically check for conflicts and create/reset the export job.
 * Without a transaction, two concurrent requests can both pass findFirst
 * and the second upsert silently resets the first job's status.
 *
 * Note: The UUID is deterministic on (userId, slug, service, format), so
 * re-exports for the same shape+format upsert the same row — this replaces
 * any previous completed/failed export, invalidating its download URL.
 * Only active (pending/in_progress) exports of the same format trigger a 409.
 * Different formats (json vs markdown) get distinct UUIDs and can run concurrently.
 */
async function createExportJobOrConflict(
  prisma: PrismaClient,
  userId: string,
  normalizedSlug: string,
  format: string,
  expiresAt: Date
): Promise<CreateOrConflictResult> {
  const exportJobId = generateExportJobUuid(
    userId,
    normalizedSlug,
    IMPORT_SOURCES.SHAPES_INC,
    format
  );

  const conflictStatus = await prisma.$transaction(async tx => {
    const existingJob = await tx.exportJob.findFirst({
      where: {
        userId,
        sourceSlug: normalizedSlug,
        sourceService: IMPORT_SOURCES.SHAPES_INC,
        format,
        status: { in: ['pending', 'in_progress'] },
      },
    });

    if (existingJob !== null) {
      return existingJob.status;
    }

    await tx.exportJob.upsert({
      where: { id: exportJobId },
      create: {
        id: exportJobId,
        userId,
        sourceSlug: normalizedSlug,
        sourceService: IMPORT_SOURCES.SHAPES_INC,
        status: 'pending',
        format,
        expiresAt,
      },
      update: {
        status: 'pending',
        format,
        fileContent: null,
        fileName: null,
        fileSizeBytes: null,
        errorMessage: null,
        startedAt: null,
        completedAt: null,
        expiresAt,
        exportMetadata: Prisma.JsonNull,
      },
    });

    return null;
  });

  return { exportJobId, conflictStatus };
}

function createExportHandler(
  prisma: PrismaClient,
  queue: Queue,
  userService: UserService,
  baseUrl: string
) {
  return async (req: AuthenticatedRequest, res: Response) => {
    const discordUserId = req.userId;
    const { slug, format: formatRaw } = req.body as { slug?: string; format?: string };

    if (slug === undefined || typeof slug !== 'string' || slug.trim().length === 0) {
      return sendError(res, ErrorResponses.validationError('slug is required'));
    }

    const normalizedSlug = slug.trim().toLowerCase();
    const format = formatRaw === 'markdown' ? 'markdown' : 'json';

    // Get or create internal user (display name resolved later by bot-client;
    // passing discordUserId as placeholder username matches the import flow)
    const userId = await userService.getOrCreateUser(discordUserId, discordUserId);
    if (userId === null) {
      return sendError(res, ErrorResponses.validationError('Cannot create user'));
    }

    // Verify credentials exist (don't decrypt — ai-worker does that)
    const credential = await prisma.userCredential.findFirst({
      where: {
        userId,
        service: CREDENTIAL_SERVICES.SHAPES_INC,
        credentialType: CREDENTIAL_TYPES.SESSION_COOKIE,
      },
      select: { id: true },
    });

    if (credential === null) {
      return sendError(
        res,
        ErrorResponses.unauthorized('No shapes.inc credentials found. Use /shapes auth first.')
      );
    }

    const expiresAt = new Date(Date.now() + EXPORT_EXPIRY_HOURS * 60 * 60 * 1000);

    let exportJobId: string;
    let conflictStatus: string | null;
    try {
      ({ exportJobId, conflictStatus } = await createExportJobOrConflict(
        prisma,
        userId,
        normalizedSlug,
        format,
        expiresAt
      ));
    } catch (error: unknown) {
      // Defense-in-depth: catch Prisma P2002 (unique constraint violation)
      // in case migration state drifts or concurrent requests race past the transaction
      if (isPrismaUniqueConstraintError(error)) {
        logger.warn(
          { discordUserId, sourceSlug: normalizedSlug, format },
          '[Shapes] P2002 unique constraint — treating as conflict'
        );
        return sendError(
          res,
          ErrorResponses.conflict(
            `An export for '${normalizedSlug}' is already in progress. Wait for it to complete.`
          )
        );
      }
      throw error;
    }

    if (conflictStatus !== null) {
      return sendError(
        res,
        ErrorResponses.conflict(
          `An export for '${normalizedSlug}' is already ${conflictStatus}. Wait for it to complete.`
        )
      );
    }

    // Enqueue BullMQ job
    const jobData: ShapesExportJobData = {
      userId,
      sourceSlug: normalizedSlug,
      exportJobId,
      format,
    };

    // Non-deterministic suffix: the DB-level transaction in createExportJobOrConflict
    // prevents true duplicate jobs, but BullMQ deduplicates by jobId — a deterministic ID
    // would cause retries of completed/failed exports to be silently ignored by BullMQ.
    const jobId = `${JOB_PREFIXES.SHAPES_EXPORT}${exportJobId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await queue.add(JobType.ShapesExport, jobData, {
      jobId,
      attempts: 5,
      backoff: { type: 'exponential', delay: 10_000 },
    });

    logger.info(
      { discordUserId, sourceSlug: normalizedSlug, format, exportJobId },
      '[Shapes] Export job created'
    );

    const downloadUrl = `${baseUrl}/exports/${encodeURIComponent(exportJobId)}`;

    sendCustomSuccess(
      res,
      {
        success: true,
        exportJobId,
        sourceSlug: normalizedSlug,
        format,
        status: 'pending',
        downloadUrl,
      },
      StatusCodes.ACCEPTED
    );
  };
}

function createListExportJobsHandler(prisma: PrismaClient, baseUrl: string) {
  return async (req: AuthenticatedRequest, res: Response) => {
    const discordUserId = req.userId;

    const user = await prisma.user.findFirst({
      where: { discordId: discordUserId },
      select: { id: true },
    });

    if (user === null) {
      sendCustomSuccess(res, { jobs: [] });
      return;
    }

    const jobs = await prisma.exportJob.findMany({
      where: {
        userId: user.id,
        sourceService: IMPORT_SOURCES.SHAPES_INC,
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        sourceSlug: true,
        status: true,
        format: true,
        fileName: true,
        fileSizeBytes: true,
        createdAt: true,
        completedAt: true,
        expiresAt: true,
        errorMessage: true,
        exportMetadata: true,
      },
    });

    // Add download URLs to completed jobs
    const jobsWithUrls = jobs.map(job => ({
      ...job,
      downloadUrl:
        job.status === 'completed' ? `${baseUrl}/exports/${encodeURIComponent(job.id)}` : null,
    }));

    sendCustomSuccess(res, { jobs: jobsWithUrls });
  };
}

function isPrismaUniqueConstraintError(error: unknown): error is { code: string } {
  return error !== null && typeof error === 'object' && 'code' in error && error.code === 'P2002';
}

export function createShapesExportRoutes(prisma: PrismaClient, queue: Queue): Router {
  const router = Router();
  const userService = new UserService(prisma);
  const envConfig = getConfig();
  const baseUrl = envConfig.PUBLIC_GATEWAY_URL ?? envConfig.GATEWAY_URL ?? '';

  router.post(
    '/',
    requireUserAuth(),
    asyncHandler(createExportHandler(prisma, queue, userService, baseUrl))
  );
  router.get(
    '/jobs',
    requireUserAuth(),
    asyncHandler(createListExportJobsHandler(prisma, baseUrl))
  );

  return router;
}
