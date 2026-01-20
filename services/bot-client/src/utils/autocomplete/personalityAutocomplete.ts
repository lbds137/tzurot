/**
 * Shared Personality Autocomplete Utility
 *
 * Provides consistent autocomplete for personality (AI character) selection
 * across all commands. Uses the gateway API for data access.
 *
 * Visibility indicators:
 * - 🌐 = Public and owned by user
 * - 🔒 = Private and owned by user
 * - 📖 = Public but not owned (read-only)
 */

import type { AutocompleteInteraction } from 'discord.js';
import { createLogger, DISCORD_LIMITS } from '@tzurot/common-types';
import { getCachedPersonalities } from './autocompleteCache.js';

const logger = createLogger('personality-autocomplete');

/**
 * Options for personality autocomplete behavior
 */
export interface PersonalityAutocompleteOptions {
  /** Filter to only owned personalities (for edit/delete operations) */
  ownedOnly?: boolean;
  /** Include visibility indicators (🌐/🔒/📖) in display names */
  showVisibility?: boolean;
  /** Option name to match (defaults to 'personality' or 'character') */
  optionName?: string | string[];
  /** Which field to return as the value (defaults to 'slug') */
  valueField?: 'slug' | 'id';
}

/**
 * Default options for personality autocomplete
 */
const DEFAULT_OPTIONS: Required<PersonalityAutocompleteOptions> = {
  ownedOnly: false,
  showVisibility: true,
  optionName: ['personality', 'character'],
  valueField: 'slug',
};

/**
 * Handle personality autocomplete for any command
 *
 * Uses the gateway API to fetch accessible personalities (public + owned)
 * and filters based on user query and options.
 *
 * @param interaction - Discord autocomplete interaction
 * @param options - Autocomplete behavior options
 * @returns Whether the autocomplete was handled (matched the option name)
 */
export async function handlePersonalityAutocomplete(
  interaction: AutocompleteInteraction,
  options: PersonalityAutocompleteOptions = {}
): Promise<boolean> {
  const mergedOptions = { ...DEFAULT_OPTIONS, ...options };
  const focusedOption = interaction.options.getFocused(true);
  const userId = interaction.user.id;

  // Check if this option should be handled
  const optionNames = Array.isArray(mergedOptions.optionName)
    ? mergedOptions.optionName
    : [mergedOptions.optionName];

  if (!optionNames.includes(focusedOption.name)) {
    return false;
  }

  try {
    // Use cached data to avoid HTTP requests on every keystroke
    const personalities = await getCachedPersonalities(userId);

    if (personalities.length === 0) {
      await interaction.respond([]);
      return true;
    }

    const query = focusedOption.value.toLowerCase();

    // Filter personalities based on options and query
    const filtered = personalities
      .filter(p => {
        // Filter by edit permission if required (for edit/delete/avatar commands)
        // Uses permissions.canEdit instead of isOwned to support admin access
        if (mergedOptions.ownedOnly && !p.permissions.canEdit) {
          return false;
        }

        // Match query against name, displayName, and slug
        if (query.length === 0) {
          return true;
        }
        return (
          p.name.toLowerCase().includes(query) ||
          p.slug.toLowerCase().includes(query) ||
          (p.displayName?.toLowerCase().includes(query) ?? false)
        );
      })
      .slice(0, DISCORD_LIMITS.AUTOCOMPLETE_MAX_CHOICES);

    // Format choices
    // Explicitly check for null/undefined/empty string (displayName could be '')
    const choices = filtered.map(p => {
      const displayName =
        p.displayName !== null && p.displayName !== undefined && p.displayName !== ''
          ? p.displayName
          : p.name;

      // Build label: [visibility] DisplayName (slug)
      let label = displayName;
      if (mergedOptions.showVisibility) {
        // Visibility icons based on permissions (not just ownership):
        // 🔒 = Private, can edit (owned OR admin)
        // 🌐 = Public, can edit (owned OR admin)
        // 📖 = Public, read-only (not owned, not admin)
        const canEdit = p.permissions.canEdit;
        const visibility = canEdit ? (p.isPublic ? '🌐' : '🔒') : '📖';
        label = `${visibility} ${displayName}`;
      }
      // Always append slug in parentheses for disambiguation
      label = `${label} (${p.slug})`;

      return {
        name: label,
        value: mergedOptions.valueField === 'id' ? p.id : p.slug,
      };
    });

    await interaction.respond(choices);
    return true;
  } catch (error) {
    logger.error(
      {
        err: error,
        option: focusedOption.name,
        query: focusedOption.value,
        userId,
        guildId: interaction.guildId,
      },
      '[Personality] Autocomplete error'
    );
    await interaction.respond([]);
    return true;
  }
}

/**
 * Get visibility icon for a personality
 *
 * @param canEdit - Whether the user can edit this personality (from permissions.canEdit)
 * @param isPublic - Whether the personality is public
 * @returns Emoji indicator
 */
export function getVisibilityIcon(canEdit: boolean, isPublic: boolean): string {
  if (canEdit) {
    return isPublic ? '🌐' : '🔒';
  }
  return '📖';
}
