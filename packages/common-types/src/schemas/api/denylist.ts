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

/** Denial mode: BLOCK (full deny) or MUTE (don't respond but keep in context) */
export const denylistModeSchema = z.enum(['BLOCK', 'MUTE']);
export type DenylistMode = z.infer<typeof denylistModeSchema>;

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
  mode: denylistModeSchema.default('BLOCK'),
  reason: z.string().max(500, 'Reason too long').optional(),
});
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
  mode: denylistModeSchema,
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

/** Response for POST /admin/denylist — newly added (or upserted) entry. */
export const AddDenylistResponseSchema = z.object({
  success: z.literal(true),
  entry: DenylistEntrySchema,
});

/**
 * Response for GET /admin/denylist — full list of entries with count.
 * Optional `?type=USER|GUILD` filter is applied at the handler before
 * the list is returned; the response shape is the same in either case.
 */
export const ListDenylistResponseSchema = z.object({
  success: z.literal(true),
  entries: z.array(DenylistEntrySchema),
  count: z.number().int().nonnegative(),
});

/**
 * Response for DELETE /admin/denylist/:type/:discordId/:scope/:scopeId.
 * `removed: true` is redundant with `success: true` but the handler emits
 * both so the schema matches the wire format exactly.
 */
export const RemoveDenylistResponseSchema = z.object({
  success: z.literal(true),
  removed: z.literal(true),
});
