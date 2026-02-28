/**
 * Character Settings Dashboard
 *
 * Interactive dashboard for managing per-personality config cascade overrides.
 * Shows effective values from the 4-tier cascade with source indicators.
 *
 * Settings:
 * - Max Messages: 1-100 or Auto
 * - Max Age: Duration, Off, or Auto
 * - Max Images: 0-20 or Auto
 */

import type {
  ButtonInteraction,
  StringSelectMenuInteraction,
  ModalSubmitInteraction,
} from 'discord.js';
import {
  createLogger,
  DISCORD_COLORS,
  type EnvConfig,
  type ResolvedConfigOverrides,
  characterSettingsOptions,
} from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { callGatewayApi } from '../../utils/userGatewayClient.js';
import {
  type SettingsDashboardConfig,
  type SettingsDashboardSession,
  type SettingsData,
  type SettingUpdateResult,
  createSettingsDashboard,
  handleSettingsSelectMenu,
  handleSettingsButton,
  handleSettingsModal,
  isSettingsInteraction,
  parseSettingsCustomId,
  EXTENDED_CONTEXT_SETTINGS,
  MEMORY_SETTINGS,
} from '../../utils/dashboard/settings/index.js';

const logger = createLogger('character-settings');

/** Cascade source indicating a user's per-personality override */
const USER_PERSONALITY_SOURCE = 'user-personality';

/**
 * Entity type for custom IDs
 * Uses hyphen separator to avoid conflicts with :: delimiter
 * CommandHandler uses alias mapping to route 'character-settings' → 'character'
 */
const ENTITY_TYPE = 'character-settings';

/**
 * Dashboard configuration for character settings
 */
const CHARACTER_SETTINGS_CONFIG: SettingsDashboardConfig = {
  level: 'personality',
  entityType: ENTITY_TYPE,
  titlePrefix: 'Character',
  color: DISCORD_COLORS.BLURPLE,
  settings: [...EXTENDED_CONTEXT_SETTINGS, ...MEMORY_SETTINGS],
};

/**
 * Response type for personality API
 */
interface PersonalityResponse {
  personality: {
    id: string;
    name: string;
    slug: string;
    ownerId: string;
  };
}

/**
 * Handle /character settings command - shows interactive dashboard
 */
export async function handleSettings(
  context: DeferredCommandContext,
  _config: EnvConfig
): Promise<void> {
  const options = characterSettingsOptions(context.interaction);
  const characterSlug = options.character();
  const userId = context.user.id;

  logger.debug({ characterSlug, userId }, '[Character Settings] Opening dashboard');

  try {
    // Fetch current character data from API gateway
    const result = await callGatewayApi<PersonalityResponse>(`/user/personality/${characterSlug}`, {
      method: 'GET',
      userId,
    });

    if (!result.ok) {
      if (result.status === 404) {
        await context.editReply({
          content: `Character "${characterSlug}" not found.`,
        });
        return;
      }
      await context.editReply({
        content: `Failed to fetch character: ${result.error}`,
      });
      return;
    }

    const personality = result.data.personality;

    // Resolve cascade overrides for this user+personality
    const cascadeResult = await callGatewayApi<ResolvedConfigOverrides>(
      `/user/config-overrides/resolve/${personality.id}`,
      { method: 'GET', userId }
    );

    if (!cascadeResult.ok) {
      await context.editReply({
        content: 'Failed to fetch config settings.',
      });
      return;
    }

    // Convert resolved cascade to dashboard data format
    const data = convertToSettingsData(cascadeResult.data);

    // Create and display the dashboard
    await createSettingsDashboard(context.interaction, {
      config: CHARACTER_SETTINGS_CONFIG,
      data,
      entityId: `${characterSlug}--${personality.id}`,
      entityName: `${personality.name} (${personality.slug})`,
      userId,
      updateHandler: createUpdateHandler(characterSlug, personality.id),
    });

    logger.info({ characterSlug, userId }, '[Character Settings] Dashboard opened');
  } catch (error) {
    logger.error({ err: error, characterSlug }, '[Character Settings] Error opening dashboard');

    await context.editReply({
      content: 'An error occurred while opening the settings dashboard.',
    });
  }
}

/**
 * Handle select menu interactions for character settings
 */
export async function handleCharacterSettingsSelectMenu(
  interaction: StringSelectMenuInteraction
): Promise<void> {
  if (!isSettingsInteraction(interaction.customId, ENTITY_TYPE)) {
    return;
  }

  const parsed = parseSettingsCustomId(interaction.customId);
  const entityId = parsed?.entityId ?? null;
  if (entityId === null) {
    return;
  }

  const [characterSlug, personalityId] = parseEntityId(entityId);
  if (characterSlug === null) {
    return;
  }

  await handleSettingsSelectMenu(
    interaction,
    CHARACTER_SETTINGS_CONFIG,
    createUpdateHandler(characterSlug, personalityId)
  );
}

/**
 * Handle button interactions for character settings
 */
export async function handleCharacterSettingsButton(interaction: ButtonInteraction): Promise<void> {
  if (!isSettingsInteraction(interaction.customId, ENTITY_TYPE)) {
    return;
  }

  const parsed = parseSettingsCustomId(interaction.customId);
  const entityId = parsed?.entityId ?? null;
  if (entityId === null) {
    return;
  }

  const [characterSlug, personalityId] = parseEntityId(entityId);
  if (characterSlug === null) {
    return;
  }

  await handleSettingsButton(
    interaction,
    CHARACTER_SETTINGS_CONFIG,
    createUpdateHandler(characterSlug, personalityId)
  );
}

/**
 * Handle modal submissions for character settings
 */
export async function handleCharacterSettingsModal(
  interaction: ModalSubmitInteraction
): Promise<void> {
  if (!isSettingsInteraction(interaction.customId, ENTITY_TYPE)) {
    return;
  }

  const parsed = parseSettingsCustomId(interaction.customId);
  const entityId = parsed?.entityId ?? null;
  if (entityId === null) {
    return;
  }

  const [characterSlug, personalityId] = parseEntityId(entityId);
  if (characterSlug === null) {
    return;
  }

  await handleSettingsModal(
    interaction,
    CHARACTER_SETTINGS_CONFIG,
    createUpdateHandler(characterSlug, personalityId)
  );
}

/**
 * Check if a custom ID belongs to character settings dashboard
 */
export function isCharacterSettingsInteraction(customId: string): boolean {
  return isSettingsInteraction(customId, ENTITY_TYPE);
}

/**
 * Parse entityId into [characterSlug, personalityId]
 * Format: "slug--uuid" (uses -- to avoid conflict with :: custom ID delimiter)
 */
function parseEntityId(entityId: string): [string | null, string | null] {
  const idx = entityId.indexOf('--');
  if (idx !== -1) {
    return [entityId.slice(0, idx), entityId.slice(idx + 2)];
  }
  return [entityId, null];
}

/**
 * Map cascade source to dashboard SettingSource
 */
function mapSource(source: string): 'personality' | 'global' | 'channel' | 'default' {
  switch (source) {
    case USER_PERSONALITY_SOURCE:
      // Maps to 'channel' because SettingSource doesn't have a 'user-personality' token.
      // 'channel' displays as "Your override" which is the correct UX label.
      // TODO: Add proper 'user-personality' source type to SettingSource if needed.
      return 'channel';
    case 'user-default':
      return 'global';
    case 'personality':
      return 'personality';
    case 'admin':
      return 'global';
    default:
      return 'default';
  }
}

/**
 * Convert cascade-resolved overrides to dashboard SettingsData format
 */
function convertToSettingsData(resolved: ResolvedConfigOverrides): SettingsData {
  return {
    maxMessages: {
      localValue:
        resolved.sources.maxMessages === USER_PERSONALITY_SOURCE ? resolved.maxMessages : null,
      effectiveValue: resolved.maxMessages,
      source: mapSource(resolved.sources.maxMessages),
    },
    maxAge: {
      localValue: resolved.sources.maxAge === USER_PERSONALITY_SOURCE ? resolved.maxAge : null,
      effectiveValue: resolved.maxAge,
      source: mapSource(resolved.sources.maxAge),
    },
    maxImages: {
      localValue:
        resolved.sources.maxImages === USER_PERSONALITY_SOURCE ? resolved.maxImages : null,
      effectiveValue: resolved.maxImages,
      source: mapSource(resolved.sources.maxImages),
    },
    crossChannelHistoryEnabled: {
      localValue:
        resolved.sources.crossChannelHistoryEnabled === USER_PERSONALITY_SOURCE
          ? resolved.crossChannelHistoryEnabled
          : null,
      effectiveValue: resolved.crossChannelHistoryEnabled,
      source: mapSource(resolved.sources.crossChannelHistoryEnabled),
    },
    shareLtmAcrossPersonalities: {
      localValue:
        resolved.sources.shareLtmAcrossPersonalities === USER_PERSONALITY_SOURCE
          ? resolved.shareLtmAcrossPersonalities
          : null,
      effectiveValue: resolved.shareLtmAcrossPersonalities,
      source: mapSource(resolved.sources.shareLtmAcrossPersonalities),
    },
  };
}

/**
 * Create a settings update handler bound to a specific character+personality.
 * Returns a 4-param handler matching the SettingsUpdateHandler signature.
 */
function createUpdateHandler(characterSlug: string, personalityId: string | null) {
  return (
    interaction: ButtonInteraction | ModalSubmitInteraction,
    _session: SettingsDashboardSession,
    settingId: string,
    newValue: unknown
  ): Promise<SettingUpdateResult> =>
    handleSettingUpdate(interaction, settingId, newValue, characterSlug, personalityId);
}

/**
 * Handle setting updates from the dashboard
 * Writes to user's per-personality config overrides via cascade endpoint
 */
async function handleSettingUpdate(
  interaction: ButtonInteraction | ModalSubmitInteraction,
  settingId: string,
  newValue: unknown,
  characterSlug: string,
  personalityId: string | null
): Promise<SettingUpdateResult> {
  const userId = interaction.user.id;

  if (personalityId === null) {
    return { success: false, error: 'Missing personality ID' };
  }

  logger.debug(
    { settingId, newValue, characterSlug, personalityId, userId },
    '[Character Settings] Updating setting'
  );

  try {
    // Map setting ID to cascade field
    const body = mapSettingToApiUpdate(settingId, newValue);

    if (body === null) {
      return { success: false, error: 'Unknown setting' };
    }

    // Write to per-personality config overrides
    const result = await callGatewayApi(`/user/config-overrides/${personalityId}`, {
      method: 'PATCH',
      body,
      userId,
    });

    if (!result.ok) {
      logger.warn(
        { settingId, error: result.error, characterSlug },
        '[Character Settings] Update failed'
      );
      return { success: false, error: result.error };
    }

    // Re-resolve cascade to get updated effective values
    const cascadeResult = await callGatewayApi<ResolvedConfigOverrides>(
      `/user/config-overrides/resolve/${personalityId}`,
      { method: 'GET', userId }
    );

    if (!cascadeResult.ok) {
      return { success: false, error: 'Failed to fetch updated settings' };
    }

    const newData = convertToSettingsData(cascadeResult.data);

    logger.info(
      { settingId, newValue, characterSlug, userId },
      '[Character Settings] Setting updated'
    );

    return { success: true, newData };
  } catch (error) {
    logger.error(
      { err: error, settingId, characterSlug },
      '[Character Settings] Error updating setting'
    );
    return { success: false, error: 'Failed to update setting' };
  }
}

/**
 * Map dashboard setting ID to cascade config override field.
 *
 * Dashboard values: null = auto (inherit), -1 = off (duration only), number = explicit
 * Cascade API: null body = clear all, field absent = inherit, field null = no limit
 */
function mapSettingToApiUpdate(settingId: string, value: unknown): Record<string, unknown> | null {
  switch (settingId) {
    case 'maxMessages':
      // null means auto (inherit from lower tier)
      return { maxMessages: value };

    case 'maxAge':
      // null = auto (inherit), -1 = "off" (no limit), number = seconds
      // -1 sentinel from framework means "disabled" → null in cascade (no age limit)
      return { maxAge: value === -1 ? null : value };

    case 'maxImages':
      // null means auto (inherit from lower tier)
      return { maxImages: value };

    case 'crossChannelHistoryEnabled':
      return { crossChannelHistoryEnabled: value };

    case 'shareLtmAcrossPersonalities':
      return { shareLtmAcrossPersonalities: value };

    default:
      return null;
  }
}
