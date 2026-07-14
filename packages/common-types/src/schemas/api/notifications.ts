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
