/**
 * Zod schemas for /user/usage API endpoints
 *
 * These schemas define the contract between api-gateway and bot-client.
 * BOTH services should import these to ensure type safety.
 *
 * Usage:
 * - Gateway: Use schema.parse(response) before sending
 * - Bot-client tests: Use factories from @tzurot/common-types/factories
 */

import { z } from 'zod';

// ============================================================================
// Shared Sub-schemas
// ============================================================================

/** Valid time periods for usage queries */
const UsagePeriodSchema = z.enum(['day', 'week', 'month', 'all']);

/** Token usage breakdown by category */
export const UsageBreakdownSchema = z.object({
  requests: z.number(),
  tokensIn: z.number(),
  tokensOut: z.number(),
});

// ============================================================================
// GET /user/usage
// Returns token usage statistics
// ============================================================================

export const GetUsageResponseSchema = z.object({
  period: UsagePeriodSchema,
  periodStart: z.string().nullable(),
  periodEnd: z.string(),
  totalRequests: z.number(),
  totalTokensIn: z.number(),
  totalTokensOut: z.number(),
  totalTokens: z.number(),
  byProvider: z.record(z.string(), UsageBreakdownSchema),
  byModel: z.record(z.string(), UsageBreakdownSchema),
  byRequestType: z.record(z.string(), UsageBreakdownSchema),
});
