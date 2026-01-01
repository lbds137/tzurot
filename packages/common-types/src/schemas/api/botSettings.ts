/**
 * Zod schemas for /admin/settings API endpoints
 *
 * These schemas define the contract for bot-wide settings.
 * Only bot owners can modify these settings.
 */

import { z } from 'zod';

// ============================================================================
// BotSetting Schema
// ============================================================================

/** Bot setting record */
export const BotSettingSchema = z.object({
  id: z.string().uuid(),
  key: z.string().min(1).max(100),
  value: z.string(),
  description: z.string().nullable(),
  updatedBy: z.string().uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type BotSetting = z.infer<typeof BotSettingSchema>;

// ============================================================================
// GET /admin/settings
// Lists all bot settings
// ============================================================================

export const ListBotSettingsResponseSchema = z.object({
  settings: z.array(BotSettingSchema),
});
export type ListBotSettingsResponse = z.infer<typeof ListBotSettingsResponseSchema>;

// ============================================================================
// GET /admin/settings/:key
// Gets a specific bot setting
// ============================================================================

export const GetBotSettingResponseSchema = z.object({
  found: z.boolean(),
  setting: BotSettingSchema.optional(),
});
export type GetBotSettingResponse = z.infer<typeof GetBotSettingResponseSchema>;

// ============================================================================
// PUT /admin/settings/:key
// Updates or creates a bot setting
// ============================================================================

export const UpdateBotSettingRequestSchema = z.object({
  value: z.string(),
  description: z.string().optional(),
});
export type UpdateBotSettingRequest = z.infer<typeof UpdateBotSettingRequestSchema>;

export const UpdateBotSettingResponseSchema = z.object({
  setting: BotSettingSchema,
  created: z.boolean(), // True if new setting was created
});
export type UpdateBotSettingResponse = z.infer<typeof UpdateBotSettingResponseSchema>;

// ============================================================================
// Known Setting Keys
// ============================================================================

/**
 * Valid bot setting keys.
 * New settings should be added here.
 */
export const BotSettingKeys = {
  /** Default extended context setting for new channels (boolean as string) */
  EXTENDED_CONTEXT_DEFAULT: 'extended_context_default',
} as const;

export type BotSettingKey = (typeof BotSettingKeys)[keyof typeof BotSettingKeys];

/**
 * Parse a boolean setting value.
 * Returns undefined for invalid values.
 */
export function parseBooleanSetting(value: string): boolean | undefined {
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  return undefined;
}
