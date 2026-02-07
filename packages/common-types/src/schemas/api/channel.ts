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
  activatedBy: z.string().uuid().nullable(),
  createdAt: z.string(),
});
export type ChannelSettings = z.infer<typeof ChannelSettingsSchema>;

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
