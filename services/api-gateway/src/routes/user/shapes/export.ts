/**
 * Shapes.inc Export Routes (Async)
 *
 * POST /user/shapes/export   - Start an async export job
 * GET  /user/shapes/export/jobs - List export job history
 *
 * Export data is fetched asynchronously by ai-worker and stored in PostgreSQL.
 * Users download completed exports via GET /exports/:token (public endpoint).
 */

import { type Response, type RequestHandler } from 'express';
import type { Queue } from 'bullmq';
import { StatusCodes } from 'http-status-codes';
import { getConfig } from '@tzurot/common-types/config/config';
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
import type { ProvisionedRequest } from '../../../types.js';
import type { RouteDeps } from '../../routeDeps.js';

const logger = createLogger('shapes-export');

/** Export jobs expire after 24 hours */
const EXPORT_EXPIRY_HOURS = 24;

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
  // Fresh random token on every (re)creation — a previously-shared download
  // URL stops working the moment the export is re-run.
  const downloadToken = generateExportDownloadToken();

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
        downloadToken,
        expiresAt,
      },
      update: {
        status: 'pending',
        format,
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

function createExportHandler(prisma: PrismaClient, queue: Queue, baseUrl: string) {
  return async (req: ProvisionedRequest, res: Response) => {
    const discordUserId = req.userId;

    const parsed = parseBodyOrSendError(res, StartShapesExportInputSchema, req.body);
    if (parsed === null) {
      return;
    }
    const { slug, format: formatRaw } = parsed;
    // slug is already trimmed at the schema layer (StartShapesExportInputSchema).
    const normalizedSlug = slug.toLowerCase();
    // Schema constrains `format` to `'json' | 'markdown' | undefined`;
    // default to `'json'` when omitted.
    const format = formatRaw ?? 'json';

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
        format,
        expiresAt
      ));
    } catch (error: unknown) {
      // Defense-in-depth: catch Prisma P2002 (unique constraint violation)
      // in case migration state drifts or concurrent requests race past the transaction
      if (isPrismaUniqueConstraintError(error)) {
        logger.warn(
          { discordUserId, sourceSlug: normalizedSlug, format },
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
      format,
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

    logger.info(
      { discordUserId, sourceSlug: normalizedSlug, format, exportJobId },
      'Export job created'
    );

    const downloadUrl = `${baseUrl}/exports/${encodeURIComponent(downloadToken)}`;

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
      downloadUrl:
        job.status === 'completed' && downloadToken !== null
          ? `${baseUrl}/exports/${encodeURIComponent(downloadToken)}`
          : null,
    }));

    sendCustomSuccess(res, { jobs: jobsWithUrls });
  };
}

// ===== Handler factories ===================================================

/**
 * Memoized base URL. Env vars don't change at runtime, so we resolve once
 * lazily on first read and reuse the value for every subsequent factory
 * invocation in this module. Single-source: both `handleStartShapesExport`
 * and `handleListShapesExportJobs` go through this getter.
 */
let _baseUrlCache: string | undefined;
function resolveBaseUrl(): string {
  if (_baseUrlCache === undefined) {
    const envConfig = getConfig();
    _baseUrlCache = envConfig.PUBLIC_GATEWAY_URL ?? envConfig.GATEWAY_URL ?? '';
  }
  return _baseUrlCache;
}

/** POST /api/user/shapes/export — start an async export job. */
export const handleStartShapesExport = (deps: RouteDeps): RequestHandler => {
  // Resolve baseUrl once at factory-call time (cached across factory calls
  // by `resolveBaseUrl`) — env vars don't change at runtime.
  const baseUrl = resolveBaseUrl();
  return asyncHandler(async (req: ProvisionedRequest, res: Response) => {
    if (deps.aiQueue === undefined) {
      sendError(
        res,
        ErrorResponses.serviceUnavailable('Job queue required for shapes export is not configured')
      );
      return;
    }
    await createExportHandler(deps.prisma, deps.aiQueue, baseUrl)(req, res);
  });
};

/** GET /api/user/shapes/export/jobs — list export history for the caller. */
export const handleListShapesExportJobs = (deps: RouteDeps): RequestHandler =>
  asyncHandler(createListExportJobsHandler(deps.prisma, resolveBaseUrl()));
