/**
 * Zod schemas for /user/timezone API endpoints
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
// GET /user/timezone
// Returns user's current timezone
// ============================================================================

export const GetTimezoneResponseSchema = z.object({
  timezone: z.string(),
  isDefault: z.boolean(),
});
export type GetTimezoneResponse = z.infer<typeof GetTimezoneResponseSchema>;

// ============================================================================
// PUT /user/timezone
// Sets user's timezone
// ============================================================================

export const SetTimezoneResponseSchema = z.object({
  success: z.literal(true),
  timezone: z.string(),
  label: z.string(),
  offset: z.string(),
});
export type SetTimezoneResponse = z.infer<typeof SetTimezoneResponseSchema>;

// ============================================================================
// Input Schemas (request body validation)
// ============================================================================

/**
 * Schema for setting user's timezone.
 * Timezone validity (IANA) is checked by the route handler after parsing.
 */
export const SetTimezoneInputSchema = z.object({
  timezone: z.string().min(1, 'timezone is required'),
});
export type SetTimezoneInput = z.infer<typeof SetTimezoneInputSchema>;
