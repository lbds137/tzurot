/**
 * Zod schemas for /admin/denylist API endpoints
 *
 * Validates request bodies and response shapes for denylist management.
 *
 * Entity types:
 * - USER: Deny a specific Discord user
 * - GUILD: Deny an entire Discord server
 *
 * Scopes:
 * - BOT: Bot-wide denial (user/guild cannot interact at all)
 * - GUILD: Guild-specific denial (user denied within a specific server)
 * - CHANNEL: Channel-specific denial (user denied in specific channel)
 * - PERSONALITY: Personality-specific denial (user denied for specific character)
 *
 * Valid combinations:
 * - USER + BOT, GUILD, CHANNEL, or PERSONALITY
 * - GUILD + BOT only (guilds can't be denied per-channel or per-personality)
 */

import { z } from 'zod';

// ============================================================================
// Enums
// ============================================================================

/** Who is being denied */
export const denylistEntityTypeSchema = z.enum(['USER', 'GUILD']);
export type DenylistEntityType = z.infer<typeof denylistEntityTypeSchema>;

/** What level of denial */
export const denylistScopeSchema = z.enum(['BOT', 'GUILD', 'CHANNEL', 'PERSONALITY']);
export type DenylistScope = z.infer<typeof denylistScopeSchema>;

// ============================================================================
// POST /admin/denylist — Add entry
// ============================================================================

/**
 * Input schema for adding a denylist entry.
 * Scope/scopeId validation (valid combinations) is enforced in the service layer.
 */
export const DenylistAddSchema = z.object({
  type: denylistEntityTypeSchema,
  discordId: z.string().min(1, 'discordId is required').max(20, 'discordId too long'),
  scope: denylistScopeSchema.default('BOT'),
  scopeId: z.string().max(40, 'scopeId too long').default('*'),
  reason: z.string().max(500, 'Reason too long').optional(),
});
export type DenylistAddInput = z.infer<typeof DenylistAddSchema>;

// ============================================================================
// Response DTOs
// ============================================================================

/** Single denylist entry response */
export const DenylistEntrySchema = z.object({
  id: z.string().uuid(),
  type: denylistEntityTypeSchema,
  discordId: z.string(),
  scope: denylistScopeSchema,
  scopeId: z.string(),
  reason: z.string().nullable(),
  addedBy: z.string(),
  addedAt: z.coerce.date(),
});
export type DenylistEntry = z.infer<typeof DenylistEntrySchema>;

/** Bulk cache hydration response (used by bot-client on startup) */
export const DenylistCacheResponseSchema = z.object({
  entries: z.array(DenylistEntrySchema),
});
export type DenylistCacheResponse = z.infer<typeof DenylistCacheResponseSchema>;
