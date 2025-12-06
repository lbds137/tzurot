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
import { createLogger, DISCORD_LIMITS, type PersonalitySummary } from '@tzurot/common-types';
import { callGatewayApi } from '../userGatewayClient.js';

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
}

/**
 * Default options for personality autocomplete
 */
const DEFAULT_OPTIONS: Required<PersonalityAutocompleteOptions> = {
  ownedOnly: false,
  showVisibility: true,
  optionName: ['personality', 'character'],
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
    const result = await callGatewayApi<{ personalities: PersonalitySummary[] }>(
      '/user/personality',
      { userId }
    );

    if (!result.ok) {
      logger.warn(
        { userId, error: result.error },
        '[Personality] Failed to fetch personalities for autocomplete'
      );
      await interaction.respond([]);
      return true;
    }

    const query = focusedOption.value.toLowerCase();

    // Filter personalities based on options and query
    const filtered = result.data.personalities
      .filter(p => {
        // Filter by ownership if required
        if (mergedOptions.ownedOnly && !p.isOwned) {
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
    const choices = filtered.map(p => {
      const displayName = p.displayName ?? p.name;

      // Add visibility indicator if enabled
      let label = displayName;
      if (mergedOptions.showVisibility) {
        // 🌐 = Public and owned, 🔒 = Private and owned, 📖 = Public not owned
        const visibility = p.isOwned ? (p.isPublic ? '🌐' : '🔒') : '📖';
        label = `${visibility} ${displayName}`;
      }

      return {
        name: label,
        value: p.slug,
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
 * @param isOwned - Whether the user owns this personality
 * @param isPublic - Whether the personality is public
 * @returns Emoji indicator
 */
export function getVisibilityIcon(isOwned: boolean, isPublic: boolean): string {
  if (isOwned) {
    return isPublic ? '🌐' : '🔒';
  }
  return '📖';
}
