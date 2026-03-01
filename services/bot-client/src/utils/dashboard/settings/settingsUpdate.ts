/**
 * Shared Settings Update Utility
 *
 * Maps dashboard setting IDs to API PATCH body format.
 * Used by all three settings dashboards (admin, channel, personality).
 *
 * All tiers use the same body shape: `{ [settingId]: value }` — a flat
 * Partial<ConfigOverrides> object. The API uses merge semantics:
 * sending null for a field clears that override.
 */

/** Config override field names that map to SettingsData keys */
const SETTING_FIELDS = [
  'maxMessages',
  'maxImages',
  'crossChannelHistoryEnabled',
  'shareLtmAcrossPersonalities',
] as const;

/**
 * Map dashboard setting ID to API PATCH body.
 *
 * Returns a flat `Partial<ConfigOverrides>` object suitable for sending
 * directly to any config cascade tier endpoint. Returns null if the
 * setting ID is not recognized.
 *
 * Special cases:
 * - maxAge: -1 means "off" → stored as null (clears override, inherits
 *   hardcoded default of null = no age limit)
 * - null values: mean "auto" → clear override (mergeConfigOverrides strips null keys)
 */
export function mapSettingToApiUpdate(
  settingId: string,
  value: unknown
): Record<string, unknown> | null {
  // maxAge has special semantics: -1 means "off" (store as null in JSONB)
  if (settingId === 'maxAge') {
    if (value === null || value === -1) {
      // "auto" or "off" → send null to clear override
      return { maxAge: null };
    }
    return { maxAge: value };
  }

  // All other settings: null = clear override (auto/inherit), otherwise set the value
  if (SETTING_FIELDS.includes(settingId as (typeof SETTING_FIELDS)[number])) {
    return { [settingId]: value };
  }

  return null;
}
