/**
 * Cleanup Stuck Import Jobs
 *
 * Finds import jobs stuck in 'in_progress' status for over an hour
 * (e.g., due to worker crash mid-import) and marks them as failed
 * so users can retry.
 *
 * Called by the scheduled-jobs worker every 15 minutes.
 */

import { createStuckJobCleanup, type StuckJobCleanupResult } from './cleanupStuckJobs.js';

export type StuckImportCleanupResult = StuckJobCleanupResult;

export const cleanupStuckImportJobs = createStuckJobCleanup({
  loggerName: 'cleanup-stuck-imports',
  logPrefix: '[StuckImportCleanup]',
  jobIdLogField: 'importJobId',
  errorMessage: 'Job timed out — worker may have restarted. You can retry the import.',
  findStuckJobs: (prisma, cutoff) =>
    prisma.importJob.findMany({
      where: { status: 'in_progress', startedAt: { lt: cutoff } },
      select: { id: true, sourceSlug: true, startedAt: true },
      take: 500,
    }),
  markJobsFailed: (prisma, jobIds, errorMessage) =>
    prisma.importJob.updateMany({
      where: { id: { in: jobIds } },
      data: { status: 'failed', completedAt: new Date(), errorMessage },
    }),
});
