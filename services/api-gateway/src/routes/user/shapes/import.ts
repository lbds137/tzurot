/**
 * Shapes.inc Import Routes
 *
 * POST /user/shapes/import - Start a shapes.inc import job
 * GET  /user/shapes/import-jobs - List import history
 */

import { Router, type Response } from 'express';
import type { Queue } from 'bullmq';
import { StatusCodes } from 'http-status-codes';
import {
  createLogger,
  UserService,
  type PrismaClient,
  generateImportJobUuid,
  IMPORT_SOURCES,
  JobType,
  JOB_PREFIXES,
  type ShapesImportJobData,
} from '@tzurot/common-types';
import { requireUserAuth } from '../../../services/AuthMiddleware.js';
import { asyncHandler } from '../../../utils/asyncHandler.js';
import { sendError, sendCustomSuccess } from '../../../utils/responseHelpers.js';
import { ErrorResponses } from '../../../utils/errorResponses.js';
import type { AuthenticatedRequest } from '../../../types.js';

const logger = createLogger('shapes-import');

function createImportHandler(prisma: PrismaClient, queue: Queue, userService: UserService) {
  return async (req: AuthenticatedRequest, res: Response) => {
    const discordUserId = req.userId;
    const { sourceSlug, importType, existingPersonalityId } = req.body as {
      sourceSlug?: string;
      importType?: string;
      existingPersonalityId?: string;
    };

    // Validate required fields
    if (
      sourceSlug === undefined ||
      typeof sourceSlug !== 'string' ||
      sourceSlug.trim().length === 0
    ) {
      return sendError(res, ErrorResponses.validationError('sourceSlug is required'));
    }

    const normalizedSlug = sourceSlug.trim().toLowerCase();

    const validImportType = importType === 'memory_only' ? 'memory_only' : 'full';

    if (validImportType === 'memory_only' && existingPersonalityId === undefined) {
      return sendError(
        res,
        ErrorResponses.validationError('existingPersonalityId is required for memory_only imports')
      );
    }

    // Get or create internal user
    const userId = await userService.getOrCreateUser(discordUserId, discordUserId);
    if (userId === null) {
      return sendError(res, ErrorResponses.validationError('Cannot create user'));
    }

    // Check for existing pending/in_progress import
    const existingJob = await prisma.importJob.findFirst({
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
          `An import for '${normalizedSlug}' is already ${existingJob.status}. Wait for it to complete.`
        )
      );
    }

    // Create ImportJob record
    const importJobId = generateImportJobUuid(userId, normalizedSlug, IMPORT_SOURCES.SHAPES_INC);

    await prisma.importJob.upsert({
      where: { id: importJobId },
      create: {
        id: importJobId,
        userId,
        sourceSlug: normalizedSlug,
        sourceService: IMPORT_SOURCES.SHAPES_INC,
        status: 'pending',
        importType: validImportType,
      },
      update: {
        status: 'pending',
        errorMessage: null,
        memoriesImported: null,
        memoriesFailed: null,
        startedAt: null,
        completedAt: null,
      },
    });

    // Enqueue BullMQ job
    const jobData: ShapesImportJobData = {
      userId,
      discordUserId,
      sourceSlug: normalizedSlug,
      importJobId,
      importType: validImportType,
      existingPersonalityId,
    };

    const jobId = `${JOB_PREFIXES.SHAPES_IMPORT}${importJobId}`;
    await queue.add(JobType.ShapesImport, jobData, { jobId });

    logger.info(
      { discordUserId, sourceSlug: normalizedSlug, importType: validImportType, importJobId },
      '[Shapes] Import job created'
    );

    sendCustomSuccess(
      res,
      {
        success: true,
        importJobId,
        sourceSlug: normalizedSlug,
        importType: validImportType,
        status: 'pending',
      },
      StatusCodes.ACCEPTED
    );
  };
}

function createListImportJobsHandler(prisma: PrismaClient) {
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

    const jobs = await prisma.importJob.findMany({
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
        importType: true,
        memoriesImported: true,
        memoriesFailed: true,
        createdAt: true,
        completedAt: true,
        errorMessage: true,
      },
    });

    sendCustomSuccess(res, { jobs });
  };
}

export function createShapesImportRoutes(prisma: PrismaClient, queue: Queue): Router {
  const router = Router();
  const userService = new UserService(prisma);

  router.post(
    '/',
    requireUserAuth(),
    asyncHandler(createImportHandler(prisma, queue, userService))
  );
  router.get('/jobs', requireUserAuth(), asyncHandler(createListImportJobsHandler(prisma)));

  return router;
}
