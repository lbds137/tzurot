/**
 * User Default Settings Dashboard
 *
 * Interactive dashboard for managing user-default config cascade overrides.
 * The user-default tier sits between channel and user-personality in the cascade:
 *   hardcoded → admin → personality → channel → USER-DEFAULT → user-personality
 *
 * Any user can set their global defaults here. These apply across all
 * personalities unless overridden by per-personality settings.
 *
 * This handler receives DeferredCommandContext (no deferReply method!)
 * because the parent command uses deferralMode: 'ephemeral'.
 */

import type {
  ButtonInteraction,
  StringSelectMenuInteraction,
  ModalSubmitInteraction,
} from 'discord.js';
import type { DeferredCommandContext } from '../../../utils/commandContext/types.js';
import { createLogger, DISCORD_COLORS, GATEWAY_TIMEOUTS } from '@tzurot/common-types';
import {
  callGatewayApi,
  toGatewayUser,
  type GatewayUser,
} from '../../../utils/userGatewayClient.js';
import {
  type SettingsDashboardConfig,
  type SettingsDashboardSession,
  type SettingUpdateResult,
  type SettingsData,
  type ResolveDefaultsResponse,
  createSettingsDashboard,
  handleSettingsSelectMenu,
  handleSettingsButton,
  handleSettingsModal,
  isSettingsInteraction,
  EXTENDED_CONTEXT_SETTINGS,
  MEMORY_SETTINGS,
  DISPLAY_SETTINGS,
  VOICE_CASCADE_SETTINGS,
  mapSettingToApiUpdate,
  buildCascadeSettingsData,
  buildFallbackSettingsData,
  convertResolveDefaultsResponse,
} from '../../../utils/dashboard/settings/index.js';

const logger = createLogger('user-defaults-settings');

/**
 * Entity type for custom IDs.
 * Uses hyphen separator to avoid conflicts with :: delimiter.
 * CommandHandler uses componentPrefixes to route this entity type → 'settings' command.
 */
const ENTITY_TYPE = 'user-defaults-settings';

/**
 * Dashboard configuration for user default settings
 */
const USER_DEFAULTS_CONFIG: SettingsDashboardConfig = {
  level: 'user-default',
  entityType: ENTITY_TYPE,
  titlePrefix: 'Your Default',
  color: DISCORD_COLORS.SUCCESS,
  settings: [
    ...EXTENDED_CONTEXT_SETTINGS,
    ...MEMORY_SETTINGS,
    ...DISPLAY_SETTINGS,
    ...VOICE_CASCADE_SETTINGS,
  ],
  descriptionNote: 'These defaults apply across all personalities unless overridden.',
};

/**
 * Handle /settings defaults edit command — opens interactive dashboard
 */
export async function handleDefaultsEdit(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;

  logger.debug({ userId }, 'Opening dashboard');

  try {
    const data = await fetchAndConvertSettingsData(toGatewayUser(context.user));

    await createSettingsDashboard(context.interaction, {
      config: USER_DEFAULTS_CONFIG,
      data,
      entityId: userId,
      entityName: 'Your Default Settings',
      userId,
      updateHandler: handleSettingUpdate,
    });

    logger.info({ userId }, 'Dashboard opened');
  } catch (error) {
    logger.error({ err: error }, 'Error opening dashboard');

    if (!context.interaction.replied) {
      await context.editReply({
        content: '❌ An error occurred while opening the default settings dashboard.',
      });
    }
  }
}

/**
 * Handle select menu interactions for user defaults settings
 */
export async function handleUserDefaultsSelectMenu(
  interaction: StringSelectMenuInteraction
): Promise<void> {
  if (!isSettingsInteraction(interaction.customId, ENTITY_TYPE)) {
    return;
  }

  await handleSettingsSelectMenu(interaction, USER_DEFAULTS_CONFIG, handleSettingUpdate);
}

/**
 * Handle button interactions for user defaults settings
 */
export async function handleUserDefaultsButton(interaction: ButtonInteraction): Promise<void> {
  if (!isSettingsInteraction(interaction.customId, ENTITY_TYPE)) {
    return;
  }

  await handleSettingsButton(interaction, USER_DEFAULTS_CONFIG, handleSettingUpdate);
}

/**
 * Handle modal submissions for user defaults settings
 */
export async function handleUserDefaultsModal(interaction: ModalSubmitInteraction): Promise<void> {
  if (!isSettingsInteraction(interaction.customId, ENTITY_TYPE)) {
    return;
  }

  await handleSettingsModal(interaction, USER_DEFAULTS_CONFIG, handleSettingUpdate);
}

/**
 * Check if a custom ID belongs to user defaults settings dashboard
 */
export function isUserDefaultsInteraction(customId: string): boolean {
  return isSettingsInteraction(customId, ENTITY_TYPE);
}

/**
 * Fetch resolved config from API and convert to dashboard SettingsData format.
 */
async function fetchAndConvertSettingsData(user: GatewayUser): Promise<SettingsData> {
  const result = await callGatewayApi<ResolveDefaultsResponse>(
    '/user/config-overrides/resolve-defaults',
    { method: 'GET', user, timeout: GATEWAY_TIMEOUTS.DEFERRED }
  );

  if (!result.ok) {
    logger.warn({ error: result.error }, 'Failed to fetch resolve-defaults');
    return buildFallbackSettingsData();
  }

  const { resolved, userOverrides } = convertResolveDefaultsResponse(result.data);
  return buildCascadeSettingsData(resolved, userOverrides, 'user-default');
}

/**
 * Handle setting updates from the dashboard.
 * Sends updates to the user config-overrides defaults API endpoint.
 */
async function handleSettingUpdate(
  interaction: ButtonInteraction | ModalSubmitInteraction,
  _session: SettingsDashboardSession,
  settingId: string,
  newValue: unknown
): Promise<SettingUpdateResult> {
  const userId = interaction.user.id;

  logger.debug({ settingId, newValue, userId }, 'Updating setting');

  try {
    const body = mapSettingToApiUpdate(settingId, newValue);

    if (body === null) {
      return { success: false, error: 'Unknown setting' };
    }

    const user = toGatewayUser(interaction.user);
    const result = await callGatewayApi('/user/config-overrides/defaults', {
      method: 'PATCH',
      body,
      user,
      timeout: GATEWAY_TIMEOUTS.DEFERRED,
    });

    if (!result.ok) {
      logger.warn({ settingId, error: result.error }, 'Update failed');
      return { success: false, error: result.error };
    }

    // Re-fetch resolved data to get updated effective values and sources
    const newData = await fetchAndConvertSettingsData(user);

    logger.info({ settingId, newValue, userId }, 'Setting updated');

    return { success: true, newData };
  } catch (error) {
    logger.error({ err: error, settingId }, 'Error updating setting');
    return { success: false, error: 'Failed to update setting' };
  }
}
