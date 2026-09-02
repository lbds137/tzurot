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
 * This dashboard's OWN resolution (what it shows as Current/Parent) is
 * scoped to hardcoded → admin → personality → channel and never draws on
 * the viewing moderator's user-default/user-personality tiers — every
 * moderator viewing this channel sees the identical resolved state.
 *
 * This handler receives DeferredCommandContext (no deferReply method!)
 * because the parent command uses deferralMode: 'ephemeral'.
 */

import {
  type ButtonInteraction,
  type ModalSubmitInteraction,
  PermissionFlagsBits,
} from 'discord.js';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { CATALOG } from '../../ux/catalog/catalog.js';
import { classifyGatewayFailure } from '../../ux/catalog/classify.js';
import { renderSpec } from '../../ux/render/render.js';
import { DISCORD_COLORS } from '@tzurot/common-types/constants/discord';
import { type ResolvedConfigOverrides } from '@tzurot/common-types/schemas/api/configOverrides';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { type UserClient } from '@tzurot/clients';
import { clientsFor } from '../../utils/gatewayClients.js';
import {
  getChannelSettingsCached,
  invalidateChannelSettingsCache,
} from '../../utils/gatewayServiceCalls.js';
import {
  type SettingsDashboardConfig,
  type SettingsDashboardSession,
  type SettingsData,
  type SettingUpdateHandler,
  type SettingUpdateResult,
  type SettingsResetHandler,
  createSettingsDashboard,
  createSettingsCommandHandlers,
  EXTENDED_CONTEXT_SETTINGS,
  MEMORY_SETTINGS,
  DISPLAY_SETTINGS,
  VOICE_CASCADE_SETTINGS,
  mapSettingToApiUpdate,
  buildCascadeSettingsData,
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
  // "Clear every channel-tier override" — the DELETE endpoint has existed
  // since the manifest gained clearChannelConfigOverrides; this is its UX
  // surface. The shared handler puts a Tier-A Cancel/Confirm step in front
  // (design-system §3.5: bulk-destructive dashboard clicks confirm; the
  // typed-phrase Tier B stays reserved for irreversible purge-class acts).
  resetButton: { label: 'Reset to defaults' },
};

/**
 * Handle /channel settings command - shows interactive dashboard
 *
 * @param context - DeferredCommandContext (already deferred by framework)
 */
export async function handleChannelSettings(context: DeferredCommandContext): Promise<void> {
  const { channelId, interaction } = context;
  const userId = context.user.id;

  // Manage Messages required — read from `interaction.memberPermissions`, NOT
  // `context.member.permissions`. The latter is documented as "taking only
  // roles and owner status into account": guild-wide, blind to per-channel
  // overwrites. This command governs ONE channel, so the channel-scoped
  // source is the correct authority — a moderator whose role grants Manage
  // Messages but who is denied it by an overwrite HERE should not manage this
  // channel's settings. It also keeps this check identical in scope to the
  // per-click recheck below; two different scopes would deny every click with
  // a misleading "you no longer have…" for anyone using channel overwrites.
  if (interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages) !== true) {
    await context.editReply({
      content: renderSpec(
        CATALOG.error.permissionDenied(
          'manage channel context settings — you need the **Manage Messages** permission'
        )
      ),
    });
    return;
  }

  logger.debug({ channelId, userId }, 'Opening dashboard');

  try {
    // Get the activated personality for this channel (needed for resolve endpoint)
    const channelSettings = await getChannelSettingsCached(channelId);
    const personalityId = channelSettings?.settings?.activatedPersonalityId ?? undefined;

    const { userClient } = clientsFor(interaction);
    const data = await fetchAndConvertSettingsData(userClient, personalityId, channelId);

    // When no personality is activated, the channel-scoped resolve simply
    // omits the personality tier — hardcoded/admin/channel are still resolved.
    const config =
      personalityId === undefined
        ? {
            ...CHANNEL_SETTINGS_CONFIG,
            descriptionNote:
              'ℹ️ No character activated — character-level defaults not included in cascade.',
          }
        : CHANNEL_SETTINGS_CONFIG;

    // Create and display the dashboard - uses interaction for Discord.js compatibility
    await createSettingsDashboard(interaction, {
      config,
      data,
      entityId: channelId,
      entityName: `<#${channelId}>`,
      userId,
    });

    logger.info({ channelId, userId }, 'Dashboard opened');
  } catch (error) {
    logger.error({ err: error, channelId }, 'Error opening dashboard');

    // Check if already replied via interaction (dashboard may have responded)
    if (!interaction.replied) {
      await context.editReply({
        content: renderSpec(
          classifyGatewayFailure(error, 'context settings', {
            operation: 'read',
            failedAction: 'open the context settings dashboard',
          })
        ),
      });
    }
  }
}

/**
 * Re-check the Manage Messages permission that every mutation here depends on.
 *
 * `handleChannelSettings` checks it once when the dashboard opens, but the
 * session outlives a permission revocation: a moderator demoted mid-session
 * would otherwise keep mutating channel overrides until the session expired.
 * Authority has to hold at the CLICK, not just at the open — most of all for
 * reset, which clears every override at once.
 *
 * Returns a failure result to hand straight back (composed upstream as
 * `Failed to update: …` / `Failed to reset: …`), or null when still permitted.
 * `memberPermissions` is null outside a guild; channel settings are
 * guild-only, so that reads as "not permitted" correctly.
 */
function denyIfPermissionRevoked(
  interaction: ButtonInteraction | ModalSubmitInteraction
): SettingUpdateResult | null {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages) === true) {
    return null;
  }
  return {
    success: false,
    error: 'you no longer have the **Manage Messages** permission in this channel',
  };
}

/**
 * Build a per-interaction update handler bound to a specific channel ID.
 * Used both by handleChannelSettings (dashboard init) and createSettingsCommandHandlers
 * (interaction routers) so the channelId binding lives in exactly one place.
 */
function createUpdateHandler(channelId: string): SettingUpdateHandler {
  return async (interaction, session, settingId, newValue) => {
    const denied = denyIfPermissionRevoked(interaction);
    if (denied !== null) {
      logger.warn({ channelId, userId: interaction.user.id }, 'Update denied: permission revoked');
      return denied;
    }
    return handleSettingUpdate(interaction, session, settingId, newValue, channelId);
  };
}

/**
 * Build a per-interaction reset handler bound to a specific channel ID —
 * clears EVERY channel-tier override via the DELETE endpoint, then refetches
 * the resolved cascade so the overview re-renders with inherited values.
 */
function createResetHandler(channelId: string): SettingsResetHandler {
  return async (interaction: ButtonInteraction): Promise<SettingUpdateResult> => {
    const userId = interaction.user.id;
    const denied = denyIfPermissionRevoked(interaction);
    if (denied !== null) {
      logger.warn({ channelId, userId }, 'Reset denied: permission revoked');
      return denied;
    }
    logger.debug({ channelId, userId }, 'Resetting channel overrides');

    try {
      const { userClient } = clientsFor(interaction);
      const result = await userClient.clearChannelConfigOverrides(channelId);

      if (!result.ok) {
        logger.warn({ error: result.error, channelId }, 'Reset failed');
        return { success: false, error: result.error };
      }

      invalidateChannelSettingsCache(channelId);

      const channelSettings = await getChannelSettingsCached(channelId);
      const personalityId = channelSettings?.settings?.activatedPersonalityId ?? undefined;
      const newData = await fetchAndConvertSettingsData(userClient, personalityId, channelId);

      logger.info({ channelId, userId }, 'Channel overrides reset');
      return { success: true, newData };
    } catch (error) {
      logger.error({ err: error, channelId }, 'Error resetting channel overrides');
      // Composed into `Failed to reset: <error>` upstream — keep this a
      // bare cause so the message doesn't read "Failed to reset: Failed…".
      return { success: false, error: 'unexpected error, please try again' };
    }
  };
}

// Interaction routers — generated by the shared factory so the 19-line
// guard/parse/forward pattern lives in exactly one place. See
// services/bot-client/src/utils/dashboard/settings/createSettingsCommandHandlers.ts
const channelSettingsHandlers = createSettingsCommandHandlers({
  entityType: ENTITY_TYPE,
  settingsConfig: CHANNEL_SETTINGS_CONFIG,
  createUpdateHandler,
  createResetHandler,
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
 * Always resolves through the channel-scoped endpoint (hardcoded → admin →
 * personality when one is activated → channel) — never the viewing
 * moderator's own user-tier overrides. This is identical for every viewer:
 * two moderators with different personal overrides see the same channel
 * state, and the channel's own override is never outranked by a viewer's
 * private tier.
 */
async function fetchAndConvertSettingsData(
  userClient: UserClient,
  personalityId: string | undefined,
  channelId: string
): Promise<SettingsData> {
  // Fetch channel's local overrides and the channel-scoped resolved cascade
  // in parallel. personalityId is passed through even when undefined — the
  // query param is optional and the resolver still applies hardcoded/admin/channel.
  const [channelOverridesResult, resolvedResult] = await Promise.all([
    userClient.getChannelConfigOverrides(channelId),
    userClient.resolveChannelCascade(channelId, { personalityId }),
  ]);

  const channelOverrides = channelOverridesResult.ok
    ? channelOverridesResult.data.configOverrides
    : null;

  const resolved: ResolvedConfigOverrides | null = resolvedResult.ok ? resolvedResult.data : null;

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

  logger.debug({ settingId, newValue, channelId, userId }, 'Updating setting');

  try {
    // Map setting ID to API body using shared utility
    const body = mapSettingToApiUpdate(settingId, newValue);

    if (body === null) {
      return { success: false, error: 'Unknown setting' };
    }

    const { userClient } = clientsFor(interaction);
    const result = await userClient.updateChannelConfigOverrides(channelId, body);

    if (!result.ok) {
      logger.warn({ settingId, error: result.error, channelId }, 'Update failed');
      return { success: false, error: result.error };
    }

    // Invalidate cache
    invalidateChannelSettingsCache(channelId);

    // Fetch fresh data with resolved values
    const channelSettings = await getChannelSettingsCached(channelId);
    const personalityId = channelSettings?.settings?.activatedPersonalityId ?? undefined;
    const newData = await fetchAndConvertSettingsData(userClient, personalityId, channelId);

    logger.info({ settingId, newValue, channelId, userId }, 'Setting updated');

    return { success: true, newData };
  } catch (error) {
    logger.error({ err: error, settingId, channelId }, 'Error updating setting');
    return { success: false, error: 'unexpected error, please try again' };
  }
}
