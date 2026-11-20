/**
 * User Default Settings Dashboard
 *
 * Interactive dashboard for managing user-default config cascade overrides.
 * The user-default tier sits between channel and user-personality in the cascade:
 *   hardcoded → admin → personality → channel → USER-DEFAULT → user-personality
 *
 * Any user can set their global defaults here. These apply across all
 * personalities unless overridden by per-character settings.
 *
 * This handler receives DeferredCommandContext (no deferReply method!)
 * because the parent command uses deferralMode: 'ephemeral'.
 */

import {
  type ButtonInteraction,
  type StringSelectMenuInteraction,
  type ModalSubmitInteraction,
  escapeMarkdown,
} from 'discord.js';
import type { DeferredCommandContext } from '../../../utils/commandContext/types.js';
import { DISCORD_COLORS } from '@tzurot/common-types/constants/discord';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { type UserClient } from '@tzurot/clients';
import { clientsFor } from '../../../utils/gatewayClients.js';
import { classifyGatewayFailure } from '../../../ux/catalog/classify.js';
import { renderSpec } from '../../../ux/render/render.js';
import {
  type SettingsDashboardConfig,
  type SettingsDashboardSession,
  type SettingUpdateResult,
  type SettingsData,
  createSettingsDashboard,
  handleSettingsSelectMenu,
  handleSettingsButton,
  handleSettingsModal,
  isSettingsInteraction,
  VOICE_CASCADE_SETTINGS,
  buildCascadePages,
  mapSettingToApiUpdate,
  buildClearBody,
  buildCascadeSettingsData,
  buildFallbackSettingsData,
  convertResolveDefaultsResponse,
} from '../../../utils/dashboard/settings/index.js';
import { VOICE_ENABLED_DESCRIPTION_NOTE } from '../../../utils/dashboard/settings/settingsConfig.js';

const logger = createLogger('user-defaults-settings');

/**
 * Entity type for custom IDs.
 * Uses hyphen separator to avoid conflicts with :: delimiter.
 * CommandHandler uses componentPrefixes to route this entity type → 'settings' command.
 */
const ENTITY_TYPE = 'user-defaults-settings';

/** The shared D14 page grouping; the user tier's Voice page is the cascade subset. */
const CASCADE_PAGES = buildCascadePages(VOICE_CASCADE_SETTINGS);

/**
 * Dashboard configuration for user default settings
 */
export const USER_DEFAULTS_CONFIG: SettingsDashboardConfig = {
  level: 'user-default',
  entityType: ENTITY_TYPE,
  titlePrefix: 'Your Default',
  // BLURPLE per the design system's button/color vocabulary (green is
  // reserved) — was SUCCESS-green, the flagged D4 violation.
  color: DISCORD_COLORS.BLURPLE,
  settings: CASCADE_PAGES.settings,
  pages: CASCADE_PAGES.pages,
  resetAll: true,
  overviewDescription:
    'Your defaults for every character — Memory, Context & Display, and Voice pages.',
  scopeNote: () =>
    '👤 Applies only to your conversations, with every character. Your per-character overrides still win.',
  descriptionNote: VOICE_ENABLED_DESCRIPTION_NOTE,
};

/**
 * Handle /settings defaults edit command — opens interactive dashboard
 */
export async function handleDefaultsEdit(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;

  logger.debug({ userId }, 'Opening dashboard');

  try {
    const { userClient } = clientsFor(context.interaction);
    const [data, presetNote] = await Promise.all([
      fetchAndConvertSettingsData(userClient),
      fetchPresetNote(userClient),
    ]);

    await createSettingsDashboard(context.interaction, {
      config: USER_DEFAULTS_CONFIG,
      data,
      entityId: userId,
      entityName: 'Your Default Settings',
      userId,
      descriptionNote: presetNote,
    });

    logger.info({ userId }, 'Dashboard opened');
  } catch (error) {
    logger.error({ err: error }, 'Error opening dashboard');

    if (!context.interaction.replied) {
      await context.editReply({
        content: renderSpec(
          classifyGatewayFailure(error, 'default settings', {
            operation: 'read',
            failedAction: 'open the default settings dashboard',
          })
        ),
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

  await handleSettingsSelectMenu(interaction, USER_DEFAULTS_CONFIG);
}

/**
 * Handle button interactions for user defaults settings
 */
export async function handleUserDefaultsButton(interaction: ButtonInteraction): Promise<void> {
  if (!isSettingsInteraction(interaction.customId, ENTITY_TYPE)) {
    return;
  }

  await handleSettingsButton(
    interaction,
    USER_DEFAULTS_CONFIG,
    handleSettingUpdate,
    handleSettingsReset
  );
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
async function fetchAndConvertSettingsData(userClient: UserClient): Promise<SettingsData> {
  const result = await userClient.resolveUserDefaults();

  if (!result.ok) {
    logger.warn({ error: result.error }, 'Failed to fetch resolve-defaults');
    return buildFallbackSettingsData();
  }

  const { resolved, userOverrides } = convertResolveDefaultsResponse(result.data);
  return buildCascadeSettingsData(resolved, userOverrides, 'user-default');
}

/**
 * The Model preset line for the note slot: which preset the user's default
 * slot holds, read from the same GET `/preset default` reads. The dashboard
 * itself is read-only for presets, so the note points at the command that
 * changes it. Undefined on a failed read — the dashboard renders without it.
 */
async function fetchPresetNote(userClient: UserClient): Promise<string | undefined> {
  const result = await userClient.getDefaultModelConfig({ slot: 'text' });

  if (!result.ok) {
    logger.warn({ error: result.error }, 'Failed to fetch default model preset');
    return undefined;
  }

  const { configName } = result.data.default;
  return configName === null
    ? 'Model preset: none set — `/preset default set` picks one for every character.'
    : `Model preset: **${escapeMarkdown(configName, { maskedLink: true })}** (your default) — change it: \`/preset default set\`.`;
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
  const body = mapSettingToApiUpdate(settingId, newValue);
  if (body === null) {
    return { success: false, error: 'Unknown setting' };
  }
  return patchUserDefaults(interaction, body, { settingId, newValue });
}

/**
 * The batch clear behind Reset page and Reset all: every listed setting's null
 * mapping merged into ONE body, written through the single-setting path.
 */
async function handleSettingsReset(
  interaction: ButtonInteraction,
  _session: SettingsDashboardSession,
  settingIds: string[]
): Promise<SettingUpdateResult> {
  const body = buildClearBody(settingIds);
  if (body === null) {
    return { success: false, error: 'Unknown setting' };
  }
  return patchUserDefaults(interaction, body, { settingIds });
}

/**
 * The write path both handlers share: PATCH the user-default tier, then
 * re-fetch the resolved data. `logFields` names what was written.
 */
async function patchUserDefaults(
  interaction: ButtonInteraction | ModalSubmitInteraction,
  body: Record<string, unknown>,
  logFields: Record<string, unknown>
): Promise<SettingUpdateResult> {
  const userId = interaction.user.id;

  logger.debug({ ...logFields, userId }, 'Updating setting');

  try {
    const { userClient } = clientsFor(interaction);
    const result = await userClient.updateUserDefaults(body);

    if (!result.ok) {
      logger.warn({ ...logFields, error: result.error }, 'Update failed');
      return { success: false, error: result.error };
    }

    // Re-fetch resolved data to get updated effective values and sources
    const newData = await fetchAndConvertSettingsData(userClient);

    logger.info({ ...logFields, userId }, 'Setting updated');

    return { success: true, newData };
  } catch (error) {
    logger.error({ err: error, ...logFields }, 'Error updating setting');
    return { success: false, error: 'unexpected error, please try again' };
  }
}
