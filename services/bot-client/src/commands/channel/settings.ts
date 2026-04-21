/**
 * Channel Config Cascade Dashboard
 *
 * Interactive dashboard for managing channel-level config cascade overrides.
 * Channel tier sits between personality and user tiers in the cascade:
 *   hardcoded → admin → personality → CHANNEL → user-default → user-personality
 *
 * Channel moderators can set defaults for the channel. Individual users
 * retain control via their own user-level overrides.
 *
 * This handler receives DeferredCommandContext (no deferReply method!)
 * because the parent command uses deferralMode: 'ephemeral'.
 */

import type { ButtonInteraction, ModalSubmitInteraction } from 'discord.js';
import { PermissionFlagsBits } from 'discord.js';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import {
  createLogger,
  DISCORD_COLORS,
  GATEWAY_TIMEOUTS,
  type ResolvedConfigOverrides,
} from '@tzurot/common-types';
import { callGatewayApi, toGatewayUser, type GatewayUser } from '../../utils/userGatewayClient.js';
import { GatewayClient, invalidateChannelSettingsCache } from '../../utils/GatewayClient.js';
import {
  type SettingsDashboardConfig,
  type SettingsDashboardSession,
  type SettingsData,
  type SettingUpdateHandler,
  type SettingUpdateResult,
  type ResolveDefaultsResponse,
  createSettingsDashboard,
  createSettingsCommandHandlers,
  EXTENDED_CONTEXT_SETTINGS,
  MEMORY_SETTINGS,
  DISPLAY_SETTINGS,
  VOICE_CASCADE_SETTINGS,
  mapSettingToApiUpdate,
  buildCascadeSettingsData,
  convertResolveDefaultsResponse,
} from '../../utils/dashboard/settings/index.js';

const logger = createLogger('channel-settings');

/**
 * Entity type for custom IDs
 * Uses hyphen separator to avoid conflicts with :: delimiter
 * CommandHandler uses alias mapping to route 'channel-settings' → 'channel'
 */
const ENTITY_TYPE = 'channel-settings';

/**
 * Dashboard configuration for channel context settings.
 * Includes both extended context and memory settings — all are now wirable
 * via the channel tier of the config cascade.
 */
const CHANNEL_SETTINGS_CONFIG: SettingsDashboardConfig = {
  level: 'channel',
  entityType: ENTITY_TYPE,
  titlePrefix: 'Channel',
  color: DISCORD_COLORS.BLURPLE,
  settings: [
    ...EXTENDED_CONTEXT_SETTINGS,
    ...MEMORY_SETTINGS,
    ...DISPLAY_SETTINGS,
    ...VOICE_CASCADE_SETTINGS,
  ],
};

/**
 * Handle /channel settings command - shows interactive dashboard
 *
 * @param context - DeferredCommandContext (already deferred by framework)
 */
export async function handleChannelSettings(context: DeferredCommandContext): Promise<void> {
  const { channelId, member, interaction } = context;
  const userId = context.user.id;

  // Check permissions: Manage Messages required
  if (member?.permissions.has(PermissionFlagsBits.ManageMessages) !== true) {
    await context.editReply({
      content: '❌ You need the **Manage Messages** permission to manage channel context settings.',
    });
    return;
  }

  logger.debug({ channelId, userId }, '[Channel Settings] Opening dashboard');

  try {
    // Get the activated personality for this channel (needed for resolve endpoint)
    const gatewayClient = new GatewayClient();
    const channelSettings = await gatewayClient.getChannelSettings(channelId);
    const personalityId = channelSettings?.settings?.activatedPersonalityId ?? undefined;

    // Fetch resolved config with channel tier
    const data = await fetchAndConvertSettingsData(
      toGatewayUser(context.user),
      personalityId,
      channelId
    );

    // When no personality is activated, resolve-defaults is used as fallback,
    // so admin and user-default overrides are visible. Only personality-tier is missing.
    const config =
      personalityId === undefined
        ? {
            ...CHANNEL_SETTINGS_CONFIG,
            descriptionNote:
              'ℹ️ No personality activated — personality-level defaults not included in cascade.',
          }
        : CHANNEL_SETTINGS_CONFIG;

    // Create and display the dashboard - uses interaction for Discord.js compatibility
    await createSettingsDashboard(interaction, {
      config,
      data,
      entityId: channelId,
      entityName: `<#${channelId}>`,
      userId,
      updateHandler: createUpdateHandler(channelId),
    });

    logger.info({ channelId, userId }, '[Channel Settings] Dashboard opened');
  } catch (error) {
    logger.error({ err: error, channelId }, '[Channel Settings] Error opening dashboard');

    // Check if already replied via interaction (dashboard may have responded)
    if (!interaction.replied) {
      await context.editReply({
        content: '❌ An error occurred while opening the context settings dashboard.',
      });
    }
  }
}

/**
 * Build a per-interaction update handler bound to a specific channel ID.
 * Used both by handleChannelSettings (dashboard init) and createSettingsCommandHandlers
 * (interaction routers) so the channelId binding lives in exactly one place.
 */
function createUpdateHandler(channelId: string): SettingUpdateHandler {
  return (interaction, session, settingId, newValue) =>
    handleSettingUpdate(interaction, session, settingId, newValue, channelId);
}

// Interaction routers — generated by the shared factory so the 19-line
// guard/parse/forward pattern lives in exactly one place. See
// services/bot-client/src/utils/dashboard/settings/createSettingsCommandHandlers.ts
const channelSettingsHandlers = createSettingsCommandHandlers({
  entityType: ENTITY_TYPE,
  settingsConfig: CHANNEL_SETTINGS_CONFIG,
  createUpdateHandler,
});

export const handleChannelSettingsSelectMenu = channelSettingsHandlers.handleSelectMenu;
export const handleChannelSettingsButton = channelSettingsHandlers.handleButton;
export const handleChannelSettingsModal = channelSettingsHandlers.handleModal;
export const isChannelSettingsInteraction = channelSettingsHandlers.isInteraction;

/**
 * Fetch resolved config from API and convert to dashboard SettingsData format.
 *
 * Gets the channel's own overrides (localValue) and the fully resolved values
 * (effectiveValue) with source tracking from the config cascade.
 *
 * When no personality is activated, falls back to resolve-defaults (hardcoded →
 * admin → user-default) so admin overrides are still visible.
 */
async function fetchAndConvertSettingsData(
  user: GatewayUser,
  personalityId: string | undefined,
  channelId: string
): Promise<SettingsData> {
  // Fetch channel's local overrides and resolved cascade in parallel.
  // When no personality is activated, use resolve-defaults for admin/user cascade.
  const resolvePromise =
    personalityId !== undefined
      ? callGatewayApi<ResolvedConfigOverrides>(
          `/user/config-overrides/resolve/${encodeURIComponent(personalityId)}?channelId=${encodeURIComponent(channelId)}`,
          { method: 'GET', user, timeout: GATEWAY_TIMEOUTS.DEFERRED }
        )
      : callGatewayApi<ResolveDefaultsResponse>('/user/config-overrides/resolve-defaults', {
          method: 'GET',
          user,
          timeout: GATEWAY_TIMEOUTS.DEFERRED,
        });

  const [channelOverridesResult, resolvedResult] = await Promise.all([
    callGatewayApi<{ configOverrides: Record<string, unknown> | null }>(
      `/user/channel/${encodeURIComponent(channelId)}/config-overrides`,
      { method: 'GET', user, timeout: GATEWAY_TIMEOUTS.DEFERRED }
    ),
    resolvePromise,
  ]);

  const channelOverrides = channelOverridesResult.ok
    ? channelOverridesResult.data.configOverrides
    : null;

  // Convert the resolved result to ResolvedConfigOverrides format
  let resolved: ResolvedConfigOverrides | null = null;
  if (resolvedResult.ok) {
    if (personalityId !== undefined) {
      // Full cascade response — already in ResolvedConfigOverrides format
      resolved = resolvedResult.data;
    } else {
      // resolve-defaults response — flat format with reserved metadata keys
      const { resolved: convertedResolved } = convertResolveDefaultsResponse(
        resolvedResult.data as ResolveDefaultsResponse
      );
      resolved = convertedResolved;
    }
  }

  return buildCascadeSettingsData(resolved, channelOverrides, 'channel');
}

/**
 * Handle setting updates from the dashboard.
 * Sends updates to the channel config-overrides API endpoint.
 */
async function handleSettingUpdate(
  interaction: ButtonInteraction | ModalSubmitInteraction,
  _session: SettingsDashboardSession,
  settingId: string,
  newValue: unknown,
  channelId: string
): Promise<SettingUpdateResult> {
  const userId = interaction.user.id;

  logger.debug({ settingId, newValue, channelId, userId }, '[Channel Settings] Updating setting');

  try {
    // Map setting ID to API body using shared utility
    const body = mapSettingToApiUpdate(settingId, newValue);

    if (body === null) {
      return { success: false, error: 'Unknown setting' };
    }

    // Send update to channel config-overrides endpoint
    const result = await callGatewayApi(
      `/user/channel/${encodeURIComponent(channelId)}/config-overrides`,
      {
        method: 'PATCH',
        body,
        user: toGatewayUser(interaction.user),
        timeout: GATEWAY_TIMEOUTS.DEFERRED,
      }
    );

    if (!result.ok) {
      logger.warn(
        { settingId, error: result.error, channelId },
        '[Channel Settings] Update failed'
      );
      return { success: false, error: result.error };
    }

    // Invalidate cache
    invalidateChannelSettingsCache(channelId);

    // Fetch fresh data with resolved values
    const gatewayClient = new GatewayClient();
    const channelSettings = await gatewayClient.getChannelSettings(channelId);
    const personalityId = channelSettings?.settings?.activatedPersonalityId ?? undefined;
    const newData = await fetchAndConvertSettingsData(
      toGatewayUser(interaction.user),
      personalityId,
      channelId
    );

    logger.info({ settingId, newValue, channelId, userId }, '[Channel Settings] Setting updated');

    return { success: true, newData };
  } catch (error) {
    logger.error({ err: error, settingId, channelId }, '[Channel Settings] Error updating setting');
    return { success: false, error: 'Failed to update setting' };
  }
}
