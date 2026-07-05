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
  'focusModeEnabled',
  'crossChannelHistoryEnabled',
  'shareLtmAcrossPersonalities',
  'memoryScoreThreshold',
  'memoryLimit',
  'showModelFooter',
  'voiceResponseMode',
  'voiceTranscriptionEnabled',
] as const;

/**
 * Map dashboard setting ID to API PATCH body.
 *
 * Returns a flat `Partial<ConfigOverrides>` object suitable for sending
 * directly to any config cascade tier endpoint. Returns null if the
 * setting ID is not recognized.
 *
 * Special cases:
 * - maxAge: -1 (CONFIG_WIRE_OFF) means "off" and is sent AS -1 — the gateway
 *   persists it as stored JSON null, an explicit terminal OFF at this tier
 *   (does NOT fall through to lower tiers)
 * - null values: mean "auto" → clear override (mergeConfigOverrides strips the key)
 */
export function mapSettingToApiUpdate(
  settingId: string,
  value: unknown
): Record<string, unknown> | null {
  // maxAge: "off" (-1) and "auto" (null) are DIFFERENT wire states — collapsing
  // them was the off-vs-inherit bug (off silently meant inherit).
  if (settingId === 'maxAge') {
    if (value === null) {
      return { maxAge: null }; // "auto" → clear override at this tier
    }
    return { maxAge: value }; // seconds, or -1 (CONFIG_WIRE_OFF) → explicit OFF
  }

  // All other settings: null = clear override (auto/inherit), otherwise set the value
  if (SETTING_FIELDS.includes(settingId as (typeof SETTING_FIELDS)[number])) {
    return { [settingId]: value };
  }

  return null;
}
