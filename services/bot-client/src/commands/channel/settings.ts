/**
 * Channel Context Dashboard
 *
 * Interactive dashboard for managing channel-level extended context settings.
 * Supports tri-state (auto/on/off) with inheritance from global defaults.
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
  ChatInputCommandInteraction,
  ButtonInteraction,
  StringSelectMenuInteraction,
  ModalSubmitInteraction,
} from 'discord.js';
import { PermissionFlagsBits } from 'discord.js';
import { createLogger, DISCORD_COLORS } from '@tzurot/common-types';
import { callGatewayApi } from '../../utils/userGatewayClient.js';
import { GatewayClient, invalidateChannelSettingsCache } from '../../utils/GatewayClient.js';
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

const logger = createLogger('channel-context');

/**
 * Entity type for custom IDs
 * Uses hyphen separator to avoid conflicts with :: delimiter
 * CommandHandler uses alias mapping to route 'channel-settings' → 'channel'
 */
const ENTITY_TYPE = 'channel-settings';

/**
 * Dashboard configuration for channel context settings
 */
const CHANNEL_CONTEXT_CONFIG: SettingsDashboardConfig = {
  level: 'channel',
  entityType: ENTITY_TYPE,
  titlePrefix: 'Channel',
  color: DISCORD_COLORS.BLURPLE,
  settings: EXTENDED_CONTEXT_SETTINGS,
};

/**
 * Handle /channel context command - shows interactive dashboard
 */
export async function handleContext(interaction: ChatInputCommandInteraction): Promise<void> {
  const channelId = interaction.channelId;
  const userId = interaction.user.id;

  // Check permissions: Manage Messages required
  if (interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages) !== true) {
    await interaction.editReply({
      content: 'You need the **Manage Messages** permission to manage channel context settings.',
    });
    return;
  }

  logger.debug({ channelId, userId }, '[Channel Context] Opening dashboard');

  try {
    // Fetch current settings from API gateway
    const gatewayClient = new GatewayClient();
    const settings = await gatewayClient.getChannelSettings(channelId);
    const adminSettings = await gatewayClient.getAdminSettings();

    if (adminSettings === null) {
      await interaction.editReply({
        content: 'Failed to fetch global settings.',
      });
      return;
    }

    // Convert to dashboard data format
    const data = convertToSettingsData(settings, adminSettings);

    // Create and display the dashboard
    await createSettingsDashboard(interaction, {
      config: CHANNEL_CONTEXT_CONFIG,
      data,
      entityId: channelId,
      entityName: `<#${channelId}>`,
      userId,
      updateHandler: (buttonInteraction, session, settingId, newValue) =>
        handleSettingUpdate(buttonInteraction, session, settingId, newValue, channelId),
    });

    logger.info({ channelId, userId }, '[Channel Context] Dashboard opened');
  } catch (error) {
    logger.error({ err: error, channelId }, '[Channel Context] Error opening dashboard');

    if (!interaction.replied) {
      await interaction.editReply({
        content: 'An error occurred while opening the context settings dashboard.',
      });
    }
  }
}

/**
 * Handle select menu interactions for channel context
 */
export async function handleChannelContextSelectMenu(
  interaction: StringSelectMenuInteraction
): Promise<void> {
  if (!isSettingsInteraction(interaction.customId, ENTITY_TYPE)) {
    return;
  }

  // Extract channel ID from the custom ID
  const channelId = extractChannelId(interaction.customId);
  if (channelId === null) {
    return;
  }

  await handleSettingsSelectMenu(
    interaction,
    CHANNEL_CONTEXT_CONFIG,
    (buttonInteraction, session, settingId, newValue) =>
      handleSettingUpdate(buttonInteraction, session, settingId, newValue, channelId)
  );
}

/**
 * Handle button interactions for channel context
 */
export async function handleChannelContextButton(interaction: ButtonInteraction): Promise<void> {
  if (!isSettingsInteraction(interaction.customId, ENTITY_TYPE)) {
    return;
  }

  // Extract channel ID from the custom ID
  const channelId = extractChannelId(interaction.customId);
  if (channelId === null) {
    return;
  }

  await handleSettingsButton(
    interaction,
    CHANNEL_CONTEXT_CONFIG,
    (buttonInteraction, session, settingId, newValue) =>
      handleSettingUpdate(buttonInteraction, session, settingId, newValue, channelId)
  );
}

/**
 * Handle modal submissions for channel context
 */
export async function handleChannelContextModal(
  interaction: ModalSubmitInteraction
): Promise<void> {
  if (!isSettingsInteraction(interaction.customId, ENTITY_TYPE)) {
    return;
  }

  // Extract channel ID from the custom ID
  const channelId = extractChannelId(interaction.customId);
  if (channelId === null) {
    return;
  }

  await handleSettingsModal(
    interaction,
    CHANNEL_CONTEXT_CONFIG,
    (buttonInteraction, session, settingId, newValue) =>
      handleSettingUpdate(buttonInteraction, session, settingId, newValue, channelId)
  );
}

/**
 * Check if a custom ID belongs to channel context dashboard
 */
export function isChannelContextInteraction(customId: string): boolean {
  return isSettingsInteraction(customId, ENTITY_TYPE);
}

/**
 * Extract channel ID from custom ID
 * Uses centralized parseSettingsCustomId for consistent parsing
 */
function extractChannelId(customId: string): string | null {
  const parsed = parseSettingsCustomId(customId);
  return parsed?.entityId ?? null;
}

/**
 * Convert API responses to dashboard SettingsData format
 */
function convertToSettingsData(
  channelSettings: { settings?: Record<string, unknown> } | null,
  adminSettings: Record<string, unknown>
): SettingsData {
  const channel = channelSettings?.settings ?? {};

  // Extended Context
  const enabledLocal = channel.extendedContext as boolean | null | undefined;
  const enabledGlobal = adminSettings.extendedContextDefault as boolean;

  // Max Messages
  const maxMessagesLocal = channel.extendedContextMaxMessages as number | null | undefined;
  const maxMessagesGlobal = adminSettings.extendedContextMaxMessages as number;

  // Max Age
  const maxAgeLocal = channel.extendedContextMaxAge as number | null | undefined;
  const maxAgeGlobal = adminSettings.extendedContextMaxAge as number | null;

  // Max Images
  const maxImagesLocal = channel.extendedContextMaxImages as number | null | undefined;
  const maxImagesGlobal = adminSettings.extendedContextMaxImages as number;

  return {
    enabled: {
      localValue: enabledLocal ?? null,
      effectiveValue: enabledLocal ?? enabledGlobal,
      source: enabledLocal !== null && enabledLocal !== undefined ? 'channel' : 'global',
    },
    maxMessages: {
      localValue: maxMessagesLocal ?? null,
      effectiveValue: maxMessagesLocal ?? maxMessagesGlobal,
      source: maxMessagesLocal !== null && maxMessagesLocal !== undefined ? 'channel' : 'global',
    },
    maxAge: {
      localValue: maxAgeLocal ?? null,
      effectiveValue: maxAgeLocal ?? maxAgeGlobal,
      source: maxAgeLocal !== null && maxAgeLocal !== undefined ? 'channel' : 'global',
    },
    maxImages: {
      localValue: maxImagesLocal ?? null,
      effectiveValue: maxImagesLocal ?? maxImagesGlobal,
      source: maxImagesLocal !== null && maxImagesLocal !== undefined ? 'channel' : 'global',
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
  channelId: string
): Promise<SettingUpdateResult> {
  const userId = interaction.user.id;

  logger.debug({ settingId, newValue, channelId, userId }, '[Channel Context] Updating setting');

  try {
    // Map setting ID to API field name
    const body = mapSettingToApiUpdate(settingId, newValue);

    if (body === null) {
      return { success: false, error: 'Unknown setting' };
    }

    // Send update to API gateway
    const result = await callGatewayApi(`/user/channel/${channelId}/extended-context`, {
      method: 'PATCH',
      body,
      userId,
    });

    if (!result.ok) {
      logger.warn({ settingId, error: result.error, channelId }, '[Channel Context] Update failed');
      return { success: false, error: result.error };
    }

    // Invalidate cache
    invalidateChannelSettingsCache(channelId);

    // Fetch fresh data
    const gatewayClient = new GatewayClient();
    const newChannelSettings = await gatewayClient.getChannelSettings(channelId);
    const adminSettings = await gatewayClient.getAdminSettings();

    if (adminSettings === null) {
      return { success: false, error: 'Failed to fetch updated settings' };
    }

    const newData = convertToSettingsData(newChannelSettings, adminSettings);

    logger.info({ settingId, newValue, channelId, userId }, '[Channel Context] Setting updated');

    return { success: true, newData };
  } catch (error) {
    logger.error({ err: error, settingId, channelId }, '[Channel Context] Error updating setting');
    return { success: false, error: 'Failed to update setting' };
  }
}

/**
 * Map dashboard setting ID to API field update
 */
function mapSettingToApiUpdate(settingId: string, value: unknown): Record<string, unknown> | null {
  switch (settingId) {
    case 'enabled':
      // null means auto (inherit from global)
      return { extendedContext: value };

    case 'maxMessages':
      // null means auto (inherit from global)
      return { extendedContextMaxMessages: value };

    case 'maxAge': {
      // value can be:
      // - null: auto (inherit from global)
      // - -1: "off" (disabled)
      // - number: seconds
      if (value === -1) {
        // "off" means disabled - store as special null value
        return { extendedContextMaxAge: null };
      }
      return { extendedContextMaxAge: value };
    }

    case 'maxImages':
      // null means auto (inherit from global)
      return { extendedContextMaxImages: value };

    default:
      return null;
  }
}
