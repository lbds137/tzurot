/**
 * Shapes.inc Export Routes (Async)
 *
 * POST /api/user/shapes/export   - Start an async export job
 * GET  /api/user/shapes/export/jobs - List export job history
 *
 * Export data is fetched asynchronously by ai-worker and stored in PostgreSQL.
 * Users download completed exports via GET /exports/:token (public endpoint).
 */

import { type Response, type RequestHandler } from 'express';
import type { Queue } from 'bullmq';
import { StatusCodes } from 'http-status-codes';
import { JobType, JOB_PREFIXES } from '@tzurot/common-types/constants/queue';
import { StartShapesExportInputSchema } from '@tzurot/common-types/schemas/api/shapes';
import { type PrismaClient, Prisma } from '@tzurot/common-types/services/prisma';
import {
  IMPORT_SOURCES,
  type ShapesExportJobData,
  CREDENTIAL_SERVICES,
  CREDENTIAL_TYPES,
} from '@tzurot/common-types/types/shapes-import';
import { generateExportJobUuid } from '@tzurot/common-types/utils/deterministicUuid';
import { generateExportDownloadToken } from '@tzurot/common-types/utils/exportDownloadToken';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { asyncHandler } from '../../../utils/asyncHandler.js';
import { resolveProvisionedUserId } from '../../../utils/resolveProvisionedUserId.js';
import { sendError, sendCustomSuccess } from '../../../utils/responseHelpers.js';
import { parseBodyOrSendError } from '../../../utils/configRouteHelpers.js';
import { ErrorResponses } from '../../../utils/errorResponses.js';
import { isPrismaUniqueConstraintError } from '../../../utils/prismaErrors.js';
import { enqueueExportJobOrMarkFailed } from '../../../utils/enqueueExportJob.js';
import { buildExportDownloadUrl } from '../../../utils/exportDownloadUrl.js';
import type { ProvisionedRequest } from '../../../types.js';
import type { RouteDeps } from '../../routeDeps.js';

const logger = createLogger('shapes-export');

/** Export jobs expire after 24 hours */
const EXPORT_EXPIRY_HOURS = 24;

/** Exports always ship as a single ZIP archive of per-section JSON + Markdown files. */
const EXPORT_FORMAT = 'zip';

interface CreateOrConflictResult {
  exportJobId: string;
  /** The random public-download token, minted for a freshly created/reset job. */
  downloadToken: string;
  conflictStatus: string | null;
}

/**
 * Atomically check for conflicts and create/reset the export job.
 * Without a transaction, two concurrent requests can both pass findFirst
 * and the second upsert silently resets the first job's status.
 *
 * Note: The UUID is deterministic on (userId, slug, service, 'zip'), so a
 * re-export for the same shape upserts the same row — this replaces any
 * previous completed/failed export, invalidating its download URL. An
 * active (pending/in_progress) export triggers a 409 instead.
 */
async function createExportJobOrConflict(
  prisma: PrismaClient,
  userId: string,
  normalizedSlug: string,
  expiresAt: Date
): Promise<CreateOrConflictResult> {
  const exportJobId = generateExportJobUuid(
    userId,
    normalizedSlug,
    IMPORT_SOURCES.SHAPES_INC,
    EXPORT_FORMAT
  );
  // Fresh random token on every (re)creation — a previously-shared download
  // URL stops working the moment the export is re-run.
  const downloadToken = generateExportDownloadToken();

  const conflictStatus = await prisma.$transaction(async tx => {
    const existingJob = await tx.exportJob.findFirst({
      where: {
        userId,
        sourceSlug: normalizedSlug,
        sourceService: IMPORT_SOURCES.SHAPES_INC,
        format: EXPORT_FORMAT,
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
        format: EXPORT_FORMAT,
        downloadToken,
        expiresAt,
      },
      update: {
        status: 'pending',
        format: EXPORT_FORMAT,
        downloadToken,
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

  return { exportJobId, downloadToken, conflictStatus };
}

function createExportHandler(prisma: PrismaClient, queue: Queue) {
  return async (req: ProvisionedRequest, res: Response) => {
    const discordUserId = req.userId;

    const parsed = parseBodyOrSendError(res, StartShapesExportInputSchema, req.body);
    if (parsed === null) {
      return;
    }
    const { slug } = parsed;
    // slug is already trimmed at the schema layer (StartShapesExportInputSchema).
    const normalizedSlug = slug.toLowerCase();

    const userId = resolveProvisionedUserId(req);

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
    let downloadToken: string;
    let conflictStatus: string | null;
    try {
      ({ exportJobId, downloadToken, conflictStatus } = await createExportJobOrConflict(
        prisma,
        userId,
        normalizedSlug,
        expiresAt
      ));
    } catch (error: unknown) {
      // Defense-in-depth: catch Prisma P2002 (unique constraint violation)
      // in case migration state drifts or concurrent requests race past the transaction
      if (isPrismaUniqueConstraintError(error)) {
        logger.warn(
          { discordUserId, sourceSlug: normalizedSlug },
          'P2002 unique constraint — treating as conflict'
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
    };

    // Non-deterministic suffix: the DB-level transaction in createExportJobOrConflict
    // prevents true duplicate jobs, but BullMQ deduplicates by jobId — a deterministic ID
    // would cause retries of completed/failed exports to be silently ignored by BullMQ.
    const jobId = `${JOB_PREFIXES.SHAPES_EXPORT}${exportJobId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    // The row above is already committed 'pending'; an enqueue failure must
    // mark it 'failed' or it 409s every retry until the 24h expiry.
    await enqueueExportJobOrMarkFailed({
      queue,
      prisma,
      exportJobId,
      jobName: JobType.ShapesExport,
      jobData,
      jobOptions: { jobId, attempts: 5, backoff: { type: 'exponential', delay: 5_000 } },
    });

    logger.info({ discordUserId, sourceSlug: normalizedSlug, exportJobId }, 'Export job created');

    const downloadUrl = buildExportDownloadUrl(downloadToken);

    sendCustomSuccess(
      res,
      {
        success: true,
        exportJobId,
        sourceSlug: normalizedSlug,
        format: EXPORT_FORMAT,
        status: 'pending',
        downloadUrl,
      },
      StatusCodes.ACCEPTED
    );
  };
}

function createListExportJobsHandler(prisma: PrismaClient) {
  return async (req: ProvisionedRequest, res: Response) => {
    const slug = typeof req.query.slug === 'string' ? req.query.slug : undefined;

    const userId = resolveProvisionedUserId(req);

    const jobs = await prisma.exportJob.findMany({
      where: {
        userId,
        sourceService: IMPORT_SOURCES.SHAPES_INC,
        ...(slug !== undefined ? { sourceSlug: slug } : {}),
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
        downloadToken: true,
      },
    });

    // Render the download token into the URL and drop it as a bare field —
    // it must never leave the server except as part of the download URL.
    const jobsWithUrls = jobs.map(({ downloadToken, ...job }) => ({
      ...job,
      downloadUrl: job.status === 'completed' ? buildExportDownloadUrl(downloadToken) : null,
    }));

    sendCustomSuccess(res, { jobs: jobsWithUrls });
  };
}

// ===== Handler factories ===================================================

/** POST /api/user/shapes/export — start an async export job. */
export const handleStartShapesExport = (deps: RouteDeps): RequestHandler =>
  asyncHandler(async (req: ProvisionedRequest, res: Response) => {
    if (deps.aiQueue === undefined) {
      sendError(
        res,
        ErrorResponses.serviceUnavailable('Job queue required for shapes export is not configured')
      );
      return;
    }
    await createExportHandler(deps.prisma, deps.aiQueue)(req, res);
  });

/** GET /api/user/shapes/export/jobs — list export history for the caller. */
export const handleListShapesExportJobs = (deps: RouteDeps): RequestHandler =>
  asyncHandler(createListExportJobsHandler(deps.prisma));
