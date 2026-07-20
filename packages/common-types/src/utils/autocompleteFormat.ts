/**
 * Autocomplete Formatting Utility
 *
 * Single source of truth for Discord autocomplete option formatting.
 * All autocomplete across the bot should use this utility for consistency.
 *
 * Format: [ScopeBadge][StatusBadges] Name (identifier) · metadata
 *
 * Examples:
 * - "🌐 Global Default · claude-sonnet-4"
 * - "🔒⭐ My Config (my-config) · claude-sonnet-4"
 * - "📖 Public Character (aria)"
 */

/**
 * THE badge registry (design-system spec §2.2) — one glyph, one meaning,
 * everywhere: autocomplete options, browse rows, and footer legends all
 * import from here (legend words + the word-first builder live in
 * `constants/uxVocabulary.ts`). The §2.2 collision rule — no glyph serves
 * both the entity register and the badge register — is pinned by
 * `constants/uxVocabulary.test.ts`.
 *
 * The 🔒 vs 🔐 split: 🔒 private = VISIBILITY (others can't see it);
 * 🔐 locked = PROTECTION (visible but can't be deleted/modified).
 */
export const AUTOCOMPLETE_BADGES = {
  // Scope badges (mutually exclusive - pick one)
  /** System-provided resource, available to all users (same "everyone" concept as PUBLIC) */
  GLOBAL: '🌐',
  /** User-created resource, only visible to owner */
  OWNED: '🔒',
  /** User-created but shared publicly with others (same "everyone" concept as GLOBAL) */
  PUBLIC: '🌐',
  /**
   * Visible but not editable (someone else's public resource).
   * @deprecated Use OWNED_BY_OTHER — 📖 is retiring (it collides with the
   * expand-button glyph) once the adoption sweep migrates the call sites.
   */
  READ_ONLY: '📖',
  /** Owned by another user (visible to you, theirs to edit) */
  OWNED_BY_OTHER: '👥',

  // Status badges (can combine with scope badge)
  /** The one used when you don't choose (fallback selection) */
  DEFAULT: '⭐',
  /** Currently active / in effect (distinct from DEFAULT — an active key vs a fallback preset) */
  ACTIVE: '✅',
  /** Uses free tier model (no API key required) */
  FREE: '🆓',
  /** Admin-locked, cannot be modified */
  LOCKED: '🔐',
  /** Requires your own API key (BYOK) to use */
  NEEDS_KEY: '🔑',
  /** Vision-capable config (the model supports image input — `supportsVision`) */
  VISION: '👁️',
  /** Editable by you (own or co-owned) */
  EDITABLE: '✏️',
  /** A correction row (memory facts) — 📝 keeps it distinct from EDITABLE's ✏️ */
  CORRECTED: '📝',
  /**
   * Shadowed by a real name/slug (alias resolution loses). ⚠️ also serves the
   * renderer's warning-severity register — deliberate: the two never co-occur
   * in one string, and the §2.2 rule scopes to entity-vs-badge only.
   */
  SHADOWED: '⚠️',
} as const;

export type AutocompleteBadge = (typeof AUTOCOMPLETE_BADGES)[keyof typeof AUTOCOMPLETE_BADGES];

/** Configuration for formatting an autocomplete option */
export interface AutocompleteOptionConfig {
  /** Display name (required) */
  name: string;
  /** Value to return on selection (required) - typically an ID or slug */
  value: string;
  /** Primary scope badge - indicates ownership/visibility (optional) */
  scopeBadge?: AutocompleteBadge;
  /** Additional status badges - indicates state like default/free (optional, max 2) */
  statusBadges?: AutocompleteBadge[];
  /** Metadata shown after separator, e.g., model name (optional) */
  metadata?: string;
  /** Identifier shown in parentheses, e.g., slug (optional) */
  identifier?: string;
  /** Max length for the formatted name (default: 100 - Discord's limit) */
  maxLength?: number;
}

/** Standard autocomplete option structure for Discord.js */
interface AutocompleteOption {
  /** Formatted display string shown to user */
  name: string;
  /** Value returned when user selects this option */
  value: string;
}

/** Separator between name and metadata */
const METADATA_SEPARATOR = ' · ';

/** Discord's maximum autocomplete option name length */
const DISCORD_MAX_LENGTH = 100;

/**
 * Format an autocomplete option with consistent badge/metadata layout.
 *
 * The format follows this structure:
 * `[ScopeBadge][StatusBadges] Name (identifier) · metadata`
 *
 * Where:
 * - ScopeBadge: Single emoji indicating ownership/visibility (🌐🔒📖)
 * - StatusBadges: Up to 2 additional status indicators (⭐🆓🔐)
 * - Name: The display name of the resource
 * - identifier: Optional disambiguation string in parentheses
 * - metadata: Optional additional info after separator
 *
 * @example
 * // Global preset with default status
 * formatAutocompleteOption({
 *   name: 'Global Default',
 *   value: 'config-id-123',
 *   scopeBadge: AUTOCOMPLETE_BADGES.GLOBAL,
 *   statusBadges: [AUTOCOMPLETE_BADGES.DEFAULT],
 *   metadata: 'claude-sonnet-4',
 * });
 * // Returns: { name: "🌐⭐ Global Default · claude-sonnet-4", value: "config-id-123" }
 *
 * @example
 * // User's private personality with slug
 * formatAutocompleteOption({
 *   name: 'My Character',
 *   value: 'my-char-slug',
 *   scopeBadge: AUTOCOMPLETE_BADGES.OWNED,
 *   identifier: 'my-char-slug',
 * });
 * // Returns: { name: "🔒 My Character (my-char-slug)", value: "my-char-slug" }
 */
export function formatAutocompleteOption(config: AutocompleteOptionConfig): AutocompleteOption {
  const maxLength = config.maxLength ?? DISCORD_MAX_LENGTH;

  // Build the prefix from badges
  const badgeParts: string[] = [];
  if (config.scopeBadge !== undefined) {
    badgeParts.push(config.scopeBadge);
  }
  if (config.statusBadges !== undefined && config.statusBadges.length > 0) {
    // Limit to 2 status badges to avoid clutter
    badgeParts.push(...config.statusBadges.slice(0, 2));
  }

  // Join badges (no space between badges, space after all badges)
  const prefix = badgeParts.length > 0 ? `${badgeParts.join('')} ` : '';

  // Build the name portion with optional identifier
  let namePortion = config.name;
  if (config.identifier !== undefined && config.identifier.length > 0) {
    namePortion = `${config.name} (${config.identifier})`;
  }

  // Build the suffix with metadata
  const suffix =
    config.metadata !== undefined && config.metadata.length > 0
      ? `${METADATA_SEPARATOR}${config.metadata}`
      : '';

  // Combine all parts
  let formatted = `${prefix}${namePortion}${suffix}`;

  // Truncate if needed (preserve suffix if possible)
  if (formatted.length > maxLength) {
    // Calculate how much space we have for the name
    const fixedLength = prefix.length + suffix.length;
    const availableForName = maxLength - fixedLength - 3; // -3 for "..."

    if (availableForName > 10) {
      // Truncate name portion only
      const truncatedName = namePortion.slice(0, availableForName) + '...';
      formatted = `${prefix}${truncatedName}${suffix}`;
    } else {
      // Not enough space, just hard truncate
      formatted = formatted.slice(0, maxLength - 3) + '...';
    }
  }

  return {
    name: formatted,
    value: config.value,
  };
}

/**
 * Batch format multiple autocomplete options.
 * Convenience wrapper for formatting arrays of options.
 *
 * @param configs Array of option configurations
 * @returns Array of formatted autocomplete options
 */
export function formatAutocompleteOptions(
  configs: AutocompleteOptionConfig[]
): AutocompleteOption[] {
  return configs.map(formatAutocompleteOption);
}
