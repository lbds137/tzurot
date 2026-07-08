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
import { DISCORD_COLORS } from '@tzurot/common-types/constants/discord';
import { type GetAdminSettingsResponse } from '@tzurot/common-types/schemas/api/adminSettings';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { nullOn404, type OwnerClient } from '@tzurot/clients';
import { CATALOG } from '../../ux/catalog/catalog.js';
import { classifyGatewayFailure } from '../../ux/catalog/classify.js';
import { renderSpec } from '../../ux/render/render.js';
import { clientsFor } from '../../utils/gatewayClients.js';
import { invalidateAdminSettingsCache } from '../../utils/gatewayServiceCalls.js';
import {
  type SettingsData,
  type SettingsDashboardConfig,
  type SettingsDashboardSession,
  type SettingUpdateResult,
  createSettingsDashboard,
  handleSettingsSelectMenu,
  handleSettingsButton,
  handleSettingsModal,
  isSettingsInteraction,
  EXTENDED_CONTEXT_SETTINGS,
  MEMORY_SETTINGS,
  DISPLAY_SETTINGS,
  VOICE_SETTINGS,
  mapSettingToApiUpdate,
  buildCascadeSettingsData,
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
  settings: [
    ...EXTENDED_CONTEXT_SETTINGS,
    ...MEMORY_SETTINGS,
    ...DISPLAY_SETTINGS,
    ...VOICE_SETTINGS,
  ],
};

/**
 * Handle /admin settings command - shows interactive dashboard
 */
export async function handleSettings(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;

  logger.debug({ userId }, 'Opening dashboard');

  try {
    // Fetch current settings from API gateway
    const { ownerClient } = clientsFor(context.interaction);
    const settings = await fetchAdminSettings(ownerClient);

    if (settings === null) {
      // Genuine 404 only — infra failures throw to the catch below.
      await context.editReply({
        content: renderSpec(CATALOG.error.notFound('Admin settings')),
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
    });

    logger.info({ userId }, 'Dashboard opened');
  } catch (error) {
    logger.error({ err: error }, 'Error opening dashboard');

    // Only respond if we haven't already (createSettingsDashboard may have replied)
    if (!context.interaction.replied) {
      await context.editReply({
        content: renderSpec(
          classifyGatewayFailure(error, 'admin settings', {
            operation: 'read',
            failedAction: 'open the settings dashboard',
          })
        ),
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

  await handleSettingsSelectMenu(interaction, ADMIN_SETTINGS_CONFIG);
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
async function fetchAdminSettings(
  ownerClient: OwnerClient
): Promise<GetAdminSettingsResponse | null> {
  const result = await ownerClient.getAdminSettings();
  // null ONLY on a genuine 404; infra failures throw so a transient blip
  // can't read as "settings missing" (nullOn404 contract).
  return nullOn404(result);
}

/**
 * Convert API response to dashboard SettingsData format.
 * Admin is the lowest tier — no resolve endpoint needed, uses hardcoded + local.
 */
function convertToSettingsData(settings: GetAdminSettingsResponse): SettingsData {
  const defaults = settings.configDefaults ?? null;
  return buildCascadeSettingsData(null, defaults, 'admin');
}

/**
 * Handle setting updates from the dashboard.
 * Uses the /admin/settings/config-defaults sub-route which accepts
 * flat Partial<ConfigOverrides> — same body shape as all other tiers.
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
    // Map setting ID to API body using shared utility
    const body = mapSettingToApiUpdate(settingId, newValue);

    if (body === null) {
      return { success: false, error: 'Unknown setting' };
    }

    // Send update to admin config-defaults sub-route (flat body shape)
    const { ownerClient } = clientsFor(interaction);
    const result = await ownerClient.updateAdminSettings(body);

    if (!result.ok) {
      logger.warn({ settingId, error: result.error }, 'Update failed');
      return { success: false, error: result.error };
    }

    // Clear the service-read cache so VoiceMessageProcessor (and any other
    // service-side reader) picks up the new defaults promptly instead of
    // waiting out the 60s TTL.
    invalidateAdminSettingsCache();

    const newData = convertToSettingsData(result.data);
    logger.info({ settingId, newValue, userId }, 'Setting updated');
    return { success: true, newData };
  } catch (error) {
    logger.error({ err: error, settingId }, 'Error updating setting');
    return { success: false, error: 'Failed to update setting' };
  }
}
