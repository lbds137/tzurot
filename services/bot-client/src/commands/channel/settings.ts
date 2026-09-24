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
  type SettingsData,
  type SettingUpdateHandler,
  type SettingUpdateResult,
  type SettingsResetHandler,
  createSettingsDashboard,
  createSettingsCommandHandlers,
  VOICE_CASCADE_SETTINGS,
  buildCascadePages,
  mapSettingToApiUpdate,
  buildClearBody,
  buildCascadeSettingsData,
} from '../../utils/dashboard/settings/index.js';

const logger = createLogger('channel-settings');

/**
 * Entity type for custom IDs
 * Uses hyphen separator to avoid conflicts with :: delimiter
 * CommandHandler uses alias mapping to route 'channel-settings' → 'channel'
 */
const ENTITY_TYPE = 'channel-settings';

/** The shared D14 page grouping; a non-admin tier's Voice page is the cascade subset. */
const CASCADE_PAGES = buildCascadePages(VOICE_CASCADE_SETTINGS);

/**
 * Dashboard configuration for channel context settings.
 * Includes both extended context and memory settings — all are now wirable
 * via the channel tier of the config cascade — on the shared concern pages.
 */
export const CHANNEL_SETTINGS_CONFIG: SettingsDashboardConfig = {
  level: 'channel',
  entityType: ENTITY_TYPE,
  titlePrefix: 'Channel',
  color: DISCORD_COLORS.BLURPLE,
  settings: CASCADE_PAGES.settings,
  pages: CASCADE_PAGES.pages,
  // Reset all on the hub (plus Reset page on every page). This dashboard's
  // messages used to carry a scope-less whole-dashboard reset button; such a
  // message still resolves, as Reset all.
  resetAll: true,
  legacyBareResetMeansAll: true,
  scopeNote: () =>
    "📍 Applies to members in this channel who haven't set their own value. Personal settings override these.",
};

/** Shown on every render when the channel has no activated character. */
const NO_CHARACTER_NOTE =
  'ℹ️ No character activated — character-level defaults not included in cascade.';

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
    // The note rides the session (not a config copy) so every re-render keeps it.
    // Create and display the dashboard - uses interaction for Discord.js compatibility
    await createSettingsDashboard(interaction, {
      config: CHANNEL_SETTINGS_CONFIG,
      data,
      entityId: channelId,
      entityName: `<#${channelId}>`,
      userId,
      descriptionNote: personalityId === undefined ? NO_CHARACTER_NOTE : undefined,
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
 * Reset page and Reset all, which clear many overrides at once. It runs inside
 * `patchChannelOverrides`, the one write path both handlers share.
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
  return async (interaction, _session, settingId, newValue) => {
    // Map setting ID to API body using shared utility
    const body = mapSettingToApiUpdate(settingId, newValue);
    if (body === null) {
      return { success: false, error: 'Unknown setting' };
    }
    return patchChannelOverrides(interaction, channelId, body, { settingId, newValue });
  };
}

/**
 * Build a per-interaction batch clear (Reset page / Reset all) bound to a
 * specific channel ID: the listed settings' null mappings merged into ONE
 * PATCH through the same write path as a single setting — so the permission
 * re-check, the cache invalidation and the refetch each run once. Settings
 * the dashboard does not show are never named, so they are left as they are.
 */
function createResetHandler(channelId: string): SettingsResetHandler {
  return async (interaction, _session, settingIds) => {
    const body = buildClearBody(settingIds);
    if (body === null) {
      return { success: false, error: 'Unknown setting' };
    }
    return patchChannelOverrides(interaction, channelId, body, { settingIds });
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
 * The one channel-tier write path, shared by the single-setting handler and
 * the batch clear: re-check Manage Messages, PATCH the channel config-overrides
 * endpoint, invalidate the channel settings cache, and refetch the resolved
 * data. `logFields` names what was written (one setting, or the reset's ids).
 */
async function patchChannelOverrides(
  interaction: ButtonInteraction | ModalSubmitInteraction,
  channelId: string,
  body: Record<string, unknown>,
  logFields: Record<string, unknown>
): Promise<SettingUpdateResult> {
  const userId = interaction.user.id;

  const denied = denyIfPermissionRevoked(interaction);
  if (denied !== null) {
    logger.warn({ ...logFields, channelId, userId }, 'Update denied: permission revoked');
    return denied;
  }

  logger.debug({ ...logFields, channelId, userId }, 'Updating setting');

  try {
    const { userClient } = clientsFor(interaction);
    const result = await userClient.updateChannelConfigOverrides(channelId, body);

    if (!result.ok) {
      logger.warn({ ...logFields, error: result.error, channelId }, 'Update failed');
      return { success: false, error: result.error };
    }

    // Invalidate cache
    invalidateChannelSettingsCache(channelId);

    // Fetch fresh data with resolved values
    const channelSettings = await getChannelSettingsCached(channelId);
    const personalityId = channelSettings?.settings?.activatedPersonalityId ?? undefined;
    const newData = await fetchAndConvertSettingsData(userClient, personalityId, channelId);

    logger.info({ ...logFields, channelId, userId }, 'Setting updated');

    return { success: true, newData };
  } catch (error) {
    logger.error({ err: error, ...logFields, channelId }, 'Error updating setting');
    // Composed into `Failed to update: …` / `Failed to reset: …` upstream —
    // keep this a bare cause.
    return { success: false, error: 'unexpected error, please try again' };
  }
}
