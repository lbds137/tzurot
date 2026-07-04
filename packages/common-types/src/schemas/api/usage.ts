/**
 * Zod schemas for /user/usage API endpoints
 *
 * Token usage statistics and breakdown types.
 */

import { z } from 'zod';

// ============================================================================
// Shared Sub-schemas
// ============================================================================

/** Token usage breakdown by category */
export const UsageBreakdownSchema = z.object({
  requests: z.number().int().nonnegative(),
  tokensIn: z.number().int().nonnegative(),
  tokensOut: z.number().int().nonnegative(),
});

/** Valid time periods for usage queries */
export const UsagePeriodSchema = z.enum(['day', 'week', 'month', 'all']);
export type UsagePeriod = z.infer<typeof UsagePeriodSchema>;

/** Token usage statistics — per-user (returned by GET /user/usage). */
export const UsageStatsSchema = z.object({
  period: UsagePeriodSchema,
  periodStart: z.string().nullable(),
  periodEnd: z.string(),
  totalRequests: z.number().int().nonnegative(),
  totalTokensIn: z.number().int().nonnegative(),
  totalTokensOut: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  byProvider: z.record(z.string(), UsageBreakdownSchema),
  byModel: z.record(z.string(), UsageBreakdownSchema),
  byRequestType: z.record(z.string(), UsageBreakdownSchema),
  /** True if results were truncated due to query limits */
  limitReached: z.boolean().optional(),
});

export type UsageStats = z.infer<typeof UsageStatsSchema>;

/** Top-user summary returned by GET /admin/usage. */
export const TopUserUsageSchema = z.object({
  discordId: z.string(),
  requests: z.number().int().nonnegative(),
  tokens: z.number().int().nonnegative(),
});

/**
 * Token usage statistics — admin-flavor (returned by GET /admin/usage).
 *
 * Overlaps with `UsageStatsSchema` on the totals + breakdown shape, but
 * the period model is fundamentally different: the per-user endpoint
 * binds `period` to the `UsagePeriod` enum ('day' | 'week' | 'month' | 'all'),
 * whereas the admin endpoint accepts a freeform `timeframe` string
 * ('7d', '24h', '30d', etc.) and echoes it back. Sharing a base via
 * `UsageStatsSchema.extend(...)` would force the admin response to
 * include an enum-bound `period` field the handler doesn't actually
 * return, breaking runtime Zod validation. Standalone definition keeps
 * the two schemas honest about their wire contracts.
 *
 * Admin-only fields beyond the shared totals:
 *   - `timeframe`: echo of the caller's `?timeframe=` query string
 *   - `uniqueUsers`: distinct users who made at least one request
 *   - `topUsers`: top users by request count, descending
 */
export const AdminUsageStatsSchema = z.object({
  // Shared with UsageStatsSchema (sans `period`):
  periodStart: z.string().nullable(),
  periodEnd: z.string(),
  totalRequests: z.number().int().nonnegative(),
  totalTokensIn: z.number().int().nonnegative(),
  totalTokensOut: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  byProvider: z.record(z.string(), UsageBreakdownSchema),
  byModel: z.record(z.string(), UsageBreakdownSchema),
  byRequestType: z.record(z.string(), UsageBreakdownSchema),
  limitReached: z.boolean().optional(),
  // Admin-only:
  timeframe: z.string(),
  uniqueUsers: z.number().int().nonnegative(),
  topUsers: z.array(TopUserUsageSchema),
});

export type AdminUsageStats = z.infer<typeof AdminUsageStatsSchema>;
