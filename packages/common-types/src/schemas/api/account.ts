/**
 * Zod schemas for the account data-rights endpoints:
 * - POST /user/account/export        (start a full-account export job)
 * - GET  /user/account/export/status (latest account export job state)
 *
 * The delete-account schemas land beside these when the erasure feature
 * ships — the two features share this file by design.
 */

import { z } from 'zod';

// ============================================================================
// POST /user/account/export
// ============================================================================

/** No inputs in v1 — the export always covers the whole account as JSON. */
export const StartAccountExportInputSchema = z.object({});

export const StartAccountExportResponseSchema = z.object({
  success: z.literal(true),
  exportJobId: z.string(),
  status: z.string(),
  downloadUrl: z.string(),
  expiresAt: z.string(),
});

// ============================================================================
// GET /user/account/export/status
// ============================================================================

export const AccountExportJobSummarySchema = z
  .object({
    id: z.string(),
    status: z.string(),
    fileName: z.string().nullable(),
    fileSizeBytes: z.number().int().nullable(),
    createdAt: z.union([z.string(), z.date()]).transform(value => new Date(value).toISOString()),
    completedAt: z
      .union([z.string(), z.date()])
      .transform(value => new Date(value).toISOString())
      .nullable(),
    expiresAt: z.union([z.string(), z.date()]).transform(value => new Date(value).toISOString()),
    errorMessage: z.string().nullable(),
    /** Populated only for completed jobs. */
    downloadUrl: z.string().nullable(),
  })
  .describe('Latest account export job, download-ready when completed');

export const AccountExportStatusResponseSchema = z.object({
  /** Null when the user has never started an account export. */
  job: AccountExportJobSummarySchema.nullable(),
});
