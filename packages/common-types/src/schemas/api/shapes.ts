/**
 * Zod schemas for /user/shapes API endpoints.
 *
 * Shapes.inc integration: BYOK session-cookie credentials, listing owned
 * shapes, and async import/export jobs. Most response shapes are
 * permissively-typed wrappers since the job-row Prisma selects include
 * JSONB metadata columns we don't want to fully type at the contract layer.
 */

import { z } from 'zod';

// ============================================================================
// /user/shapes/auth
// ============================================================================

export const StoreShapesAuthInputSchema = z.object({
  // `.trim().min(1)` matches the import/export schemas — rejects whitespace-only
  // at the contract layer so the error category stays VALIDATION_ERROR rather
  // than falling through to the downstream `isPlausibleShapesTokenValue` check.
  sessionCookie: z.string().trim().min(1),
});

export const StoreShapesAuthResponseSchema = z.object({
  success: z.literal(true),
  timestamp: z.string(),
});

export const DeleteShapesAuthResponseSchema = z.object({
  success: z.literal(true),
  message: z.string(),
  timestamp: z.string(),
});

/**
 * Status response — discriminated by `hasCredentials`. When true, the
 * three timestamp fields are present; when false, only the service tag.
 */
export const ShapesAuthStatusResponseSchema = z.discriminatedUnion('hasCredentials', [
  z.object({
    hasCredentials: z.literal(false),
    service: z.string(),
  }),
  z.object({
    hasCredentials: z.literal(true),
    service: z.string(),
    storedAt: z.string(),
    lastUsedAt: z.string().nullable(),
    expiresAt: z.string().nullable(),
  }),
]);
// ============================================================================
// /user/shapes/list
// ============================================================================

export const ShapesListItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  username: z.string(),
  avatar: z.string(),
  createdAt: z.string().nullable(),
});

export const ListShapesResponseSchema = z.object({
  shapes: z.array(ShapesListItemSchema),
  total: z.number().int().nonnegative(),
});

// ============================================================================
// /user/shapes/import
// ============================================================================

/**
 * Request body for `POST /user/shapes/import`. The handler accepts `importType`
 * as the literal `'memory_only'` or anything else (which it normalizes to
 * `'full'`); we narrow to the two known values at the contract layer.
 */
export const StartShapesImportInputSchema = z.object({
  // `.trim()` is load-bearing: the handler relies on the schema to normalize
  // whitespace before `.toLowerCase()`. Without trim here, a whitespace-only
  // sourceSlug would survive `.min(1)` and reach job creation.
  sourceSlug: z.string().trim().min(1),
  importType: z.enum(['full', 'memory_only']).optional(),
});

export const StartShapesImportResponseSchema = z.object({
  success: z.literal(true),
  importJobId: z.string(),
  sourceSlug: z.string(),
  importType: z.string(),
  status: z.string(),
});

/**
 * Import job summary as returned by GET /user/shapes/import/jobs.
 * `importMetadata` is Prisma JSON — passthrough so we don't drift on its shape.
 */
export const ShapesImportJobSummarySchema = z
  .object({
    id: z.string(),
    sourceSlug: z.string(),
    status: z.string(),
    importType: z.string(),
    // Nullable: Prisma columns are `Int?`. Jobs in `pending` or `in_progress`
    // state have `null` for both counts until the worker completes them.
    memoriesImported: z.number().int().nonnegative().nullable(),
    memoriesFailed: z.number().int().nonnegative().nullable(),
    createdAt: z.union([z.string(), z.date()]),
    completedAt: z.union([z.string(), z.date()]).nullable(),
    errorMessage: z.string().nullable(),
    importMetadata: z.unknown(),
  })
  .passthrough();
export const ListShapesImportJobsResponseSchema = z.object({
  jobs: z.array(ShapesImportJobSummarySchema),
});

// ============================================================================
// /user/shapes/export
// ============================================================================

/**
 * Request body for `POST /user/shapes/export`. Note the field is `slug`
 * (not `sourceSlug` — asymmetric with import; the handler uses this name).
 * Format defaults to `'json'` server-side when omitted.
 */
export const StartShapesExportInputSchema = z.object({
  // `.trim()` is load-bearing for the same reason as the import schema —
  // the handler does `.toLowerCase()` without re-trimming.
  slug: z.string().trim().min(1),
  format: z.enum(['json', 'markdown']).optional(),
});

export const StartShapesExportResponseSchema = z.object({
  success: z.literal(true),
  exportJobId: z.string(),
  sourceSlug: z.string(),
  format: z.string(),
  status: z.string(),
  downloadUrl: z.string(),
});

/**
 * Export job summary as returned by GET /user/shapes/export/jobs.
 * `downloadUrl` is populated only for completed jobs.
 */
export const ShapesExportJobSummarySchema = z
  .object({
    id: z.string(),
    sourceSlug: z.string(),
    status: z.string(),
    format: z.string(),
    fileName: z.string().nullable(),
    fileSizeBytes: z.number().int().nullable(),
    createdAt: z.union([z.string(), z.date()]),
    completedAt: z.union([z.string(), z.date()]).nullable(),
    // expiresAt is non-nullable: the Prisma column is `DateTime` (not
    // `DateTime?`) and the export handler always populates it with
    // `new Date(Date.now() + EXPORT_EXPIRY_HOURS * 60 * 60 * 1000)`.
    // Pinning it non-nullable lets bot-client formatters call
    // `new Date(job.expiresAt)` unconditionally.
    expiresAt: z.union([z.string(), z.date()]),
    errorMessage: z.string().nullable(),
    exportMetadata: z.unknown(),
    downloadUrl: z.string().nullable(),
  })
  .passthrough();
export const ListShapesExportJobsResponseSchema = z.object({
  jobs: z.array(ShapesExportJobSummarySchema),
});
