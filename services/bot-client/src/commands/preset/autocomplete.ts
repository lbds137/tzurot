/**
 * Preset Command Autocomplete Handler
 * Provides autocomplete suggestions for preset and model options
 */

import type { AutocompleteInteraction } from 'discord.js';
import {
  createLogger,
  DISCORD_LIMITS,
  TIMEOUTS,
  TTLCache,
  type LlmConfigSummary,
} from '@tzurot/common-types';
import { callGatewayApi } from '../../utils/userGatewayClient.js';
import { adminFetch } from '../../utils/adminApiClient.js';
import {
  fetchTextModels,
  fetchVisionModels,
  formatModelChoice,
} from '../../utils/modelAutocomplete.js';

const logger = createLogger('preset-autocomplete');

/**
 * Cached global config entry for autocomplete
 */
interface GlobalConfigEntry {
  id: string;
  name: string;
  model: string;
  isGlobal: boolean;
  isDefault: boolean;
  isFreeDefault?: boolean;
}

/**
 * Cache for global configs to avoid API calls on every keystroke
 * Uses TTLCache with single key - global configs change infrequently
 * Lazy-initialized to avoid issues with mocking in tests
 */
let globalConfigCache: TTLCache<GlobalConfigEntry[]> | null = null;

function getGlobalConfigCache(): TTLCache<GlobalConfigEntry[]> {
  globalConfigCache ??= new TTLCache<GlobalConfigEntry[]>({
    ttl: TIMEOUTS.CACHE_TTL, // 60 seconds
    maxSize: 1, // Only one entry needed
  });
  return globalConfigCache;
}

/**
 * Handle autocomplete for /preset commands
 */
export async function handleAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const focusedOption = interaction.options.getFocused(true);
  const userId = interaction.user.id;
  const subcommandGroup = interaction.options.getSubcommandGroup(false);
  const subcommand = interaction.options.getSubcommand(false);

  try {
    if (focusedOption.name === 'preset') {
      await handlePresetAutocomplete(interaction, focusedOption.value, userId);
    } else if (focusedOption.name === 'model') {
      await handleModelAutocomplete(interaction, focusedOption.value);
    } else if (focusedOption.name === 'vision-model') {
      await handleVisionModelAutocomplete(interaction, focusedOption.value);
    } else if (focusedOption.name === 'config' && subcommandGroup === 'global') {
      // Global config autocomplete (for owner-only commands)
      // Note: 'config' option is currently only used in the 'global' subcommand group.
      // If future subcommands also use 'config', this condition will need updating.
      const freeOnly = subcommand === 'set-free-default';
      await handleGlobalConfigAutocomplete(interaction, focusedOption.value, freeOnly);
    } else {
      await interaction.respond([]);
    }
  } catch (error) {
    logger.error(
      {
        err: error,
        option: focusedOption.name,
        query: focusedOption.value,
        userId,
        guildId: interaction.guildId,
        command: interaction.commandName,
        subcommand: interaction.options.getSubcommand(false),
      },
      '[Preset] Autocomplete error'
    );
    await interaction.respond([]);
  }
}

/**
 * Get visibility icon for a preset
 * 🌐 = Global preset, 🔒 = User-owned preset
 */
function getPresetVisibilityIcon(isGlobal: boolean): string {
  return isGlobal ? '🌐' : '🔒';
}

/**
 * Handle preset autocomplete
 *
 * For 'edit': shows all presets (global + owned) with visibility icons
 * For 'delete': shows only user-owned presets
 */
async function handlePresetAutocomplete(
  interaction: AutocompleteInteraction,
  query: string,
  userId: string
): Promise<void> {
  const subcommand = interaction.options.getSubcommand(false);

  const result = await callGatewayApi<{ configs: LlmConfigSummary[] }>('/user/llm-config', {
    userId,
  });

  if (!result.ok) {
    logger.warn({ userId, error: result.error }, '[Preset] Failed to fetch presets');
    await interaction.respond([]);
    return;
  }

  // Determine if we should only show owned presets
  // For delete: only show owned presets
  // For edit/view: show all accessible presets (owned + global)
  const ownedOnly = subcommand === 'delete';

  const queryLower = query.toLowerCase();
  const filtered = result.data.configs
    .filter(c => {
      // Filter by ownership if required
      if (ownedOnly && !c.isOwned) {
        return false;
      }
      // For non-delete commands, show owned + global presets
      if (!ownedOnly && !c.isOwned && !c.isGlobal) {
        return false;
      }
      // Match query
      if (queryLower.length === 0) {
        return true;
      }
      return (
        c.name.toLowerCase().includes(queryLower) ||
        c.model.toLowerCase().includes(queryLower) ||
        (c.description?.toLowerCase().includes(queryLower) ?? false)
      );
    })
    .slice(0, DISCORD_LIMITS.AUTOCOMPLETE_MAX_CHOICES);

  const choices = filtered.map(c => {
    // Add visibility icon for edit command
    const icon = subcommand === 'edit' ? `${getPresetVisibilityIcon(c.isGlobal)} ` : '';
    return {
      // Show visibility icon and model info for clarity
      name: `${icon}${c.name} (${c.model.split('/').pop()})`,
      value: c.id,
    };
  });

  await interaction.respond(choices);
}

/**
 * Handle model autocomplete - fetches text generation models from OpenRouter
 */
async function handleModelAutocomplete(
  interaction: AutocompleteInteraction,
  query: string
): Promise<void> {
  const models = await fetchTextModels(query, DISCORD_LIMITS.AUTOCOMPLETE_MAX_CHOICES);

  const choices = models.map(m => formatModelChoice(m));

  await interaction.respond(choices);
}

/**
 * Handle vision-model autocomplete - fetches vision-capable models from OpenRouter
 */
async function handleVisionModelAutocomplete(
  interaction: AutocompleteInteraction,
  query: string
): Promise<void> {
  const models = await fetchVisionModels(query, DISCORD_LIMITS.AUTOCOMPLETE_MAX_CHOICES);

  const choices = models.map(m => formatModelChoice(m));

  await interaction.respond(choices);
}

/** Cache key for global configs (only one set of configs) */
const GLOBAL_CONFIG_CACHE_KEY = 'global-configs';

/**
 * Fetch global configs from API or cache
 */
async function fetchGlobalConfigs(): Promise<GlobalConfigEntry[] | null> {
  const cache = getGlobalConfigCache();

  // Check cache first
  const cached = cache.get(GLOBAL_CONFIG_CACHE_KEY);
  if (cached !== null) {
    logger.debug('[Preset] Using cached global configs');
    return cached;
  }

  // Cache miss - fetch from API
  const response = await adminFetch('/admin/llm-config');

  if (!response.ok) {
    return null;
  }

  const data = (await response.json()) as { configs: GlobalConfigEntry[] };

  // Store in cache
  cache.set(GLOBAL_CONFIG_CACHE_KEY, data.configs);
  logger.debug(`[Preset] Cached ${data.configs.length} global configs`);

  return data.configs;
}

/**
 * Handle global config autocomplete for /preset global commands (owner only)
 * @param freeOnly - If true, only show free models (those with :free in model name)
 */
async function handleGlobalConfigAutocomplete(
  interaction: AutocompleteInteraction,
  query: string,
  freeOnly = false
): Promise<void> {
  try {
    const configs = await fetchGlobalConfigs();

    if (configs === null) {
      await interaction.respond([]);
      return;
    }

    const queryLower = query.toLowerCase();
    const filtered = configs
      .filter(c => {
        // Must be global
        if (!c.isGlobal) {
          return false;
        }
        // If freeOnly, must have :free in model name
        if (freeOnly && !c.model.includes(':free')) {
          return false;
        }
        // Must match query
        return (
          c.name.toLowerCase().includes(queryLower) || c.model.toLowerCase().includes(queryLower)
        );
      })
      .slice(0, DISCORD_LIMITS.AUTOCOMPLETE_MAX_CHOICES);

    const choices = filtered.map(c => {
      let suffix = '';
      if (c.isDefault === true) {
        suffix += ' [DEFAULT]';
      }
      if (c.isFreeDefault === true) {
        suffix += ' [FREE]';
      }
      return {
        name: `${c.name} (${c.model.split('/').pop()})${suffix}`,
        value: c.id,
      };
    });

    await interaction.respond(choices);
  } catch {
    await interaction.respond([]);
  }
}
