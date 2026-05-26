/**
 * Zod schemas for /user/memory/incognito API endpoints
 *
 * Incognito mode temporarily suspends memory writing (the inverse of focus
 * mode, which suspends reading). State lives in Redis keyed by
 * (userId, personalityId), so endpoints are inherently per-personality —
 * `personalityId: 'all'` is the global toggle.
 *
 * Input schemas live in types/incognito.ts (where the IncognitoSession type
 * and Redis-key shape already live); this file holds only the response
 * schemas the gateway sends back.
 */

import { z } from 'zod';
import { IncognitoSessionSchema } from '../../types/incognito.js';

/** A session enriched with `timeRemaining` (ms) computed at response time. */
export const IncognitoSessionWithRemainingSchema = IncognitoSessionSchema.extend({
  /** Milliseconds until expiry; null if `duration: 'forever'`. */
  timeRemaining: z.number().nullable(),
});
export type IncognitoSessionWithRemaining = z.infer<typeof IncognitoSessionWithRemainingSchema>;

// ============================================================================
// GET /user/memory/incognito
// ============================================================================

export const GetIncognitoStatusResponseSchema = z.object({
  active: z.boolean(),
  sessions: z.array(IncognitoSessionWithRemainingSchema),
});
export type GetIncognitoStatusResponse = z.infer<typeof GetIncognitoStatusResponseSchema>;

// ============================================================================
// POST /user/memory/incognito (enable)
// Returns CREATED when newly enabled, OK when wasAlreadyActive is true.
// ============================================================================

export const EnableIncognitoResponseSchema = z.object({
  session: IncognitoSessionSchema,
  timeRemaining: z.number().nullable(),
  wasAlreadyActive: z.boolean(),
  message: z.string(),
});
export type EnableIncognitoResponse = z.infer<typeof EnableIncognitoResponseSchema>;

// ============================================================================
// DELETE /user/memory/incognito (disable)
// ============================================================================

export const DisableIncognitoResponseSchema = z.object({
  disabled: z.boolean(),
  message: z.string(),
});
export type DisableIncognitoResponse = z.infer<typeof DisableIncognitoResponseSchema>;

// ============================================================================
// POST /user/memory/incognito/forget
// Retroactively delete memories created in the last `timeframe` window.
// ============================================================================

export const IncognitoForgetResponseSchema = z.object({
  deletedCount: z.number().int().nonnegative(),
  personalities: z.array(z.string()),
  message: z.string(),
});
export type IncognitoForgetResponse = z.infer<typeof IncognitoForgetResponseSchema>;
