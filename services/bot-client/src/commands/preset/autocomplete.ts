/**
 * Preset Command Autocomplete Handler
 * Provides autocomplete suggestions for preset and model options
 */

import type { AutocompleteInteraction } from 'discord.js';
import { isFreeModel } from '@tzurot/common-types/constants/ai';
import { DISCORD_LIMITS } from '@tzurot/common-types/constants/discord';
import { type LlmConfigSummary } from '@tzurot/common-types/schemas/api/llm-config';
import {
  AUTOCOMPLETE_BADGES,
  formatAutocompleteOption,
  type AutocompleteBadge,
} from '@tzurot/common-types/utils/autocompleteFormat';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { TTLCache } from '@tzurot/common-types/utils/TTLCache';
import { shortModelName } from '@tzurot/common-types/utils/modelNames';
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
  supportsVision: boolean;
}

/**
 * TTL for the owner global-config picker cache. Long enough to absorb the
 * per-keystroke autocomplete burst (each cold fetch enriches `supportsVision`
 * per row), short enough that a newly-created global preset appears promptly.
 * Deliberately NOT the shared `TIMEOUTS.CACHE_TTL` (5 min) — that's far too long
 * for an autocomplete freshness window. A zero-staleness pub/sub-invalidation
 * fix is a tracked follow-up; this short TTL is the interim bound.
 */
const GLOBAL_CONFIG_CACHE_TTL_MS = 30 * 1000;

/**
 * Cache for global configs to avoid API calls on every keystroke.
 * Lazy-initialized to avoid issues with mocking in tests.
 */
let globalConfigCache: TTLCache<GlobalConfigEntry[]> | null = null;

function getGlobalConfigCache(): TTLCache<GlobalConfigEntry[]> {
  globalConfigCache ??= new TTLCache<GlobalConfigEntry[]>({
    ttl: GLOBAL_CONFIG_CACHE_TTL_MS,
    maxSize: 1, // Capability-agnostic: the full global set cached under one key.
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
  // Capability-agnostic: fetch ALL presets, 👁-badged by capability below. The
  // slot is chosen on the command option, so the picker stays slot-independent.
  const { userClient } = clientsFor(interaction);
  const result = await userClient.listUserLlmConfigs({ kind: 'all' });

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
      // 👁 for vision-capable models (capability, not config kind)
      statusBadges: c.supportsVision ? [AUTOCOMPLETE_BADGES.VISION] : undefined,
      // Show model short name as metadata
      metadata: shortModelName(c.model),
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

/** Single cache key — the picker is capability-agnostic, so the full global
 *  config set (both slots) is cached under one key, not one entry per kind. */
const GLOBAL_CONFIG_CACHE_KEY = 'global-configs:all';

/**
 * Fetch ALL global configs from the API (or cache), 👁-badged by capability at
 * the call site. Capability-agnostic, mirroring the user picker: the slot is
 * chosen on the command's `slot` option, so the suggestion list stays
 * slot-independent and doesn't reorder when the owner switches slots. The
 * gateway LIST route accepts the `all` sentinel via parseConfigKindQueryAllowAll.
 */
async function fetchGlobalConfigs(
  interaction: AutocompleteInteraction
): Promise<GlobalConfigEntry[] | null> {
  const cache = getGlobalConfigCache();

  const cached = cache.get(GLOBAL_CONFIG_CACHE_KEY);
  if (cached !== null) {
    logger.debug('Using cached global configs');
    return cached;
  }

  const { ownerClient } = clientsFor(interaction);
  const result = await ownerClient.listGlobalLlmConfigs({ kind: 'all' });

  if (!result.ok) {
    return null;
  }

  // `supportsVision` is part of the list-response schema (`LlmConfigSummary`,
  // z.boolean()), so this narrowing cast is safe as long as the admin global-list
  // route stays consistent with it. If a row ever lacked the field, the 👁 badge
  // would silently not render (falsy) — a safe degradation, not a crash.
  const configs = result.data.configs as GlobalConfigEntry[];

  cache.set(GLOBAL_CONFIG_CACHE_KEY, configs);
  logger.debug({ count: configs.length }, 'Cached global configs');

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
    // Capability-agnostic: fetch ALL global presets, 👁-badged by capability
    // below. The slot is chosen on the command's `slot` option, so the picker
    // stays slot-independent (no reorder when the owner switches slots).
    const configs = await fetchGlobalConfigs(interaction);

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
        // If freeOnly, model must be a free model (a :free-suffixed model or the openrouter/free router)
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
      if (c.supportsVision) {
        statusBadges.push(AUTOCOMPLETE_BADGES.VISION);
      }

      return formatAutocompleteOption({
        name: c.name,
        value: c.id,
        scopeBadge: AUTOCOMPLETE_BADGES.GLOBAL,
        statusBadges: statusBadges.length > 0 ? statusBadges : undefined,
        metadata: shortModelName(c.model),
      });
    });

    await interaction.respond(choices);
  } catch {
    await interaction.respond([]);
  }
}
