/**
 * Account-export job contract.
 *
 * The full-account export rides the shapes export spine: an `export_jobs`
 * row (24h expiry, public /exports/:jobId download) filled by an ai-worker
 * job. The sentinels below distinguish account exports inside the shared
 * table — `sourceService`/`sourceSlug` are shapes-shaped column names, so
 * the constant definitions are where that naming stretch is documented.
 */

import { z } from 'zod';

/** `export_jobs.sourceService` sentinel for full-account exports. */
export const ACCOUNT_EXPORT_SOURCE = 'account';

/** `export_jobs.sourceSlug` sentinel — one account export slot per user+format. */
export const ACCOUNT_EXPORT_SLUG = 'account';

export const accountExportJobDataSchema = z.object({
  /** Internal user UUID whose data is being exported. */
  userId: z.string().uuid(),
  /** The export_jobs row this job fills. */
  exportJobId: z.string().uuid(),
});

export type AccountExportJobData = z.infer<typeof accountExportJobDataSchema>;

export interface AccountExportJobResult {
  success: boolean;
  fileSizeBytes: number;
  error?: string;
}
