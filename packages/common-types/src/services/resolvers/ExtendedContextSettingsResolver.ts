/**
 * ExtendedContextSettingsResolver - 3-layer cascading resolution for extended context settings
 *
 * ## Resolution Hierarchy
 *
 * 1. **Channel Settings** (highest priority for admin intent)
 *    - Admin can disable extended context for a channel
 *    - Admin can set caps on message limits
 *
 * 2. **Personality Settings**
 *    - Personality can opt-out even in enabled channels
 *    - Personality limits are bounded by channel caps
 *
 * 3. **Global Settings** (lowest priority)
 *    - System-wide defaults from AdminSettings singleton
 *
 * ## Boolean Resolution
 *
 * Channel admin intent takes precedence:
 * - Channel OFF beats everything (privacy/cost control)
 * - Channel ON: personality can still opt-out
 * - Channel AUTO: personality preference, then global default
 *
 * ## Numeric Resolution
 *
 * Most restrictive wins (cost safety):
 * - If channel sets a cap, personality can go lower but not higher
 * - Hard caps enforced to prevent abuse
 *
 * @see docs/planning/EXTENDED_CONTEXT_IMPROVEMENTS.md
 * @see docs/standards/TRI_STATE_PATTERN.md
 */

import { createLogger } from '../../utils/logger.js';
import type {
  ResolvedExtendedContextSettings,
  LevelSettings,
  SettingSource,
} from '../../schemas/api/adminSettings.js';

const logger = createLogger('ExtendedContextSettingsResolver');

/**
 * Hard limits enforced regardless of configuration
 */
export const EXTENDED_CONTEXT_LIMITS = {
  /** Discord API single-fetch limit */
  MAX_MESSAGES_HARD_CAP: 100,
  /** Maximum images to process (cost protection) */
  MAX_IMAGES_HARD_CAP: 20,
} as const;

/**
 * Global-level settings (from AdminSettings singleton)
 * All fields are required at this level (no null = no inheritance possible)
 */
export interface GlobalSettings {
  extendedContextDefault: boolean;
  extendedContextMaxMessages: number;
  extendedContextMaxAge: number | null; // null = disabled (no age limit)
  extendedContextMaxImages: number;
}

/**
 * Resolve extended context enabled state
 *
 * Channel admin intent takes precedence:
 * - Channel OFF beats everything (server admin decision)
 * - Channel ON: personality can still opt-out
 * - Both AUTO: personality preference, then global default
 */
export function resolveExtendedContextEnabled(
  channel: boolean | null,
  personality: boolean | null,
  globalDefault: boolean
): { value: boolean; source: SettingSource } {
  // Channel explicit OFF is definitive (server admin intent)
  if (channel === false) {
    return { value: false, source: 'channel' };
  }

  // Channel explicit ON is definitive
  if (channel === true) {
    // But personality can still opt-out
    if (personality === false) {
      return { value: false, source: 'personality' };
    }
    return { value: true, source: 'channel' };
  }

  // Channel is AUTO - personality can decide
  if (personality !== null) {
    return { value: personality, source: 'personality' };
  }

  // Both are AUTO - follow global default
  return { value: globalDefault, source: 'global' };
}

/**
 * Resolve numeric limit with "most restrictive wins" logic
 *
 * - If channel sets a cap, personality can go lower but not higher
 * - Hard cap always enforced
 */
export function resolveNumericLimit(
  channel: number | null,
  personality: number | null,
  globalDefault: number,
  hardCap: number
): { value: number; source: SettingSource } {
  // Start with global default
  let limit = globalDefault;
  let source: SettingSource = 'global';

  // Channel can override (either direction)
  if (channel !== null) {
    limit = channel;
    source = 'channel';
  }

  // Personality can adjust within channel bounds
  if (personality !== null) {
    // If channel set a cap, personality can go lower but not higher
    if (channel !== null) {
      if (personality < channel) {
        limit = personality;
        source = 'personality';
      }
      // else: personality wants higher than channel cap, ignore
    } else {
      // No channel cap, personality can set any value
      limit = personality;
      source = 'personality';
    }
  }

  // Enforce hard cap
  return { value: Math.min(limit, hardCap), source };
}

/**
 * Resolve max age setting
 *
 * Similar to numeric limits but null means "disabled" at global level
 * and "inherit" at channel/personality levels.
 */
export function resolveMaxAge(
  channel: number | null,
  personality: number | null,
  globalDefault: number | null
): { value: number | null; source: SettingSource } {
  // If global says null (disabled), that's the baseline
  if (globalDefault === null) {
    // Channel can enable with a specific value
    if (channel !== null) {
      // Personality can be more restrictive (lower age)
      if (personality !== null && personality < channel) {
        return { value: personality, source: 'personality' };
      }
      return { value: channel, source: 'channel' };
    }

    // Personality can enable on its own
    if (personality !== null) {
      return { value: personality, source: 'personality' };
    }

    // Stay disabled
    return { value: null, source: 'global' };
  }

  // Global has a value - same logic as other numeric limits
  let limit = globalDefault;
  let source: SettingSource = 'global';

  if (channel !== null) {
    limit = channel;
    source = 'channel';
  }

  if (personality !== null) {
    if (channel !== null) {
      // Most restrictive wins (lower age = more restrictive)
      if (personality < channel) {
        limit = personality;
        source = 'personality';
      }
    } else {
      limit = personality;
      source = 'personality';
    }
  }

  return { value: limit, source };
}

/**
 * Resolve all extended context settings from the 3-layer hierarchy
 *
 * @param global - Global settings from AdminSettings (required)
 * @param channel - Channel-level overrides (optional, null = use parent)
 * @param personality - Personality-level preferences (optional, null = use parent)
 * @returns Fully resolved settings with source tracking
 */
export function resolveExtendedContextSettings(
  global: GlobalSettings,
  channel?: LevelSettings | null,
  personality?: LevelSettings | null
): ResolvedExtendedContextSettings {
  const channelSettings = channel ?? {
    extendedContext: null,
    extendedContextMaxMessages: null,
    extendedContextMaxAge: null,
    extendedContextMaxImages: null,
  };

  const personalitySettings = personality ?? {
    extendedContext: null,
    extendedContextMaxMessages: null,
    extendedContextMaxAge: null,
    extendedContextMaxImages: null,
  };

  // Resolve each setting
  const enabled = resolveExtendedContextEnabled(
    channelSettings.extendedContext,
    personalitySettings.extendedContext,
    global.extendedContextDefault
  );

  const maxMessages = resolveNumericLimit(
    channelSettings.extendedContextMaxMessages,
    personalitySettings.extendedContextMaxMessages,
    global.extendedContextMaxMessages,
    EXTENDED_CONTEXT_LIMITS.MAX_MESSAGES_HARD_CAP
  );

  const maxAge = resolveMaxAge(
    channelSettings.extendedContextMaxAge,
    personalitySettings.extendedContextMaxAge,
    global.extendedContextMaxAge
  );

  const maxImages = resolveNumericLimit(
    channelSettings.extendedContextMaxImages,
    personalitySettings.extendedContextMaxImages,
    global.extendedContextMaxImages,
    EXTENDED_CONTEXT_LIMITS.MAX_IMAGES_HARD_CAP
  );

  const result: ResolvedExtendedContextSettings = {
    enabled: enabled.value,
    maxMessages: maxMessages.value,
    maxAge: maxAge.value,
    maxImages: maxImages.value,
    sources: {
      enabled: enabled.source,
      maxMessages: maxMessages.source,
      maxAge: maxAge.source,
      maxImages: maxImages.source,
    },
  };

  logger.debug({ result }, 'Resolved extended context settings');

  return result;
}

/**
 * Helper to convert database row to LevelSettings
 */
export function toLevelSettings(row: {
  extendedContext?: boolean | null;
  extendedContextMaxMessages?: number | null;
  extendedContextMaxAge?: number | null;
  extendedContextMaxImages?: number | null;
}): LevelSettings {
  return {
    extendedContext: row.extendedContext ?? null,
    extendedContextMaxMessages: row.extendedContextMaxMessages ?? null,
    extendedContextMaxAge: row.extendedContextMaxAge ?? null,
    extendedContextMaxImages: row.extendedContextMaxImages ?? null,
  };
}

/**
 * Helper to convert AdminSettings row to GlobalSettings
 */
export function toGlobalSettings(row: {
  extendedContextDefault: boolean;
  extendedContextMaxMessages: number;
  extendedContextMaxAge: number | null;
  extendedContextMaxImages: number;
}): GlobalSettings {
  return {
    extendedContextDefault: row.extendedContextDefault,
    extendedContextMaxMessages: row.extendedContextMaxMessages,
    extendedContextMaxAge: row.extendedContextMaxAge,
    extendedContextMaxImages: row.extendedContextMaxImages,
  };
}
