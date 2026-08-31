/**
 * Settings Data Builder
 *
 * Shared utility for converting API responses to dashboard SettingsData format.
 * Used by all 4 dashboards (admin, channel, character, user-defaults) to eliminate
 * duplicated inline convertToSettingsData / mapSource functions.
 */

import {
  HARDCODED_CONFIG_DEFAULTS,
  type ConfigOverrides,
  type ConfigOverrideSource,
  type ResolvedConfigOverrides,
} from '@tzurot/common-types/schemas/api/configOverrides';
import type { SettingsData, SettingValue } from './types.js';

/** All ConfigOverrides field names */
const CONFIG_FIELDS = Object.keys(HARDCODED_CONFIG_DEFAULTS) as (keyof ConfigOverrides)[];

/**
 * Build dashboard SettingsData from resolved cascade + local overrides.
 *
 * @param resolved - Fully resolved cascade values with sources (null = no resolve
 *   endpoint available, fall back to hardcoded + local)
 * @param localOverrides - Overrides at this dashboard's tier (null = none set)
 * @param localSource - Which ConfigOverrideSource represents "this tier set it"
 *   (e.g., 'admin' for admin dashboard, 'channel' for channel dashboard)
 */
export function buildCascadeSettingsData(
  resolved: ResolvedConfigOverrides | null,
  localOverrides: Partial<ConfigOverrides> | null,
  localSource: ConfigOverrideSource
): SettingsData {
  function buildValue<T>(field: keyof ConfigOverrides): SettingValue<T> {
    // Presence-aware: `in` check, not `?? null` — a stored null (explicit OFF on
    // null-terminal fields) IS a local override and must not read as "unset".
    const hasLocalOverride = localOverrides !== null && field in localOverrides;
    const localValue = (hasLocalOverride ? localOverrides[field] : null) as T | null;
    const effectiveValue =
      resolved !== null
        ? (resolved[field as keyof ResolvedConfigOverrides] as T)
        : ((localValue ?? HARDCODED_CONFIG_DEFAULTS[field]) as T);
    const source: ConfigOverrideSource =
      resolved !== null ? resolved.sources[field] : hasLocalOverride ? localSource : 'hardcoded';

    // Parent Value = what the field would resolve to if THIS dashboard's tier
    // override were removed. Three cases:
    let parentValue: T;
    if (resolved === null) {
      // No resolve endpoint available (e.g. admin dashboard — admin is the
      // lowest cascade tier, so there is nothing below it to fall back to).
      parentValue = HARDCODED_CONFIG_DEFAULTS[field] as T;
    } else if (source === localSource) {
      // This dashboard's own tier supplied the effective value, so removing
      // it changes the resolution — use the server-computed one-tier-down value.
      parentValue = resolved.parentValues[field] as T;
    } else {
      // A higher tier won, so clearing this tier changes nothing: the
      // resolution is unaffected because a non-winning tier's contribution
      // was never part of it.
      parentValue = effectiveValue;
    }

    return { localValue, hasLocalOverride, effectiveValue, source, parentValue };
  }

  const result = {} as Record<keyof ConfigOverrides, SettingValue<unknown>>;
  for (const field of CONFIG_FIELDS) {
    result[field] = buildValue(field);
  }
  return result;
}

/** Response shape from GET /user/config-overrides/resolve-defaults */
export interface ResolveDefaultsResponse {
  maxMessages: number;
  maxAge: number | null;
  maxImages: number;
  crossChannelHistoryEnabled: boolean;
  shareLtmAcrossPersonalities: boolean;
  memoryScoreThreshold: number;
  memoryLimit: number;
  showModelFooter: boolean;
  voiceResponseMode: 'always' | 'voice-only' | 'never';
  voiceTranscriptionEnabled: boolean;
  shareHistoryAcrossPersonalities: 'always' | 'guilds-only' | 'dms-only' | 'never';
  sources: Record<string, ConfigOverrideSource>;
  parentValues: Required<ConfigOverrides>;
  userOverrides: Record<string, unknown> | null;
}

/**
 * Convert a flat resolve-defaults API response to ResolvedConfigOverrides format.
 * The resolve-defaults endpoint returns config values, sources, and userOverrides
 * as reserved metadata keys in the same flat object.
 */
export function convertResolveDefaultsResponse(response: ResolveDefaultsResponse): {
  resolved: ResolvedConfigOverrides;
  userOverrides: Partial<ConfigOverrides> | null;
} {
  const resolved: ResolvedConfigOverrides = {
    maxMessages: response.maxMessages,
    maxAge: response.maxAge,
    maxImages: response.maxImages,
    crossChannelHistoryEnabled: response.crossChannelHistoryEnabled,
    shareLtmAcrossPersonalities: response.shareLtmAcrossPersonalities,
    memoryScoreThreshold: response.memoryScoreThreshold,
    memoryLimit: response.memoryLimit,
    showModelFooter: response.showModelFooter,
    voiceResponseMode: response.voiceResponseMode,
    voiceTranscriptionEnabled: response.voiceTranscriptionEnabled,
    shareHistoryAcrossPersonalities: response.shareHistoryAcrossPersonalities,
    sources: response.sources,
    parentValues: response.parentValues,
  };
  const userOverrides = response.userOverrides ?? null;
  return { resolved, userOverrides };
}

/**
 * Build fallback SettingsData when API calls fail.
 * Returns all hardcoded defaults with 'hardcoded' source and null localValue.
 */
export function buildFallbackSettingsData(): SettingsData {
  const result = {} as Record<keyof ConfigOverrides, SettingValue<unknown>>;
  for (const field of CONFIG_FIELDS) {
    result[field] = {
      localValue: null,
      hasLocalOverride: false,
      effectiveValue: HARDCODED_CONFIG_DEFAULTS[field],
      source: 'hardcoded',
      parentValue: HARDCODED_CONFIG_DEFAULTS[field],
    };
  }
  return result;
}

/**
 * Build dashboard SettingsData for the NON-CASCADING system-settings bag.
 * The SettingValue shape is display plumbing only: system settings have no
 * inherit tier, so the values render in `statusDisplay: 'plain'` mode (no
 * override/status/parent semantics — those fields are never shown). `parentValue`
 * is set to the same value as `effectiveValue` purely to satisfy the shape;
 * plain-mode rendering never reads it.
 */
export function buildSystemSettingsData(bag: Record<string, unknown>): SettingsData {
  const result: SettingsData = {};
  for (const [key, value] of Object.entries(bag)) {
    result[key] = {
      localValue: value,
      hasLocalOverride: true,
      effectiveValue: value,
      source: 'admin',
      parentValue: value,
    };
  }
  return result;
}
