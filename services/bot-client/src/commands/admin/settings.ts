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
import {
  createLogger,
  DISCORD_COLORS,
  HARDCODED_CONFIG_DEFAULTS,
  type GetAdminSettingsResponse,
} from '@tzurot/common-types';
import { adminFetch, adminPatchJson } from '../../utils/adminApiClient.js';
import {
  type SettingsDashboardConfig,
  type SettingsDashboardSession,
  type SettingsData,
  type SettingUpdateResult,
  type SettingValue,
  createSettingsDashboard,
  handleSettingsSelectMenu,
  handleSettingsButton,
  handleSettingsModal,
  isSettingsInteraction,
  EXTENDED_CONTEXT_SETTINGS,
  MEMORY_SETTINGS,
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
  settings: [...EXTENDED_CONTEXT_SETTINGS, ...MEMORY_SETTINGS],
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

/** Config override field names that map to SettingsData keys */
const SETTING_FIELDS = [
  'maxMessages',
  'maxAge',
  'maxImages',
  'crossChannelHistoryEnabled',
  'shareLtmAcrossPersonalities',
] as const;

/** Build a SettingValue for an admin config field */
function buildAdminSettingValue<T>(
  defaults: Record<string, unknown> | undefined,
  field: string
): SettingValue<T> {
  const localValue = (defaults?.[field] ?? null) as T | null;
  const hardcodedDefault =
    HARDCODED_CONFIG_DEFAULTS[field as keyof typeof HARDCODED_CONFIG_DEFAULTS];
  return {
    localValue,
    effectiveValue: (localValue ?? hardcodedDefault) as T,
    source: defaults?.[field] !== undefined ? 'global' : 'default',
  };
}

/**
 * Convert API response to dashboard SettingsData format.
 * Reads from configDefaults JSONB (config cascade admin tier).
 */
function convertToSettingsData(settings: GetAdminSettingsResponse): SettingsData {
  const defaults = settings.configDefaults as Record<string, unknown> | undefined;

  return {
    maxMessages: buildAdminSettingValue<number>(defaults, 'maxMessages'),
    maxAge: buildAdminSettingValue<number | null>(defaults, 'maxAge'),
    maxImages: buildAdminSettingValue<number>(defaults, 'maxImages'),
    crossChannelHistoryEnabled: buildAdminSettingValue<boolean>(
      defaults,
      'crossChannelHistoryEnabled'
    ),
    shareLtmAcrossPersonalities: buildAdminSettingValue<boolean>(
      defaults,
      'shareLtmAcrossPersonalities'
    ),
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
 * Map dashboard setting ID to API PATCH body.
 * Writes to configDefaults JSONB (config cascade admin tier).
 *
 * The API uses merge semantics — we send only the field being updated.
 * Sending null for a field value removes it from configDefaults.
 */
function mapSettingToApiUpdate(settingId: string, value: unknown): Record<string, unknown> | null {
  // maxAge has special semantics: -1 means "off" (store as null in JSONB)
  if (settingId === 'maxAge') {
    if (value === null) {
      return { configDefaults: { maxAge: undefined } };
    }
    if (value === -1) {
      return { configDefaults: { maxAge: null } };
    }
    return { configDefaults: { maxAge: value } };
  }

  // All other settings: null clears override, otherwise set the value
  if (SETTING_FIELDS.includes(settingId as (typeof SETTING_FIELDS)[number])) {
    return { configDefaults: { [settingId]: value ?? undefined } };
  }

  return null;
}
