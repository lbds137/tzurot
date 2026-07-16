/**
 * Account Export Job Processor
 *
 * BullMQ job handler for full-account data exports (data portability):
 * 1. Mark the export_jobs row in_progress
 * 2. Assemble the account data (AccountExportAssembler — pure DB reads)
 * 3. Build the per-section file map (JSON + Markdown) and ZIP it
 * 4. Store the archive in ExportJob.fileData (BYTEA) and update status
 *
 * Self-contained like the shapes export: status lives on the ExportJob row;
 * the user downloads via the public /exports/:token route until expiry.
 */

import type { Job } from 'bullmq';
import { zipSync, strToU8 } from 'fflate';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import {
  type AccountExportJobData,
  type AccountExportJobResult,
} from '@tzurot/common-types/types/account-export';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { assembleAccountExport } from './AccountExportAssembler.js';
import { buildAccountExportFiles } from './AccountExportFiles.js';

const logger = createLogger('AccountExportJob');

export async function processAccountExportJob(
  job: Job<AccountExportJobData>,
  prisma: PrismaClient
): Promise<AccountExportJobResult> {
  const { userId, exportJobId } = job.data;

  logger.info({ jobId: job.id, exportJobId }, 'Starting account export');

  await prisma.exportJob.update({
    where: { id: exportJobId },
    data: { status: 'in_progress', startedAt: new Date() },
  });

  try {
    const payload = await assembleAccountExport(prisma, userId);
    const files = buildAccountExportFiles(payload);

    const zipEntries: Record<string, Uint8Array> = {};
    for (const [path, content] of Object.entries(files)) {
      zipEntries[path] = strToU8(content);
    }
    const fileData = zipSync(zipEntries);
    const fileSizeBytes = fileData.length;

    const username =
      typeof payload.profile.username === 'string' ? payload.profile.username : 'user';
    const safeUsername = username.replace(/[^\w.-]/g, '_');
    const fileName = `tzurot-account-export-${safeUsername}-${new Date().toISOString().slice(0, 10)}.zip`;

    await prisma.exportJob.update({
      where: { id: exportJobId },
      data: {
        status: 'completed',
        fileContent: null,
        fileData,
        fileName,
        fileSizeBytes,
        completedAt: new Date(),
        exportMetadata: {
          personas: payload.personas.length,
          characters: payload.characters.length,
          conversationHistory: payload.conversationHistory.length,
          memories: payload.memories.length,
          facts: payload.facts.length,
          feedback: payload.feedback.length,
          files: Object.keys(files).length,
        },
      },
    });

    logger.info({ jobId: job.id, exportJobId, fileSizeBytes }, 'Account export completed');
    return { success: true, fileSizeBytes };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    // Assembly is pure DB reads, so every failure class is worth retrying —
    // a transient pool timeout succeeds next attempt; a deterministic error
    // just re-reads cheaply before exhausting. Re-throw while attempts
    // remain (BullMQ retries only on a REJECTED processor promise; the row
    // stays in_progress and the next attempt re-marks it from the top), and
    // mark failed only on the final attempt so users never see a
    // permanently stuck status. Attempt arithmetic mirrors
    // handleShapesJobError.
    const maxAttempts = job.opts.attempts ?? 1;
    if (job.attemptsMade < maxAttempts - 1) {
      logger.warn(
        { err: error, jobId: job.id, exportJobId, attemptsMade: job.attemptsMade, maxAttempts },
        'Account export attempt failed — BullMQ will retry'
      );
      throw error;
    }
    logger.error({ err: error, jobId: job.id, exportJobId }, 'Account export failed');
    await prisma.exportJob.update({
      where: { id: exportJobId },
      data: { status: 'failed', completedAt: new Date(), errorMessage },
    });
    return { success: false, fileSizeBytes: 0, error: errorMessage };
  }
}
