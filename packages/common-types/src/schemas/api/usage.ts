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
export type UsageBreakdown = z.infer<typeof UsageBreakdownSchema>;

/** Valid time periods for usage queries */
export const UsagePeriodSchema = z.enum(['day', 'week', 'month', 'all']);
export type UsagePeriod = z.infer<typeof UsagePeriodSchema>;

/** Token usage statistics */
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
