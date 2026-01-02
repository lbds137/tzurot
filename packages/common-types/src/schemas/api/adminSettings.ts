/**
 * Zod schemas for /admin/settings API endpoints
 *
 * AdminSettings is a SINGLETON model with typed columns.
 * Replaces the legacy key-value BotSettings pattern.
 *
 * @see docs/planning/EXTENDED_CONTEXT_IMPROVEMENTS.md
 */

import { z } from 'zod';

// ============================================================================
// AdminSettings Schema
// ============================================================================

/**
 * AdminSettings singleton record.
 * Contains all bot-wide configuration with proper types.
 */
export const AdminSettingsSchema = z.object({
  id: z.string().uuid(),
  updatedBy: z.string().uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),

  // Extended Context Settings
  extendedContextDefault: z.boolean(),
  extendedContextMaxMessages: z.number().int().min(1).max(100),
  extendedContextMaxAge: z.number().int().min(1).nullable(), // seconds, null = disabled
  extendedContextMaxImages: z.number().int().min(0).max(20),
});
export type AdminSettings = z.infer<typeof AdminSettingsSchema>;

// ============================================================================
// GET /admin/settings
// Returns the singleton AdminSettings object
// ============================================================================

export const GetAdminSettingsResponseSchema = AdminSettingsSchema;
export type GetAdminSettingsResponse = z.infer<typeof GetAdminSettingsResponseSchema>;

// ============================================================================
// PATCH /admin/settings
// Partially update AdminSettings
// ============================================================================

export const UpdateAdminSettingsRequestSchema = z.object({
  extendedContextDefault: z.boolean().optional(),
  extendedContextMaxMessages: z.number().int().min(1).max(100).optional(),
  extendedContextMaxAge: z.number().int().min(1).nullable().optional(),
  extendedContextMaxImages: z.number().int().min(0).max(20).optional(),
});
export type UpdateAdminSettingsRequest = z.infer<typeof UpdateAdminSettingsRequestSchema>;

export const UpdateAdminSettingsResponseSchema = AdminSettingsSchema;
export type UpdateAdminSettingsResponse = z.infer<typeof UpdateAdminSettingsResponseSchema>;

// ============================================================================
// Deterministic UUID for Singleton
// ============================================================================

/**
 * Fixed UUID for the AdminSettings singleton row.
 * Uses v5 UUID namespace for determinism.
 */
export const ADMIN_SETTINGS_SINGLETON_ID = '550e8400-e29b-41d4-a716-446655440001';

// ============================================================================
// Extended Context Settings Resolution Types
// ============================================================================

/**
 * Source of a resolved setting value.
 */
export type SettingSource = 'global' | 'channel' | 'personality';

/**
 * Resolved extended context settings with source tracking.
 * Used by ExtendedContextSettingsResolver.
 */
export const ResolvedExtendedContextSettingsSchema = z.object({
  // Effective values (what actually applies)
  enabled: z.boolean(),
  maxMessages: z.number().int(),
  maxAge: z.number().int().nullable(), // null = disabled
  maxImages: z.number().int(),

  // Sources (where each value came from)
  sources: z.object({
    enabled: z.enum(['global', 'channel', 'personality']),
    maxMessages: z.enum(['global', 'channel', 'personality']),
    maxAge: z.enum(['global', 'channel', 'personality']),
    maxImages: z.enum(['global', 'channel', 'personality']),
  }),
});
export type ResolvedExtendedContextSettings = z.infer<
  typeof ResolvedExtendedContextSettingsSchema
>;

/**
 * Raw settings at a single level (channel or personality).
 * null means "inherit from parent level".
 */
export interface LevelSettings {
  extendedContext: boolean | null;
  extendedContextMaxMessages: number | null;
  extendedContextMaxAge: number | null;
  extendedContextMaxImages: number | null;
}
