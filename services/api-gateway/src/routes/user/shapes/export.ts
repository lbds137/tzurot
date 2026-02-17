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
} from '@tzurot/common-types';
import { requireUserAuth } from '../../../services/AuthMiddleware.js';
import { asyncHandler } from '../../../utils/asyncHandler.js';
import { sendError, sendCustomSuccess } from '../../../utils/responseHelpers.js';
import { ErrorResponses } from '../../../utils/errorResponses.js';
import type { AuthenticatedRequest } from '../../../types.js';

const logger = createLogger('shapes-export');

/** Export jobs expire after 24 hours */
const EXPORT_EXPIRY_HOURS = 24;

function createExportHandler(prisma: PrismaClient, queue: Queue, userService: UserService) {
  return async (req: AuthenticatedRequest, res: Response) => {
    const discordUserId = req.userId;
    const { slug, format: formatRaw } = req.body as { slug?: string; format?: string };

    if (slug === undefined || typeof slug !== 'string' || slug.trim().length === 0) {
      return sendError(res, ErrorResponses.validationError('slug is required'));
    }

    const normalizedSlug = slug.trim().toLowerCase();
    const format = formatRaw === 'markdown' ? 'markdown' : 'json';

    // Get or create internal user
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

    // Check for existing pending/in_progress export for same slug
    const existingJob = await prisma.exportJob.findFirst({
      where: {
        userId,
        sourceSlug: normalizedSlug,
        sourceService: IMPORT_SOURCES.SHAPES_INC,
        status: { in: ['pending', 'in_progress'] },
      },
    });

    if (existingJob !== null) {
      return sendError(
        res,
        ErrorResponses.conflict(
          `An export for '${normalizedSlug}' is already ${existingJob.status}. Wait for it to complete.`
        )
      );
    }

    // Create ExportJob record
    const exportJobId = generateExportJobUuid(userId, normalizedSlug, IMPORT_SOURCES.SHAPES_INC);
    const expiresAt = new Date(Date.now() + EXPORT_EXPIRY_HOURS * 60 * 60 * 1000);

    await prisma.exportJob.upsert({
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
        exportMetadata: undefined,
      },
    });

    // Enqueue BullMQ job
    const jobData: ShapesExportJobData = {
      userId,
      discordUserId,
      sourceSlug: normalizedSlug,
      exportJobId,
      format,
    };

    const jobId = `${JOB_PREFIXES.SHAPES_EXPORT}${exportJobId}`;
    await queue.add(JobType.ShapesExport, jobData, { jobId });

    logger.info(
      { discordUserId, sourceSlug: normalizedSlug, format, exportJobId },
      '[Shapes] Export job created'
    );

    // Build download URL for completed exports
    const envConfig = getConfig();
    const baseUrl = envConfig.PUBLIC_GATEWAY_URL ?? envConfig.GATEWAY_URL ?? '';
    const downloadUrl = `${baseUrl}/exports/${exportJobId}`;

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

function createListExportJobsHandler(prisma: PrismaClient) {
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

    const envConfig = getConfig();
    const baseUrl = envConfig.PUBLIC_GATEWAY_URL ?? envConfig.GATEWAY_URL ?? '';

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
      downloadUrl: job.status === 'completed' ? `${baseUrl}/exports/${job.id}` : null,
    }));

    sendCustomSuccess(res, { jobs: jobsWithUrls });
  };
}

export function createShapesExportRoutes(prisma: PrismaClient, queue: Queue): Router {
  const router = Router();
  const userService = new UserService(prisma);

  router.post(
    '/',
    requireUserAuth(),
    asyncHandler(createExportHandler(prisma, queue, userService))
  );
  router.get('/jobs', requireUserAuth(), asyncHandler(createListExportJobsHandler(prisma)));

  return router;
}
