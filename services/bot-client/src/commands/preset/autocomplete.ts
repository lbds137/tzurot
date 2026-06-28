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
  AUTOCOMPLETE_BADGES,
  formatAutocompleteOption,
  isFreeModel,
  CONFIG_KINDS,
  type LlmConfigSummary,
  type AutocompleteBadge,
  type ConfigKind,
} from '@tzurot/common-types';
import { clientsFor } from '../../utils/gatewayClients.js';
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
    maxSize: CONFIG_KINDS.length, // One entry per kind (text, vision)
  });
  return globalConfigCache;
}

/**
 * Reset the module-level global-config cache. Test-only — lets each test
 * exercise the cold-fetch path without ordering dependencies on prior tests
 * that may have populated the cache.
 */
export function __resetGlobalConfigCacheForTests(): void {
  globalConfigCache = null;
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
      // The 'preset' option appears in both user-scoped subcommands (suggest the
      // user's own + global presets) and the owner-only 'global' group (suggest
      // global presets only). Discriminate by subcommand group, not option name.
      if (subcommandGroup === 'global') {
        const freeOnly = subcommand === 'free-default';
        await handleGlobalConfigAutocomplete(interaction, focusedOption.value, freeOnly);
      } else {
        await handlePresetAutocomplete(interaction, focusedOption.value, userId);
      }
    } else if (focusedOption.name === 'model') {
      await handleModelAutocomplete(interaction, focusedOption.value);
    } else if (focusedOption.name === 'vision-model') {
      await handleVisionModelAutocomplete(interaction, focusedOption.value);
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
      'Autocomplete error'
    );
    await interaction.respond([]);
  }
}

/**
 * Get scope badge for a preset
 * Uses standardized badges from AUTOCOMPLETE_BADGES:
 * - 🌐 GLOBAL = System-provided global preset
 * - 🔒 OWNED = User-created preset
 */
function getPresetScopeBadge(isGlobal: boolean): AutocompleteBadge {
  return isGlobal ? AUTOCOMPLETE_BADGES.GLOBAL : AUTOCOMPLETE_BADGES.OWNED;
}

/**
 * Determine if a preset should appear in autocomplete results
 *
 * Visibility rules:
 * - ownedOnly=true (delete): Only show presets the user created
 * - ownedOnly=false (edit/view): Show owned presets AND global presets
 * - Always filter by query match (name, model, or description)
 *
 * @param config - The preset configuration
 * @param ownedOnly - If true, only show owned presets (for delete command)
 * @param queryLower - Lowercase search query (empty string matches all)
 */
function shouldShowPresetInAutocomplete(
  config: LlmConfigSummary,
  ownedOnly: boolean,
  queryLower: string
): boolean {
  // Filter by edit permission if required (delete command)
  // Uses permissions.canEdit to support admin access
  if (ownedOnly && !config.permissions.canEdit) {
    return false;
  }

  // For non-delete commands, show editable + global presets
  // Filter out presets that user can't edit and aren't global
  if (!ownedOnly && !config.permissions.canEdit && !config.isGlobal) {
    return false;
  }

  // Match query against name, model, or description
  if (queryLower.length === 0) {
    return true;
  }

  return (
    config.name.toLowerCase().includes(queryLower) ||
    config.model.toLowerCase().includes(queryLower) ||
    (config.description?.toLowerCase().includes(queryLower) ?? false)
  );
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
  // Scope the picker to the requested kind (the command's `kind` option,
  // default text) so a vision-setter shows only vision presets. The Discord
  // choice set restricts values to CONFIG_KINDS, so the assertion is sound.
  const kind = (interaction.options.getString('kind', false) ?? 'text') as ConfigKind;

  const { userClient } = clientsFor(interaction);
  const result = await userClient.listUserLlmConfigs({ kind });

  if (!result.ok) {
    logger.warn({ userId, error: result.error }, 'Failed to fetch presets');
    await interaction.respond([]);
    return;
  }

  // For delete: only show owned presets
  // For edit/view: show all accessible presets (owned + global)
  const ownedOnly = subcommand === 'delete';
  const queryLower = query.toLowerCase();

  const filtered = result.data.configs
    .filter(c => shouldShowPresetInAutocomplete(c, ownedOnly, queryLower))
    .slice(0, DISCORD_LIMITS.AUTOCOMPLETE_MAX_CHOICES);

  // Format choices using standardized autocomplete utility
  const choices = filtered.map(c => {
    return formatAutocompleteOption({
      name: c.name,
      value: c.id,
      // Show scope badge for edit command only (global vs owned)
      scopeBadge: subcommand === 'edit' ? getPresetScopeBadge(c.isGlobal) : undefined,
      // Show model short name as metadata
      metadata: c.model.split('/').pop(),
    });
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

/** Per-kind cache key for global configs (text and vision are cached separately). */
function globalConfigCacheKey(kind: string): string {
  return `global-configs:${kind}`;
}

/**
 * Fetch global configs of a given kind from API or cache
 */
async function fetchGlobalConfigs(
  interaction: AutocompleteInteraction,
  kind: ConfigKind
): Promise<GlobalConfigEntry[] | null> {
  const cache = getGlobalConfigCache();
  const cacheKey = globalConfigCacheKey(kind);

  // Check cache first
  const cached = cache.get(cacheKey);
  if (cached !== null) {
    logger.debug({ kind }, 'Using cached global configs');
    return cached;
  }

  // Cache miss - fetch via typed admin client, scoped to the kind
  const { ownerClient } = clientsFor(interaction);
  const result = await ownerClient.listGlobalLlmConfigs({ kind });

  if (!result.ok) {
    return null;
  }

  const configs = result.data.configs as GlobalConfigEntry[];

  cache.set(cacheKey, configs);
  logger.debug({ count: configs.length, kind }, 'Cached global configs');

  return configs;
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
    // Scope to the requested kind (command's `kind` option, default text).
    const kind = (interaction.options.getString('kind', false) ?? 'text') as ConfigKind;
    const configs = await fetchGlobalConfigs(interaction, kind);

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
        // If freeOnly, model must be a free model (ending in :free)
        if (freeOnly && !isFreeModel(c.model)) {
          return false;
        }
        // Must match query
        return (
          c.name.toLowerCase().includes(queryLower) || c.model.toLowerCase().includes(queryLower)
        );
      })
      .slice(0, DISCORD_LIMITS.AUTOCOMPLETE_MAX_CHOICES);

    // Format choices using standardized autocomplete utility with status badges
    const choices = filtered.map(c => {
      // Build status badges array for default/free indicators
      const statusBadges: AutocompleteBadge[] = [];
      if (c.isDefault === true) {
        statusBadges.push(AUTOCOMPLETE_BADGES.DEFAULT);
      }
      if (c.isFreeDefault === true) {
        statusBadges.push(AUTOCOMPLETE_BADGES.FREE);
      }

      return formatAutocompleteOption({
        name: c.name,
        value: c.id,
        scopeBadge: AUTOCOMPLETE_BADGES.GLOBAL,
        statusBadges: statusBadges.length > 0 ? statusBadges : undefined,
        metadata: c.model.split('/').pop(),
      });
    });

    await interaction.respond(choices);
  } catch {
    await interaction.respond([]);
  }
}
