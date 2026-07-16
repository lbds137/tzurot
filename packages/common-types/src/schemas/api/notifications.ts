/**
 * Zod schemas for /user/notifications API endpoints
 *
 * These schemas define the contract between api-gateway and bot-client.
 * BOTH services should import these to ensure type safety.
 *
 * Usage:
 * - Gateway: Use schema.parse(response) before sending
 * - Bot-client tests: Use factories from @tzurot/common-types/factories
 */

import { z } from 'zod';

/**
 * Minimum changelog-derived release weight a user wants DM'd.
 * Mirrors the Prisma NotifyLevel enum: Breaking Changes → major,
 * Features → minor, fixes-only → patch.
 */
export const NotifyLevelSchema = z.enum(['major', 'minor', 'patch']);

export type NotifyLevelValue = z.infer<typeof NotifyLevelSchema>;

// ============================================================================
// GET /user/notifications
// Returns the user's release-notes DM preferences
// ============================================================================

export const GetNotificationPrefsResponseSchema = z.object({
  enabled: z.boolean(),
  level: NotifyLevelSchema,
});

export type GetNotificationPrefsResponse = z.infer<typeof GetNotificationPrefsResponseSchema>;

// ============================================================================
// PATCH /user/notifications
// Partial update: either field may be omitted, but not both
// ============================================================================

export const UpdateNotificationPrefsInputSchema = z
  .object({
    enabled: z.boolean().optional(),
    level: NotifyLevelSchema.optional(),
  })
  .refine(input => input.enabled !== undefined || input.level !== undefined, {
    message: 'At least one of enabled or level is required',
  });

export const UpdateNotificationPrefsResponseSchema = z.object({
  success: z.literal(true),
  enabled: z.boolean(),
  level: NotifyLevelSchema,
});

export type UpdateNotificationPrefsResponse = z.infer<typeof UpdateNotificationPrefsResponseSchema>;

// ============================================================================
// GET /user/notifications/release-dms
// The user's release DMs still standing (sent, not yet deleted) — the
// /notifications cleanup command deletes these from the DM channel.
// ============================================================================

/**
 * Bounded: each blast targets at most one prior DM per user for auto-cleanup,
 * so standing DMs only accrue past one when a delete-before-send failed —
 * this cap absorbs that accumulation with generous room.
 */
export const RELEASE_DM_CLEANUP_MAX = 100;

export const ListReleaseDmsResponseSchema = z.object({
  messages: z.array(
    z.object({
      deliveryLogId: z.string().uuid(),
      /** Snowflake of the sent DM in the user's channel with the bot. */
      messageId: z.string(),
    })
  ),
});

// ============================================================================
// POST /user/notifications/release-dms/deleted
// Bot-client reports which release DMs it deleted; rows get messageDeletedAt.
// ============================================================================

export const MarkReleaseDmsDeletedInputSchema = z.object({
  deliveryLogIds: z.array(z.string().uuid()).min(1).max(RELEASE_DM_CLEANUP_MAX),
});

export const MarkReleaseDmsDeletedResponseSchema = z.object({
  success: z.literal(true),
  /** Rows actually stamped (ownership-scoped; already-stamped rows skip). */
  marked: z.number().int().min(0),
});
