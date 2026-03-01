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
import {
  createLogger,
  DISCORD_COLORS,
  HARDCODED_CONFIG_DEFAULTS,
  type ConfigOverrideSource,
} from '@tzurot/common-types';
import { callGatewayApi } from '../../../utils/userGatewayClient.js';
import {
  type SettingsDashboardConfig,
  type SettingsDashboardSession,
  type SettingsData,
  type SettingValue,
  type SettingUpdateResult,
  type SettingSource,
  createSettingsDashboard,
  handleSettingsSelectMenu,
  handleSettingsButton,
  handleSettingsModal,
  isSettingsInteraction,
  EXTENDED_CONTEXT_SETTINGS,
  MEMORY_SETTINGS,
  mapSettingToApiUpdate,
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
  settings: [...EXTENDED_CONTEXT_SETTINGS, ...MEMORY_SETTINGS],
  descriptionNote: 'These defaults apply across all personalities unless overridden.',
};

/** Response shape from GET /user/config-overrides/resolve-defaults */
interface ResolveDefaultsResponse {
  maxMessages: number;
  maxAge: number | null;
  maxImages: number;
  focusModeEnabled: boolean;
  crossChannelHistoryEnabled: boolean;
  shareLtmAcrossPersonalities: boolean;
  memoryScoreThreshold: number;
  memoryLimit: number;
  sources: Record<string, ConfigOverrideSource>;
  userOverrides: Record<string, unknown> | null;
}

/**
 * Handle /settings defaults edit command — opens interactive dashboard
 */
export async function handleDefaultsEdit(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;

  logger.debug({ userId }, '[User Defaults] Opening dashboard');

  try {
    const data = await fetchAndConvertSettingsData(userId);

    await createSettingsDashboard(context.interaction, {
      config: USER_DEFAULTS_CONFIG,
      data,
      entityId: userId,
      entityName: 'Your Default Settings',
      userId,
      updateHandler: handleSettingUpdate,
    });

    logger.info({ userId }, '[User Defaults] Dashboard opened');
  } catch (error) {
    logger.error({ err: error }, '[User Defaults] Error opening dashboard');

    if (!context.interaction.replied) {
      await context.editReply({
        content: 'An error occurred while opening the default settings dashboard.',
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
 * Map ConfigOverrideSource to dashboard SettingSource.
 * Both 'user-default' and 'admin' map to 'global' because neither is specific
 * to a channel or personality — they are server/account-wide tiers.
 * The dashboard differentiates "set by you" vs "inherited" via localValue !== null,
 * not via the source field.
 */
function mapCascadeSource(source: ConfigOverrideSource): SettingSource {
  switch (source) {
    case 'user-default':
      return 'global';
    case 'admin':
      return 'global';
    case 'hardcoded':
    default:
      return 'default';
  }
}

/**
 * Fetch resolved config from API and convert to dashboard SettingsData format.
 */
async function fetchAndConvertSettingsData(userId: string): Promise<SettingsData> {
  const result = await callGatewayApi<ResolveDefaultsResponse>(
    '/user/config-overrides/resolve-defaults',
    { method: 'GET', userId }
  );

  if (!result.ok) {
    logger.warn({ error: result.error }, '[User Defaults] Failed to fetch resolve-defaults');
    return buildFallbackSettingsData();
  }

  return convertToSettingsData(result.data);
}

/**
 * Convert API response to dashboard SettingsData format.
 * Uses source tracking from the resolve-defaults endpoint.
 */
function convertToSettingsData(response: ResolveDefaultsResponse): SettingsData {
  function buildValue<T>(field: string): SettingValue<T> {
    const localValue = (response.userOverrides?.[field] ?? null) as T | null;
    const effectiveValue = response[field as keyof ResolveDefaultsResponse] as T;
    const source = mapCascadeSource(response.sources[field]);
    return { localValue, effectiveValue, source };
  }

  return {
    maxMessages: buildValue<number>('maxMessages'),
    maxAge: buildValue<number | null>('maxAge'),
    maxImages: buildValue<number>('maxImages'),
    focusModeEnabled: buildValue<boolean>('focusModeEnabled'),
    crossChannelHistoryEnabled: buildValue<boolean>('crossChannelHistoryEnabled'),
    shareLtmAcrossPersonalities: buildValue<boolean>('shareLtmAcrossPersonalities'),
    memoryScoreThreshold: buildValue<number>('memoryScoreThreshold'),
    memoryLimit: buildValue<number>('memoryLimit'),
  };
}

/**
 * Build fallback SettingsData when API call fails.
 * Uses hardcoded defaults with 'default' source for all fields.
 */
function buildFallbackSettingsData(): SettingsData {
  function fallback<T>(field: keyof typeof HARDCODED_CONFIG_DEFAULTS): SettingValue<T> {
    return {
      localValue: null,
      effectiveValue: HARDCODED_CONFIG_DEFAULTS[field] as T,
      source: 'default',
    };
  }

  return {
    maxMessages: fallback<number>('maxMessages'),
    maxAge: fallback<number | null>('maxAge'),
    maxImages: fallback<number>('maxImages'),
    focusModeEnabled: fallback<boolean>('focusModeEnabled'),
    crossChannelHistoryEnabled: fallback<boolean>('crossChannelHistoryEnabled'),
    shareLtmAcrossPersonalities: fallback<boolean>('shareLtmAcrossPersonalities'),
    memoryScoreThreshold: fallback<number>('memoryScoreThreshold'),
    memoryLimit: fallback<number>('memoryLimit'),
  };
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

  logger.debug({ settingId, newValue, userId }, '[User Defaults] Updating setting');

  try {
    const body = mapSettingToApiUpdate(settingId, newValue);

    if (body === null) {
      return { success: false, error: 'Unknown setting' };
    }

    const result = await callGatewayApi('/user/config-overrides/defaults', {
      method: 'PATCH',
      body,
      userId,
    });

    if (!result.ok) {
      logger.warn({ settingId, error: result.error }, '[User Defaults] Update failed');
      return { success: false, error: result.error };
    }

    // Re-fetch resolved data to get updated effective values and sources
    const newData = await fetchAndConvertSettingsData(userId);

    logger.info({ settingId, newValue, userId }, '[User Defaults] Setting updated');

    return { success: true, newData };
  } catch (error) {
    logger.error({ err: error, settingId }, '[User Defaults] Error updating setting');
    return { success: false, error: 'Failed to update setting' };
  }
}
