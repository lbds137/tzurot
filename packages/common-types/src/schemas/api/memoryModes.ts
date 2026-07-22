/**
 * Zod schemas for the /user/memory/{incognito,fresh} API endpoints
 *
 * Both memory modes are Redis-TTL sessions keyed by (userId, personalityId)
 * — `personalityId: 'all'` is the global toggle — and their endpoints return
 * identical shapes, so the response schemas are shared. Incognito suspends
 * memory WRITING; fresh suspends memory READING (memories are kept, just not
 * used). Input schemas live in types/memory-modes.ts (with the session type
 * and Redis-key shape); this file holds only the response schemas the
 * gateway sends back.
 */

import { z } from 'zod';
import { MemoryModeSessionSchema } from '../../types/memory-modes.js';

/**
 * A session enriched with `timeRemaining` (human-formatted string) computed
 * at response time. The handler emits one of: "<n> minutes/hours/days/...",
 * "Until manually disabled" (for `duration: 'forever'`), or "Expired"
 * (when the session is past expiry but hasn't been swept yet).
 */
export const MemoryModeSessionWithRemainingSchema = MemoryModeSessionSchema.extend({
  timeRemaining: z.string().min(1),
});

export type MemoryModeSessionWithRemaining = z.infer<typeof MemoryModeSessionWithRemainingSchema>;

// ============================================================================
// GET /user/memory/incognito · GET /user/memory/fresh
// ============================================================================

export const GetMemoryModeStatusResponseSchema = z.object({
  active: z.boolean(),
  sessions: z.array(MemoryModeSessionWithRemainingSchema),
});

// ============================================================================
// POST /user/memory/incognito · POST /user/memory/fresh (enable)
// Returns CREATED when newly enabled, OK when wasAlreadyActive is true.
// ============================================================================

export const EnableMemoryModeResponseSchema = z.object({
  session: MemoryModeSessionSchema,
  /**
   * Human-formatted string computed by `MemoryModeSessionManager.getTimeRemaining`;
   * never a raw millisecond count. One of "<n> minutes/hours/days/...",
   * "Until manually disabled" (for `duration: 'forever'`), or "Expired".
   */
  timeRemaining: z.string().min(1),
  wasAlreadyActive: z.boolean(),
  message: z.string(),
});

// ============================================================================
// DELETE /user/memory/incognito · DELETE /user/memory/fresh (disable)
// ============================================================================

export const DisableMemoryModeResponseSchema = z.object({
  disabled: z.boolean(),
  message: z.string(),
});

// ============================================================================
// POST /user/memory/incognito/forget
// Retroactively delete memories created in the last `timeframe` window.
// (Write-side only — there is no fresh-side analog to retroactively
// suppress reads.)
// ============================================================================

export const IncognitoForgetResponseSchema = z.object({
  deletedCount: z.number().int().nonnegative(),
  personalities: z.array(z.string()),
  message: z.string(),
});
