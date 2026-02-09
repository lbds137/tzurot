/**
 * Zod schemas for /admin API endpoint inputs
 *
 * Validates request bodies for admin-only operations.
 */

import { z } from 'zod';

// ============================================================================
// POST /admin/invalidate-cache
// ============================================================================

/**
 * Either invalidate all caches or a specific personality's cache.
 * Requires `all: true` OR a non-empty `personalityId`.
 */
export const InvalidateCacheSchema = z
  .object({
    personalityId: z.string().uuid('Invalid personalityId format').optional(),
    all: z.boolean().optional().default(false),
  })
  .refine(data => data.all || (data.personalityId !== undefined && data.personalityId.length > 0), {
    message: 'Must provide either "personalityId" or "all: true"',
  });
export type InvalidateCacheInput = z.infer<typeof InvalidateCacheSchema>;

// ============================================================================
// POST /admin/db-sync
// ============================================================================

export const DbSyncSchema = z.object({
  dryRun: z.boolean().optional().default(false),
});
export type DbSyncInput = z.infer<typeof DbSyncSchema>;

// ============================================================================
// PATCH /admin/diagnostic/:requestId/response-ids
// ============================================================================

export const DiagnosticUpdateSchema = z.object({
  responseMessageIds: z
    .array(z.string().min(1, 'Each message ID must be non-empty'))
    .max(100, 'responseMessageIds exceeds maximum length of 100'),
});
export type DiagnosticUpdateInput = z.infer<typeof DiagnosticUpdateSchema>;
