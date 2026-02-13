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
 */
export const AdminSettingsSchema = z.object({
  id: z.string().uuid(),
  updatedBy: z.string().uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AdminSettings = z.infer<typeof AdminSettingsSchema>;

/** GET /admin/settings response uses AdminSettingsSchema directly */
export type GetAdminSettingsResponse = AdminSettings;

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
 * - hardcoded: From HARDCODED_CONFIG_DEFAULTS (no tier provided an override)
 * - admin: From AdminSettings.configDefaults
 * - personality: From personality's default LlmConfig or Personality.configDefaults
 * - user-personality: From user's per-personality override
 * - user-default: From user's global default LlmConfig or User.configDefaults
 */
export type SettingSource =
  | 'hardcoded'
  | 'admin'
  | 'personality'
  | 'user-personality'
  | 'user-default';

const settingSourceEnum = z.enum([
  'hardcoded',
  'admin',
  'personality',
  'user-personality',
  'user-default',
]);

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
