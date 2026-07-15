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

/** No inputs — the export always covers the whole account as a ZIP archive
 *  containing JSON + Markdown files per section. */
export const StartAccountExportInputSchema = z.object({});

/** Export-job lifecycle states (the export_jobs.status vocabulary). */
export const AccountExportJobStatusSchema = z.enum([
  'pending',
  'in_progress',
  'completed',
  'failed',
]);

export const StartAccountExportResponseSchema = z.object({
  success: z.literal(true),
  exportJobId: z.string(),
  status: AccountExportJobStatusSchema,
  downloadUrl: z.string(),
  expiresAt: z.string(),
});

// ============================================================================
// GET /user/account/export/status
// ============================================================================

/** No errorMessage field by design: raw failure detail stays in server logs;
 *  clients render generic copy off status === 'failed'. */
export const AccountExportJobSummarySchema = z
  .object({
    id: z.string(),
    status: AccountExportJobStatusSchema,
    fileName: z.string().nullable(),
    fileSizeBytes: z.number().int().nullable(),
    createdAt: z.union([z.string(), z.date()]).transform(value => new Date(value).toISOString()),
    completedAt: z
      .union([z.string(), z.date()])
      .transform(value => new Date(value).toISOString())
      .nullable(),
    expiresAt: z.union([z.string(), z.date()]).transform(value => new Date(value).toISOString()),
    /** Populated only for completed jobs. */
    downloadUrl: z.string().nullable(),
  })
  .describe('Latest account export job, download-ready when completed');

export const AccountExportStatusResponseSchema = z.object({
  /** Null when the user has never started an account export. */
  job: AccountExportJobSummarySchema.nullable(),
});

// ============================================================================
// Account deletion (full-account erasure)
//
// Purge-pattern confirmation: GET preview → typed phrase → POST token →
// POST delete with the single-use token. The phrase is fixed (the account
// is the target, unlike per-character purges).
// ============================================================================

/** The exact phrase the user must type; compared case-insensitively. */
export const ACCOUNT_DELETE_CONFIRMATION_PHRASE = 'DELETE MY ACCOUNT';

/**
 * Branded single-use deletion token. Same shape as PurgeToken but a distinct
 * brand + prefix so a memory-purge token can never authorize account erasure.
 */
export const AccountDeleteTokenSchema = z
  .string()
  .regex(/^acctdel_[A-Za-z0-9_-]{16,64}$/, 'Invalid account delete token format')
  .brand<'AccountDeleteToken'>();

/** One owned character with its cross-user blast radius. */
export const OwnedCharacterImpactSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Distinct OTHER users holding memories with this character — deleting
   *  the account deletes the character and those memories for everyone. */
  otherUsersWithMemories: z.number().int(),
});

// GET /user/account/delete/preview
export const AccountDeletePreviewResponseSchema = z.object({
  confirmationPhrase: z.literal(ACCOUNT_DELETE_CONFIRMATION_PHRASE),
  ownedCharacters: z.array(OwnedCharacterImpactSchema),
  counts: z.object({
    personas: z.number().int(),
    characters: z.number().int(),
    conversationMessages: z.number().int(),
    memories: z.number().int(),
    facts: z.number().int(),
  }),
  /** True while an export job is pending/in_progress — deletion kills it. */
  hasActiveExport: z.boolean(),
});

// POST /user/account/delete/token
export const IssueAccountDeleteTokenSchema = z.object({
  confirmationPhrase: z.string().min(1, 'confirmationPhrase is required'),
});

export const IssueAccountDeleteTokenResponseSchema = z.object({
  deleteToken: AccountDeleteTokenSchema,
});

// POST /user/account/delete
export const DeleteAccountSchema = z.object({
  deleteToken: AccountDeleteTokenSchema,
});

export const DeleteAccountResponseSchema = z.object({
  success: z.literal(true),
  summary: z.object({
    personas: z.number().int(),
    characters: z.number().int(),
    conversationMessages: z.number().int(),
    memories: z.number().int(),
    facts: z.number().int(),
    /** Facts about the user swept by entity-tag across ALL scopes (superset
     *  of persona-scoped facts; includes other users' persona scopes). */
    factsSweptByTag: z.number().int(),
    pendingMemories: z.number().int(),
    diagnosticLogs: z.number().int(),
    /** Names of the owned characters that were deleted for everyone. */
    characterNames: z.array(z.string()),
  }),
});
