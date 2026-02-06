/**
 * Zod schemas for /admin/settings API endpoints
 *
 * AdminSettings is a SINGLETON model with typed columns.
 * Replaces the legacy key-value BotSettings pattern.
 */

import { z } from 'zod';

// ============================================================================
// AdminSettings Schema
// ============================================================================

/**
 * AdminSettings singleton record.
 * Contains all bot-wide configuration with proper types.
 *
 * Note: extendedContext* columns still exist in DB but are no longer exposed
 * via the API. They will be dropped in a follow-up Prisma migration.
 */
export const AdminSettingsSchema = z.object({
  id: z.string().uuid(),
  updatedBy: z.string().uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
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
// Partially update AdminSettings (currently no updatable fields via this endpoint)
// ============================================================================

export const UpdateAdminSettingsRequestSchema = z.object({});
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
 * - personality: From personality's default LlmConfig
 * - user-personality: From user's per-personality override
 * - user-default: From user's global default LlmConfig
 */
export type SettingSource = 'personality' | 'user-personality' | 'user-default';

const settingSourceEnum = z.enum(['personality', 'user-personality', 'user-default']);

/**
 * Resolved extended context settings with source tracking.
 * Extended context is always enabled — these settings control the limits.
 * Sources indicate where each context limit came from (personality default vs user override).
 */
export const ResolvedExtendedContextSettingsSchema = z.object({
  // Effective values (what actually applies)
  maxMessages: z.number().int(),
  maxAge: z.number().int().nullable(), // null = disabled
  maxImages: z.number().int(),

  // Sources (where each value came from)
  sources: z.object({
    maxMessages: settingSourceEnum,
    maxAge: settingSourceEnum,
    maxImages: settingSourceEnum,
  }),
});
export type ResolvedExtendedContextSettings = z.infer<typeof ResolvedExtendedContextSettingsSchema>;
