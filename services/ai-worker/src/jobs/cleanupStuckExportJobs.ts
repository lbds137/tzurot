/**
 * Cleanup Stuck Export Jobs
 *
 * Finds export jobs stuck in 'in_progress' status for over an hour
 * (e.g., due to worker crash mid-export) and marks them as failed
 * so users can retry.
 *
 * Called by the scheduled-jobs worker every 15 minutes.
 */

import { createStuckJobCleanup, type StuckJobCleanupResult } from './cleanupStuckJobs.js';

export type StuckExportCleanupResult = StuckJobCleanupResult;

export const cleanupStuckExportJobs = createStuckJobCleanup({
  loggerName: 'cleanup-stuck-exports',
  logPrefix: '[StuckExportCleanup]',
  jobIdLogField: 'exportJobId',
  errorMessage: 'Job timed out — worker may have restarted. You can retry the export.',
  findStuckJobs: (prisma, cutoff) =>
    prisma.exportJob.findMany({
      where: { status: 'in_progress', startedAt: { lt: cutoff } },
      select: { id: true, sourceSlug: true, startedAt: true },
      take: 500,
    }),
  markJobsFailed: (prisma, jobIds, errorMessage) =>
    prisma.exportJob.updateMany({
      where: { id: { in: jobIds } },
      data: { status: 'failed', completedAt: new Date(), errorMessage },
    }),
});
