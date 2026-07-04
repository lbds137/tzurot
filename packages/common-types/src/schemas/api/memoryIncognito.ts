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

/**
 * A session enriched with `timeRemaining` (human-formatted string) computed
 * at response time. The handler emits one of: "<n> minutes/hours/days/...",
 * "Until manually disabled" (for `duration: 'forever'`), or "Expired"
 * (when the session is past expiry but hasn't been swept yet).
 */
export const IncognitoSessionWithRemainingSchema = IncognitoSessionSchema.extend({
  timeRemaining: z.string().min(1),
});

export type IncognitoSessionWithRemaining = z.infer<typeof IncognitoSessionWithRemainingSchema>;

// ============================================================================
// GET /user/memory/incognito
// ============================================================================

export const GetIncognitoStatusResponseSchema = z.object({
  active: z.boolean(),
  sessions: z.array(IncognitoSessionWithRemainingSchema),
});

// ============================================================================
// POST /user/memory/incognito (enable)
// Returns CREATED when newly enabled, OK when wasAlreadyActive is true.
// ============================================================================

export const EnableIncognitoResponseSchema = z.object({
  session: IncognitoSessionSchema,
  /**
   * Human-formatted string computed by `IncognitoSessionManager.getTimeRemaining`;
   * never a raw millisecond count. One of "<n> minutes/hours/days/...",
   * "Until manually disabled" (for `duration: 'forever'`), or "Expired".
   */
  timeRemaining: z.string().min(1),
  wasAlreadyActive: z.boolean(),
  message: z.string(),
});

// ============================================================================
// DELETE /user/memory/incognito (disable)
// ============================================================================

export const DisableIncognitoResponseSchema = z.object({
  disabled: z.boolean(),
  message: z.string(),
});

// ============================================================================
// POST /user/memory/incognito/forget
// Retroactively delete memories created in the last `timeframe` window.
// ============================================================================

export const IncognitoForgetResponseSchema = z.object({
  deletedCount: z.number().int().nonnegative(),
  personalities: z.array(z.string()),
  message: z.string(),
});
