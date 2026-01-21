/**
 * Admin Settings Dashboard
 *
 * Interactive dashboard for managing global bot settings (owner only).
 * Uses button-based UI with modals for value editing.
 *
 * Settings:
 * - Extended Context Default: Enable/Disable/Auto
 * - Max Messages: 1-100
 * - Max Age: Duration or Off
 * - Max Images: 0-20
 *
 * Receives DeferredCommandContext (no deferReply method!)
 * because the parent command uses deferralMode: 'ephemeral'.
 *
 * @see docs/planning/EXTENDED_CONTEXT_IMPROVEMENTS.md
 */

import type {
  ButtonInteraction,
  StringSelectMenuInteraction,
  ModalSubmitInteraction,
} from 'discord.js';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { createLogger, DISCORD_COLORS, type GetAdminSettingsResponse } from '@tzurot/common-types';
import { adminFetch, adminPatchJson } from '../../utils/adminApiClient.js';
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
  EXTENDED_CONTEXT_SETTINGS,
} from '../../utils/dashboard/settings/index.js';

const logger = createLogger('admin-settings');

/**
 * Entity type for custom IDs
 * Uses hyphen separator to avoid conflicts with :: delimiter
 * CommandHandler uses alias mapping to route 'admin-settings' → 'admin'
 */
const ENTITY_TYPE = 'admin-settings';

/**
 * Dashboard configuration for admin settings
 */
const ADMIN_SETTINGS_CONFIG: SettingsDashboardConfig = {
  level: 'global',
  entityType: ENTITY_TYPE,
  titlePrefix: 'Global',
  color: DISCORD_COLORS.BLURPLE,
  settings: EXTENDED_CONTEXT_SETTINGS,
};

/**
 * Handle /admin settings command - shows interactive dashboard
 */
export async function handleSettings(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;

  logger.debug({ userId }, '[Admin Settings] Opening dashboard');

  try {
    // Fetch current settings from API gateway
    const settings = await fetchAdminSettings(userId);

    if (settings === null) {
      await context.editReply({
        content: 'Failed to fetch admin settings.',
      });
      return;
    }

    // Convert API response to dashboard data format
    const data = convertToSettingsData(settings);

    // Create and display the dashboard
    // Pass the underlying interaction since createSettingsDashboard expects ChatInputCommandInteraction
    await createSettingsDashboard(context.interaction, {
      config: ADMIN_SETTINGS_CONFIG,
      data,
      entityId: 'global',
      entityName: 'Global Settings',
      userId,
      updateHandler: handleSettingUpdate,
    });

    logger.info({ userId }, '[Admin Settings] Dashboard opened');
  } catch (error) {
    logger.error({ err: error }, '[Admin Settings] Error opening dashboard');

    // Only respond if we haven't already (createSettingsDashboard may have replied)
    if (!context.interaction.replied) {
      await context.editReply({
        content: 'An error occurred while opening the settings dashboard.',
      });
    }
  }
}

/**
 * Handle select menu interactions for admin settings
 */
export async function handleAdminSettingsSelectMenu(
  interaction: StringSelectMenuInteraction
): Promise<void> {
  if (!isSettingsInteraction(interaction.customId, ENTITY_TYPE)) {
    return;
  }

  await handleSettingsSelectMenu(interaction, ADMIN_SETTINGS_CONFIG, handleSettingUpdate);
}

/**
 * Handle button interactions for admin settings
 */
export async function handleAdminSettingsButton(interaction: ButtonInteraction): Promise<void> {
  if (!isSettingsInteraction(interaction.customId, ENTITY_TYPE)) {
    return;
  }

  await handleSettingsButton(interaction, ADMIN_SETTINGS_CONFIG, handleSettingUpdate);
}

/**
 * Handle modal submissions for admin settings
 */
export async function handleAdminSettingsModal(interaction: ModalSubmitInteraction): Promise<void> {
  if (!isSettingsInteraction(interaction.customId, ENTITY_TYPE)) {
    return;
  }

  await handleSettingsModal(interaction, ADMIN_SETTINGS_CONFIG, handleSettingUpdate);
}

/**
 * Check if a custom ID belongs to admin settings dashboard
 */
export function isAdminSettingsInteraction(customId: string): boolean {
  return isSettingsInteraction(customId, ENTITY_TYPE);
}

/**
 * Fetch AdminSettings from API gateway
 */
async function fetchAdminSettings(userId: string): Promise<GetAdminSettingsResponse | null> {
  const response = await adminFetch('/admin/settings', {
    method: 'GET',
    userId,
  });

  if (!response.ok) {
    return null;
  }

  return (await response.json()) as GetAdminSettingsResponse;
}

/**
 * Convert API response to dashboard SettingsData format
 */
function convertToSettingsData(settings: GetAdminSettingsResponse): SettingsData {
  return {
    enabled: {
      localValue: settings.extendedContextDefault,
      effectiveValue: settings.extendedContextDefault,
      source: 'default',
    },
    maxMessages: {
      localValue: settings.extendedContextMaxMessages,
      effectiveValue: settings.extendedContextMaxMessages,
      source: 'default',
    },
    maxAge: {
      localValue: settings.extendedContextMaxAge,
      effectiveValue: settings.extendedContextMaxAge,
      source: 'default',
    },
    maxImages: {
      localValue: settings.extendedContextMaxImages,
      effectiveValue: settings.extendedContextMaxImages,
      source: 'default',
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
  newValue: unknown
): Promise<SettingUpdateResult> {
  const userId = interaction.user.id;

  logger.debug({ settingId, newValue, userId }, '[Admin Settings] Updating setting');

  try {
    // Map setting ID to API field name
    const updates = mapSettingToApiUpdate(settingId, newValue);

    if (updates === null) {
      return { success: false, error: 'Unknown setting' };
    }

    // Send update to API gateway
    const response = await adminPatchJson('/admin/settings', updates, userId);

    if (!response.ok) {
      const errorText = await response.text();
      logger.warn({ settingId, error: errorText }, '[Admin Settings] Update failed');
      return { success: false, error: errorText };
    }

    // Fetch fresh data and convert to SettingsData
    const newSettings = (await response.json()) as GetAdminSettingsResponse;
    const newData = convertToSettingsData(newSettings);

    logger.info({ settingId, newValue, userId }, '[Admin Settings] Setting updated');

    return { success: true, newData };
  } catch (error) {
    logger.error({ err: error, settingId }, '[Admin Settings] Error updating setting');
    return { success: false, error: 'Failed to update setting' };
  }
}

/**
 * Map dashboard setting ID to API field update
 */
function mapSettingToApiUpdate(settingId: string, value: unknown): Record<string, unknown> | null {
  switch (settingId) {
    case 'enabled':
      // For global settings, null means default (true)
      // So we always store the actual value
      return { extendedContextDefault: value ?? true };

    case 'maxMessages':
      // null means use default (20)
      return { extendedContextMaxMessages: value ?? 20 };

    case 'maxAge': {
      // value can be:
      // - null: use default
      // - -1: "off" (disabled, store as null in DB)
      // - number: seconds
      if (value === null) {
        // Use default (2 hours)
        return { extendedContextMaxAge: 2 * 60 * 60 };
      }
      if (value === -1) {
        // "off" means disabled
        return { extendedContextMaxAge: null };
      }
      return { extendedContextMaxAge: value };
    }

    case 'maxImages':
      // null means use default (0)
      return { extendedContextMaxImages: value ?? 0 };

    default:
      return null;
  }
}
