/**
 * Account Data-Rights Export Routes (Async)
 *
 * POST /user/account/export        - Start a full-account export job
 * GET  /user/account/export/status - Latest account export job state
 *
 * Rides the shapes-export spine: an export_jobs row (sentinel
 * sourceService='account') filled asynchronously by ai-worker, downloaded
 * via the public GET /exports/:token route, expiring after 24 hours.
 */

import { type Response, type RequestHandler } from 'express';
import type { Queue } from 'bullmq';
import { StatusCodes } from 'http-status-codes';
import { getConfig } from '@tzurot/common-types/config/config';
import { JobType, JOB_PREFIXES } from '@tzurot/common-types/constants/queue';
import { StartAccountExportInputSchema } from '@tzurot/common-types/schemas/api/account';
import { type PrismaClient, Prisma } from '@tzurot/common-types/services/prisma';
import {
  ACCOUNT_EXPORT_SOURCE,
  ACCOUNT_EXPORT_SLUG,
  type AccountExportJobData,
} from '@tzurot/common-types/types/account-export';
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

const logger = createLogger('account-export');

/** Export jobs expire after 24 hours (mirrors the shapes-export policy). */
const EXPORT_EXPIRY_HOURS = 24;

/** Account exports are a ZIP archive (JSON + Markdown per section) from v2 on. */
const EXPORT_FORMAT = 'zip';

/**
 * One completed export per 24 hours (measured from completedAt) — a full
 * account assembly is the most expensive read path a user can trigger.
 * Failed jobs are exempt so a failure never locks the user out.
 */
const EXPORT_COOLDOWN_HOURS = 24;

interface CreateOrConflictResult {
  exportJobId: string;
  /** The random public-download token, always minted for this run. */
  downloadToken: string;
  conflictStatus: string | null;
  onCooldown: boolean;
}

/**
 * Atomically check for an active job / cooldown and create/reset the export
 * row. The UUID is deterministic on (userId, 'account', 'account', 'zip'),
 * so a re-export upserts the same row — replacing any previous
 * completed/failed export and invalidating its download URL. An active
 * (pending/in_progress) job or a completed job newer than the cooldown
 * window triggers a 409 instead.
 */
async function createExportJobOrConflict(
  prisma: PrismaClient,
  userId: string,
  expiresAt: Date
): Promise<CreateOrConflictResult> {
  const exportJobId = generateExportJobUuid(
    userId,
    ACCOUNT_EXPORT_SLUG,
    ACCOUNT_EXPORT_SOURCE,
    EXPORT_FORMAT
  );
  // Fresh random token on every (re)creation — a previously-shared download
  // URL stops working the moment the export is re-run.
  const downloadToken = generateExportDownloadToken();
  const cooldownFloor = new Date(Date.now() - EXPORT_COOLDOWN_HOURS * 60 * 60 * 1000);

  const outcome = await prisma.$transaction(async tx => {
    const existingJob = await tx.exportJob.findFirst({
      where: {
        userId,
        sourceService: ACCOUNT_EXPORT_SOURCE,
        status: { in: ['pending', 'in_progress'] },
      },
    });

    if (existingJob !== null) {
      return { conflictStatus: existingJob.status, onCooldown: false };
    }

    const recentCompleted = await tx.exportJob.findFirst({
      where: {
        userId,
        sourceService: ACCOUNT_EXPORT_SOURCE,
        status: 'completed',
        completedAt: { gt: cooldownFloor },
      },
    });

    if (recentCompleted !== null) {
      return { conflictStatus: null, onCooldown: true };
    }

    await tx.exportJob.upsert({
      where: { id: exportJobId },
      create: {
        id: exportJobId,
        userId,
        sourceSlug: ACCOUNT_EXPORT_SLUG,
        sourceService: ACCOUNT_EXPORT_SOURCE,
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
        fileData: null,
        fileName: null,
        fileSizeBytes: null,
        errorMessage: null,
        startedAt: null,
        completedAt: null,
        expiresAt,
        exportMetadata: Prisma.JsonNull,
      },
    });

    return { conflictStatus: null, onCooldown: false };
  });

  return { exportJobId, downloadToken, ...outcome };
}

/**
 * Memoized base URL (env vars don't change at runtime); same posture as the
 * shapes export module's resolver.
 */
let _baseUrlCache: string | undefined;
function resolveBaseUrl(): string {
  if (_baseUrlCache === undefined) {
    const envConfig = getConfig();
    _baseUrlCache = envConfig.PUBLIC_GATEWAY_URL ?? envConfig.GATEWAY_URL ?? '';
  }
  return _baseUrlCache;
}

function createStartExportHandler(prisma: PrismaClient, queue: Queue, baseUrl: string) {
  return async (req: ProvisionedRequest, res: Response) => {
    const parsed = parseBodyOrSendError(res, StartAccountExportInputSchema, req.body ?? {});
    if (parsed === null) {
      return;
    }

    const userId = resolveProvisionedUserId(req);
    const expiresAt = new Date(Date.now() + EXPORT_EXPIRY_HOURS * 60 * 60 * 1000);

    let exportJobId: string;
    let downloadToken: string;
    let conflictStatus: string | null;
    let onCooldown: boolean;
    try {
      ({ exportJobId, downloadToken, conflictStatus, onCooldown } = await createExportJobOrConflict(
        prisma,
        userId,
        expiresAt
      ));
    } catch (error: unknown) {
      if (isPrismaUniqueConstraintError(error)) {
        logger.warn({ userId }, 'P2002 unique constraint — treating as conflict');
        return sendError(
          res,
          ErrorResponses.conflict(
            'An account export is already in progress. Wait for it to complete.'
          )
        );
      }
      throw error;
    }

    if (conflictStatus !== null) {
      return sendError(
        res,
        ErrorResponses.conflict(
          `An account export is already ${conflictStatus}. Wait for it to complete.`
        )
      );
    }

    if (onCooldown) {
      return sendError(
        res,
        ErrorResponses.conflict(
          'You can export your account once every 24 hours. ' +
            'Your latest export is still available via the status endpoint.'
        )
      );
    }

    const jobData: AccountExportJobData = { userId, exportJobId };

    // Non-deterministic suffix: the DB transaction above prevents duplicate
    // ACTIVE jobs; BullMQ dedups by jobId, and a deterministic ID would make
    // re-exports after completion silently ignored.
    const jobId = `${JOB_PREFIXES.ACCOUNT_EXPORT}${exportJobId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    // The row above is already committed 'pending'; an enqueue failure must
    // mark it 'failed' or it 409s every retry until the 24h expiry.
    await enqueueExportJobOrMarkFailed({
      queue,
      prisma,
      exportJobId,
      jobName: JobType.AccountExport,
      jobData,
      jobOptions: { jobId, attempts: 3, backoff: { type: 'exponential', delay: 5_000 } },
    });

    logger.info({ userId, exportJobId }, 'Account export job created');

    sendCustomSuccess(
      res,
      {
        success: true,
        exportJobId,
        status: 'pending',
        downloadUrl: `${baseUrl}/exports/${encodeURIComponent(downloadToken)}`,
        expiresAt: expiresAt.toISOString(),
      },
      StatusCodes.ACCEPTED
    );
  };
}

function createStatusHandler(prisma: PrismaClient, baseUrl: string) {
  return async (req: ProvisionedRequest, res: Response) => {
    const userId = resolveProvisionedUserId(req);

    // errorMessage stays server-side by design: raw assembly errors can leak
    // infrastructure detail, and the worker already logged them. Clients show
    // generic failure copy off the status field alone.
    const job = await prisma.exportJob.findFirst({
      where: { userId, sourceService: ACCOUNT_EXPORT_SOURCE },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        status: true,
        fileName: true,
        fileSizeBytes: true,
        createdAt: true,
        completedAt: true,
        expiresAt: true,
        downloadToken: true,
      },
    });

    if (job === null) {
      sendCustomSuccess(res, { job: null });
      return;
    }
    // downloadToken never leaves the server as a bare field — it is only ever
    // rendered into the download URL.
    const { downloadToken, ...jobFields } = job;
    sendCustomSuccess(res, {
      job: {
        ...jobFields,
        downloadUrl:
          job.status === 'completed' && downloadToken !== null
            ? `${baseUrl}/exports/${encodeURIComponent(downloadToken)}`
            : null,
      },
    });
  };
}

/** POST /api/user/account/export — start a full-account export job. */
export const handleStartAccountExport = (deps: RouteDeps): RequestHandler => {
  const baseUrl = resolveBaseUrl();
  return asyncHandler(async (req: ProvisionedRequest, res: Response) => {
    if (deps.aiQueue === undefined) {
      sendError(
        res,
        ErrorResponses.serviceUnavailable('Job queue required for account export is not configured')
      );
      return;
    }
    await createStartExportHandler(deps.prisma, deps.aiQueue, baseUrl)(req, res);
  });
};

/** GET /api/user/account/export/status — latest account export job. */
export const handleGetAccountExportStatus = (deps: RouteDeps): RequestHandler =>
  asyncHandler(createStatusHandler(deps.prisma, resolveBaseUrl()));
