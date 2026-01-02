/**
 * Zod schemas for /user/channel API endpoints
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

/** Channel settings record (replaces ActivatedChannel) */
export const ChannelSettingsSchema = z.object({
  id: z.string().uuid(),
  channelId: z.string().min(1),
  guildId: z.string().nullable(), // Nullable for DM channels
  personalitySlug: z.string().min(1).nullable(), // Null if no personality activated
  personalityName: z.string().min(1).nullable(), // Null if no personality activated
  autoRespond: z.boolean(),
  extendedContext: z.boolean().nullable(), // null = use global default
  extendedContextMaxMessages: z.number().int().min(1).max(100).nullable(), // null = use global
  extendedContextMaxAge: z.number().int().min(1).nullable(), // seconds, null = use global
  extendedContextMaxImages: z.number().int().min(0).max(20).nullable(), // null = use global
  activatedBy: z.string().uuid().nullable(),
  createdAt: z.string(),
});
export type ChannelSettings = z.infer<typeof ChannelSettingsSchema>;

/** @deprecated Use ChannelSettingsSchema - kept for backward compatibility during migration */
export const ActivatedChannelSchema = ChannelSettingsSchema;
/** @deprecated Use ChannelSettings - kept for backward compatibility during migration */
export type ActivatedChannel = ChannelSettings;

// ============================================================================
// POST /user/channel/activate
// Activates a personality in a channel (replaces any existing activation)
// ============================================================================

export const ActivateChannelRequestSchema = z.object({
  channelId: z.string().min(1),
  personalitySlug: z.string().min(1),
  guildId: z.string().min(1),
});
export type ActivateChannelRequest = z.infer<typeof ActivateChannelRequestSchema>;

export const ActivateChannelResponseSchema = z.object({
  activation: ChannelSettingsSchema,
  replaced: z.boolean(), // True if an existing activation was replaced
});
export type ActivateChannelResponse = z.infer<typeof ActivateChannelResponseSchema>;

// ============================================================================
// DELETE /user/channel/deactivate
// Deactivates a personality from a channel
// ============================================================================

export const DeactivateChannelRequestSchema = z.object({
  channelId: z.string().min(1),
});
export type DeactivateChannelRequest = z.infer<typeof DeactivateChannelRequestSchema>;

export const DeactivateChannelResponseSchema = z.object({
  deactivated: z.boolean(),
  personalityName: z.string().optional(), // Present if something was deactivated
});
export type DeactivateChannelResponse = z.infer<typeof DeactivateChannelResponseSchema>;

// ============================================================================
// GET /user/channel/:channelId
// Gets settings for a specific channel
// ============================================================================

export const GetChannelSettingsResponseSchema = z.object({
  hasSettings: z.boolean(),
  settings: ChannelSettingsSchema.optional(),
});
export type GetChannelSettingsResponse = z.infer<typeof GetChannelSettingsResponseSchema>;

/** @deprecated Use GetChannelSettingsResponseSchema */
export const GetChannelActivationResponseSchema = z.object({
  isActivated: z.boolean(),
  activation: ChannelSettingsSchema.optional(),
});
/** @deprecated Use GetChannelSettingsResponse */
export type GetChannelActivationResponse = z.infer<typeof GetChannelActivationResponseSchema>;

// ============================================================================
// GET /user/channel/list
// Lists all channel settings (optionally filtered by guild)
// Query params: ?guildId=xxx (optional)
// ============================================================================

export const ListChannelSettingsResponseSchema = z.object({
  settings: z.array(ChannelSettingsSchema),
});
export type ListChannelSettingsResponse = z.infer<typeof ListChannelSettingsResponseSchema>;

/** @deprecated Use ListChannelSettingsResponseSchema */
export const ListChannelActivationsResponseSchema = z.object({
  activations: z.array(ChannelSettingsSchema),
});
/** @deprecated Use ListChannelActivationsResponse */
export type ListChannelActivationsResponse = z.infer<typeof ListChannelActivationsResponseSchema>;

// ============================================================================
// PATCH /user/channel/update-guild
// Updates guildId for an existing channel settings record
// ============================================================================

export const UpdateChannelGuildRequestSchema = z.object({
  channelId: z.string().min(1),
  guildId: z.string().min(1),
});
export type UpdateChannelGuildRequest = z.infer<typeof UpdateChannelGuildRequestSchema>;

export const UpdateChannelGuildResponseSchema = z.object({
  updated: z.boolean(),
});
export type UpdateChannelGuildResponse = z.infer<typeof UpdateChannelGuildResponseSchema>;

// ============================================================================
// PATCH /user/channel/:channelId/extended-context
// Updates extended context settings for a channel
// All fields are optional - only specified fields are updated
// ============================================================================

export const UpdateChannelExtendedContextRequestSchema = z
  .object({
    extendedContext: z.boolean().nullable().optional(), // null = use global default
    extendedContextMaxMessages: z.number().int().min(1).max(100).nullable().optional(),
    extendedContextMaxAge: z.number().int().min(1).nullable().optional(), // seconds
    extendedContextMaxImages: z.number().int().min(0).max(20).nullable().optional(),
  })
  .refine(data => Object.values(data).some(v => v !== undefined), {
    message: 'At least one field must be specified',
  });
export type UpdateChannelExtendedContextRequest = z.infer<
  typeof UpdateChannelExtendedContextRequestSchema
>;

export const UpdateChannelExtendedContextResponseSchema = z.object({
  updated: z.boolean(),
  settings: ChannelSettingsSchema,
});
export type UpdateChannelExtendedContextResponse = z.infer<
  typeof UpdateChannelExtendedContextResponseSchema
>;
