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
  VOICE_SETTINGS,
  buildCascadePages,
  SYSTEM_SETTINGS_DEFINITIONS,
  SYSTEM_SETTINGS_PAGES,
  isSystemSettingId,
  mapSettingToApiUpdate,
  buildCascadeSettingsData,
  buildSystemSettingsData,
} from '../../utils/dashboard/settings/index.js';
import { handleSystemSettingUpdate } from './settingsSystemUpdate.js';

const logger = createLogger('admin-settings');

/**
 * Entity type for custom IDs
 * Uses hyphen separator to avoid conflicts with :: delimiter
 * CommandHandler uses alias mapping to route 'admin-settings' → 'admin'
 */
const ENTITY_TYPE = 'admin-settings';

/** The D14 cascade page group (admin tier includes the transcription toggle). */
const CASCADE_PAGES = buildCascadePages(VOICE_SETTINGS);

/**
 * Dashboard configuration: the two-axis admin surface (artifact D8) — the
 * cascade Defaults pages followed by the owner-only System pages, one command,
 * one session. System settings carry `plainDisplay` on their definitions, so
 * the mixed dashboard renders cascade status only where cascade semantics exist.
 */
const ADMIN_SETTINGS_CONFIG: SettingsDashboardConfig = {
  level: 'global',
  entityType: ENTITY_TYPE,
  titlePrefix: 'Global',
  color: DISCORD_COLORS.BLURPLE,
  settings: [...CASCADE_PAGES.settings, ...SYSTEM_SETTINGS_DEFINITIONS],
  pages: [...CASCADE_PAGES.pages, ...SYSTEM_SETTINGS_PAGES],
  overviewDescription:
    'Configure global cascade defaults (Defaults pages) and owner-only system settings (System pages).',
};

/**
 * Handle /admin settings command - shows interactive dashboard
 */
export async function handleSettings(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;

  logger.debug({ userId }, 'Opening dashboard');

  try {
    // Fetch BOTH bags: the cascade defaults and the system-settings bag (the
    // dashboard hosts Defaults pages + System pages in one session).
    const { ownerClient } = clientsFor(context.interaction);
    const settings = await fetchAdminSettings(ownerClient);

    if (settings === null) {
      // Genuine 404 only — infra failures throw to the catch below.
      await context.editReply({
        content: renderSpec(CATALOG.error.notFound('Admin settings')),
      });
      return;
    }

    const system = await ownerClient.getSystemSettings();
    if (!system.ok) {
      await context.editReply({
        content: renderSpec(
          classifyGatewayFailure(new Error(system.error), 'system settings', {
            operation: 'read',
            failedAction: 'open the settings dashboard',
          })
        ),
      });
      return;
    }

    // Convert API responses to one dashboard data map (keys don't collide:
    // cascade ids vs registry ids are disjoint namespaces by construction)
    const data: SettingsData = {
      ...convertToSettingsData(settings),
      ...buildSystemSettingsData(system.data.systemSettings),
    };

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

  await handleSettingsButton(interaction, ADMIN_SETTINGS_CONFIG, dispatchSettingUpdate);
}

/**
 * Handle modal submissions for admin settings
 */
export async function handleAdminSettingsModal(interaction: ModalSubmitInteraction): Promise<void> {
  if (!isSettingsInteraction(interaction.customId, ENTITY_TYPE)) {
    return;
  }

  await handleSettingsModal(interaction, ADMIN_SETTINGS_CONFIG, dispatchSettingUpdate);
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
 * Route a dashboard update to the right write path by settingId membership —
 * NOT by the session's current page, which a stale message row can contradict
 * (a page-2 button clicked while the session sits on page 5). The two id
 * namespaces are disjoint by construction; a system id that somehow reached
 * the cascade handler would fail clean ("Unknown setting").
 */
async function dispatchSettingUpdate(
  interaction: ButtonInteraction | ModalSubmitInteraction,
  session: SettingsDashboardSession,
  settingId: string,
  newValue: unknown
): Promise<SettingUpdateResult> {
  return isSystemSettingId(settingId)
    ? handleSystemSettingUpdate(interaction, session, settingId, newValue)
    : handleSettingUpdate(interaction, session, settingId, newValue);
}

/**
 * Handle CASCADE setting updates from the dashboard.
 * Uses the /admin/settings/config-defaults sub-route which accepts
 * flat Partial<ConfigOverrides> — same body shape as all other tiers.
 */
async function handleSettingUpdate(
  interaction: ButtonInteraction | ModalSubmitInteraction,
  session: SettingsDashboardSession,
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

    // Merge the refreshed cascade values over the session map — replacing it
    // outright would drop the System-page entries from the mixed dashboard.
    const newData: SettingsData = { ...session.data, ...convertToSettingsData(result.data) };
    logger.info({ settingId, newValue, userId }, 'Setting updated');
    return { success: true, newData };
  } catch (error) {
    logger.error({ err: error, settingId }, 'Error updating setting');
    return { success: false, error: 'Failed to update setting' };
  }
}
