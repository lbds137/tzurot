/**
 * Character Settings Dashboard
 *
 * Interactive dashboard for managing character-level extended context settings.
 * Supports tri-state (auto/on/off) with inheritance from channel/global defaults.
 *
 * Settings:
 * - Extended Context: Auto/Enable/Disable
 * - Max Messages: 1-100 or Auto
 * - Max Age: Duration, Off, or Auto
 * - Max Images: 0-20 or Auto
 *
 * @see docs/standards/TRI_STATE_PATTERN.md
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
  characterSettingsOptions,
} from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { callGatewayApi } from '../../utils/userGatewayClient.js';
import { GatewayClient } from '../../utils/GatewayClient.js';
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
} from '../../utils/dashboard/settings/index.js';

const logger = createLogger('character-settings');

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
  settings: EXTENDED_CONTEXT_SETTINGS,
};

/**
 * Response type for personality API
 */
interface PersonalityResponse {
  personality: {
    id: string;
    name: string;
    slug: string;
    extendedContext: boolean | null;
    extendedContextMaxMessages: number | null;
    extendedContextMaxAge: number | null;
    extendedContextMaxImages: number | null;
    ownerId: string | null;
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

    // Get admin settings for global defaults
    const gatewayClient = new GatewayClient();
    const adminSettings = await gatewayClient.getAdminSettings();

    if (adminSettings === null) {
      await context.editReply({
        content: 'Failed to fetch global settings.',
      });
      return;
    }

    // Convert to dashboard data format
    const data = convertToSettingsData(personality, adminSettings);

    // Create and display the dashboard
    // NOTE: createSettingsDashboard expects raw interaction for ongoing component updates
    await createSettingsDashboard(context.interaction, {
      config: CHARACTER_SETTINGS_CONFIG,
      data,
      entityId: characterSlug,
      entityName: `${personality.name} (${personality.slug})`,
      userId,
      updateHandler: (buttonInteraction, session, settingId, newValue) =>
        handleSettingUpdate(buttonInteraction, session, settingId, newValue, characterSlug),
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

  // Extract character slug from the custom ID
  const characterSlug = extractCharacterSlug(interaction.customId);
  if (characterSlug === null) {
    return;
  }

  await handleSettingsSelectMenu(
    interaction,
    CHARACTER_SETTINGS_CONFIG,
    (buttonInteraction, session, settingId, newValue) =>
      handleSettingUpdate(buttonInteraction, session, settingId, newValue, characterSlug)
  );
}

/**
 * Handle button interactions for character settings
 */
export async function handleCharacterSettingsButton(interaction: ButtonInteraction): Promise<void> {
  if (!isSettingsInteraction(interaction.customId, ENTITY_TYPE)) {
    return;
  }

  // Extract character slug from the custom ID
  const characterSlug = extractCharacterSlug(interaction.customId);
  if (characterSlug === null) {
    return;
  }

  await handleSettingsButton(
    interaction,
    CHARACTER_SETTINGS_CONFIG,
    (buttonInteraction, session, settingId, newValue) =>
      handleSettingUpdate(buttonInteraction, session, settingId, newValue, characterSlug)
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

  // Extract character slug from the custom ID
  const characterSlug = extractCharacterSlug(interaction.customId);
  if (characterSlug === null) {
    return;
  }

  await handleSettingsModal(
    interaction,
    CHARACTER_SETTINGS_CONFIG,
    (buttonInteraction, session, settingId, newValue) =>
      handleSettingUpdate(buttonInteraction, session, settingId, newValue, characterSlug)
  );
}

/**
 * Check if a custom ID belongs to character settings dashboard
 */
export function isCharacterSettingsInteraction(customId: string): boolean {
  return isSettingsInteraction(customId, ENTITY_TYPE);
}

/**
 * Extract character slug from custom ID
 * Uses centralized parseSettingsCustomId for consistent parsing
 */
function extractCharacterSlug(customId: string): string | null {
  const parsed = parseSettingsCustomId(customId);
  return parsed?.entityId ?? null;
}

/**
 * Convert API response to dashboard SettingsData format
 */
function convertToSettingsData(
  personality: PersonalityResponse['personality'],
  adminSettings: Record<string, unknown>
): SettingsData {
  // Extended Context
  const enabledLocal = personality.extendedContext;
  const enabledGlobal = adminSettings.extendedContextDefault as boolean;

  // Max Messages
  const maxMessagesLocal = personality.extendedContextMaxMessages;
  const maxMessagesGlobal = adminSettings.extendedContextMaxMessages as number;

  // Max Age
  const maxAgeLocal = personality.extendedContextMaxAge;
  const maxAgeGlobal = adminSettings.extendedContextMaxAge as number | null;

  // Max Images
  const maxImagesLocal = personality.extendedContextMaxImages;
  const maxImagesGlobal = adminSettings.extendedContextMaxImages as number;

  return {
    enabled: {
      localValue: enabledLocal,
      effectiveValue: enabledLocal ?? enabledGlobal,
      source: enabledLocal !== null ? 'personality' : 'global',
    },
    maxMessages: {
      localValue: maxMessagesLocal,
      effectiveValue: maxMessagesLocal ?? maxMessagesGlobal,
      source: maxMessagesLocal !== null ? 'personality' : 'global',
    },
    maxAge: {
      localValue: maxAgeLocal,
      effectiveValue: maxAgeLocal ?? maxAgeGlobal,
      source: maxAgeLocal !== null ? 'personality' : 'global',
    },
    maxImages: {
      localValue: maxImagesLocal,
      effectiveValue: maxImagesLocal ?? maxImagesGlobal,
      source: maxImagesLocal !== null ? 'personality' : 'global',
    },
  };
}

/**
 * Handle setting updates from the dashboard
 */
async function handleSettingUpdate(
  interaction: ButtonInteraction | ModalSubmitInteraction,
  _session: SettingsDashboardSession,
  settingId: string,
  newValue: unknown,
  characterSlug: string
): Promise<SettingUpdateResult> {
  const userId = interaction.user.id;

  logger.debug(
    { settingId, newValue, characterSlug, userId },
    '[Character Settings] Updating setting'
  );

  try {
    // Map setting ID to API field name
    const body = mapSettingToApiUpdate(settingId, newValue);

    if (body === null) {
      return { success: false, error: 'Unknown setting' };
    }

    // Send update to API gateway
    const result = await callGatewayApi(`/user/personality/${characterSlug}`, {
      method: 'PUT',
      body,
      userId,
    });

    if (!result.ok) {
      if (result.status === 401) {
        return { success: false, error: 'You do not have permission to edit this character.' };
      }
      if (result.status === 404) {
        return { success: false, error: `Character "${characterSlug}" not found.` };
      }
      logger.warn(
        { settingId, error: result.error, characterSlug },
        '[Character Settings] Update failed'
      );
      return { success: false, error: result.error };
    }

    // Fetch fresh data
    const refreshResult = await callGatewayApi<PersonalityResponse>(
      `/user/personality/${characterSlug}`,
      {
        method: 'GET',
        userId,
      }
    );

    if (!refreshResult.ok) {
      return { success: false, error: 'Failed to fetch updated settings' };
    }

    const gatewayClient = new GatewayClient();
    const adminSettings = await gatewayClient.getAdminSettings();

    if (adminSettings === null) {
      return { success: false, error: 'Failed to fetch global settings' };
    }

    const newData = convertToSettingsData(refreshResult.data.personality, adminSettings);

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
 * Map dashboard setting ID to API field update
 */
function mapSettingToApiUpdate(settingId: string, value: unknown): Record<string, unknown> | null {
  switch (settingId) {
    case 'enabled':
      // null means auto (inherit from channel/global)
      return { extendedContext: value };

    case 'maxMessages':
      // null means auto (inherit from channel/global)
      return { extendedContextMaxMessages: value };

    case 'maxAge': {
      // value can be:
      // - null: auto (inherit from channel/global)
      // - -1: "off" (disabled)
      // - number: seconds
      if (value === -1) {
        // "off" means disabled - but for personality, null means auto
        // We need to differentiate - store 0 as "off"?
        // Actually, looking at the Duration class, null in DB means "off/disabled"
        // So -1 should map to a specific "off" value
        return { extendedContextMaxAge: null };
      }
      return { extendedContextMaxAge: value };
    }

    case 'maxImages':
      // null means auto (inherit from channel/global)
      return { extendedContextMaxImages: value };

    default:
      return null;
  }
}
