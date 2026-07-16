/**
 * Enqueue an export's BullMQ work item AFTER its export_jobs row was committed
 * 'pending'. If the enqueue throws (Redis blip), the pending row would
 * otherwise sit forever — 409ing every retry as "already in progress" until
 * the 24h expiry, with no job ever coming (the deterministic job UUID that
 * makes re-exports idempotent is also what makes the stuck row sticky).
 * Marking the row 'failed' lets the user immediately re-run instead.
 *
 * The original enqueue error is rethrown either way, so the route's error
 * handling surfaces the failure to the caller.
 */

import { type Queue, type JobsOptions } from 'bullmq';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import { createLogger } from '@tzurot/common-types/utils/logger';

const logger = createLogger('enqueueExportJob');

export async function enqueueExportJobOrMarkFailed(opts: {
  queue: Queue;
  prisma: PrismaClient;
  exportJobId: string;
  jobName: string;
  jobData: unknown;
  jobOptions: JobsOptions;
}): Promise<void> {
  const { queue, prisma, exportJobId, jobName, jobData, jobOptions } = opts;
  try {
    await queue.add(jobName, jobData, jobOptions);
  } catch (error) {
    // Best-effort failure-marking: if this update ALSO fails (DB blip on top
    // of the Redis blip), the original error still propagates and the row
    // falls back to the old stuck-pending-until-expiry behavior.
    try {
      await prisma.exportJob.update({
        where: { id: exportJobId },
        data: {
          status: 'failed',
          // Deliberately generic: the shapes list route returns errorMessage
          // verbatim to the user, so a raw enqueue error (which can carry
          // connection detail) must not be written here. The full error is
          // warn-logged below for the operator.
          errorMessage: 'Failed to queue the export job — please retry.',
        },
      });
      logger.warn(
        { err: error, exportJobId, jobName },
        'Export enqueue failed - job row marked failed so the user can re-run'
      );
    } catch (markError) {
      logger.error(
        { err: markError, exportJobId, jobName },
        'Failed to mark export row failed after enqueue error - row will 409 until expiry'
      );
    }
    throw error;
  }
}
