/**
 * Internal API endpoints
 *
 * Service-to-service endpoints under /internal/. Not for user-scoped traffic.
 * Service-auth protected by the global middleware in api-gateway/src/index.ts.
 */

import { z } from 'zod';

// ============================================================================
// GET /internal/users/recent
// Returns Discord IDs of users with usage_logs activity in the last N days.
// Used by bot-client at startup to pre-populate the Discord.js DM channel
// cache (Layer 1 of the post-deploy DM-silence fix).
// ============================================================================

/**
 * Discord snowflake IDs are 17–20 digit strings per Discord's ID format spec.
 * Validating the format here catches DB corruption or test-data drift early
 * rather than letting bad IDs propagate to `client.users.fetch()` calls.
 *
 * Exported for reuse by future schemas that need to validate Discord IDs
 * against the same canonical format.
 */
export const DiscordSnowflakeSchema = z.string().regex(/^\d{17,20}$/);

export const RecentUsersResponseSchema = z.object({
  discordIds: z.array(DiscordSnowflakeSchema),
  sinceDays: z.number().int().positive(),
});
export type RecentUsersResponse = z.infer<typeof RecentUsersResponseSchema>;

// ============================================================================
// POST /internal/channel/dm-session/set
// Records active personality in a DM session. Called by bot-client after a
// multi-tag reply selects a personality; the gateway stores it so subsequent
// messages in the DM channel route to the same personality without re-running
// the tag-matching logic.
// ============================================================================

export const DmSessionSetRequestSchema = z.object({
  channelId: z.string(),
  personalitySlug: z.string(),
});
export type DmSessionSetRequest = z.infer<typeof DmSessionSetRequestSchema>;

export const DmSessionSetResponseSchema = z.object({
  channelId: z.string(),
  personalitySlug: z.string(),
});
export type DmSessionSetResponse = z.infer<typeof DmSessionSetResponseSchema>;

// ============================================================================
// GET /internal/conversation/message-personality (reclassified from /user/*)
// Looks up the personality that owns a given Discord message ID. Used by
// bot-client's reply-resolution path to route reply targeting correctly.
//
// Currently mounted at /user/conversation/message-personality but has no
// human-actor auth — it's a service-to-service lookup. The route manifest
// reclassifies it under /internal/* so the audience is explicit.
// ============================================================================

export const MessagePersonalityResponseSchema = z.object({
  personalityId: z.string(),
  // Personality display name is optional — the historical conversation_history
  // row may have only the personality UUID without the display-name denormalized.
  personalityName: z.string().nullable().optional(),
});
export type MessagePersonalityResponse = z.infer<typeof MessagePersonalityResponseSchema>;
