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
 */
const DiscordSnowflakeSchema = z.string().regex(/^\d{17,20}$/);

export const RecentUsersResponseSchema = z.object({
  discordIds: z.array(DiscordSnowflakeSchema),
  sinceDays: z.number().int().positive(),
});
export type RecentUsersResponse = z.infer<typeof RecentUsersResponseSchema>;
