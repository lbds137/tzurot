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

import type {
  ButtonInteraction,
  StringSelectMenuInteraction,
  ModalSubmitInteraction,
} from 'discord.js';
import { PermissionFlagsBits } from 'discord.js';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import {
  createLogger,
  DISCORD_COLORS,
  HARDCODED_CONFIG_DEFAULTS,
  type ConfigOverrideSource,
  type ResolvedConfigOverrides,
  type ConfigOverrides,
} from '@tzurot/common-types';
import { callGatewayApi } from '../../utils/userGatewayClient.js';
import { GatewayClient, invalidateChannelSettingsCache } from '../../utils/GatewayClient.js';
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
  parseSettingsCustomId,
  EXTENDED_CONTEXT_SETTINGS,
  MEMORY_SETTINGS,
  mapSettingToApiUpdate,
} from '../../utils/dashboard/settings/index.js';

const logger = createLogger('channel-context');

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
const CHANNEL_CONTEXT_CONFIG: SettingsDashboardConfig = {
  level: 'channel',
  entityType: ENTITY_TYPE,
  titlePrefix: 'Channel',
  color: DISCORD_COLORS.BLURPLE,
  settings: [...EXTENDED_CONTEXT_SETTINGS, ...MEMORY_SETTINGS],
};

/**
 * Handle /channel context command - shows interactive dashboard
 *
 * @param context - DeferredCommandContext (already deferred by framework)
 */
export async function handleContext(context: DeferredCommandContext): Promise<void> {
  const { channelId, member, interaction } = context;
  const userId = context.user.id;

  // Check permissions: Manage Messages required
  if (member?.permissions.has(PermissionFlagsBits.ManageMessages) !== true) {
    await context.editReply({
      content: 'You need the **Manage Messages** permission to manage channel context settings.',
    });
    return;
  }

  logger.debug({ channelId, userId }, '[Channel Context] Opening dashboard');

  try {
    // Get the activated personality for this channel (needed for resolve endpoint)
    const gatewayClient = new GatewayClient();
    const channelSettings = await gatewayClient.getChannelSettings(channelId);
    const personalityId = channelSettings?.settings?.activatedPersonalityId ?? undefined;

    // Fetch resolved config with channel tier
    const data = await fetchAndConvertSettingsData(userId, personalityId, channelId);

    // When no personality is activated, the resolve endpoint can't be called so
    // effective values fall back to hardcoded defaults (admin/personality tiers missing).
    const config =
      personalityId === undefined
        ? {
            ...CHANNEL_CONTEXT_CONFIG,
            descriptionNote:
              '⚠️ No personality activated — effective values shown without full cascade context.',
          }
        : CHANNEL_CONTEXT_CONFIG;

    // Create and display the dashboard - uses interaction for Discord.js compatibility
    await createSettingsDashboard(interaction, {
      config,
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

    // Check if already replied via interaction (dashboard may have responded)
    if (!interaction.replied) {
      await context.editReply({
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
 * Map ConfigOverrideSource to dashboard SettingSource.
 * Both 'admin' and 'user-default' map to 'global' because from the channel
 * moderator's perspective, both are "outside this channel's control".
 */
function mapCascadeSource(source: ConfigOverrideSource): SettingSource {
  switch (source) {
    case 'admin':
    case 'user-default':
      return 'global';
    case 'personality':
      return 'personality';
    case 'channel':
      return 'channel';
    case 'user-personality':
      return 'user-personality';
    case 'hardcoded':
    default:
      return 'default';
  }
}

/**
 * Fetch resolved config from API and convert to dashboard SettingsData format.
 *
 * Gets the channel's own overrides (localValue) and the fully resolved values
 * (effectiveValue) with source tracking from the config cascade.
 */
async function fetchAndConvertSettingsData(
  userId: string,
  personalityId: string | undefined,
  channelId: string
): Promise<SettingsData> {
  // Fetch channel's local overrides and resolved cascade in parallel.
  // When no personality is activated, resolve is skipped (returns null).
  const resolvePromise =
    personalityId !== undefined
      ? callGatewayApi<ResolvedConfigOverrides>(
          `/user/config-overrides/resolve/${encodeURIComponent(personalityId)}?channelId=${encodeURIComponent(channelId)}`,
          { method: 'GET', userId }
        )
      : Promise.resolve(null);

  const [channelOverridesResult, resolvedResult] = await Promise.all([
    callGatewayApi<{ configOverrides: Record<string, unknown> | null }>(
      `/user/channel/${encodeURIComponent(channelId)}/config-overrides`,
      { method: 'GET', userId }
    ),
    resolvePromise,
  ]);

  const channelOverrides = channelOverridesResult.ok
    ? (channelOverridesResult.data.configOverrides as Partial<ConfigOverrides> | null)
    : null;

  const resolved = resolvedResult?.ok === true ? resolvedResult.data : null;

  return buildSettingsData(channelOverrides, resolved);
}

/**
 * Build SettingsData from channel overrides and resolved cascade.
 */
function buildSettingsData(
  channelOverrides: Partial<ConfigOverrides> | null,
  resolved: ResolvedConfigOverrides | null
): SettingsData {
  // Safety: HARDCODED_CONFIG_DEFAULTS covers all ConfigOverrides fields, so the
  // fallback always produces a real value. The `as T` casts are safe because
  // callers below match field names to their corresponding generic types.
  function buildValue<T>(field: keyof ConfigOverrides): SettingValue<T> {
    const localValue = (channelOverrides?.[field] ?? null) as T | null;
    const effectiveValue =
      resolved !== null
        ? (resolved[field as keyof ResolvedConfigOverrides] as T)
        : ((localValue ?? HARDCODED_CONFIG_DEFAULTS[field]) as T);
    const source =
      resolved !== null
        ? mapCascadeSource(resolved.sources[field])
        : localValue !== null
          ? ('channel' as SettingSource)
          : ('default' as SettingSource);
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

  logger.debug({ settingId, newValue, channelId, userId }, '[Channel Context] Updating setting');

  try {
    // Map setting ID to API body using shared utility
    const body = mapSettingToApiUpdate(settingId, newValue);

    if (body === null) {
      return { success: false, error: 'Unknown setting' };
    }

    // Send update to channel config-overrides endpoint
    const result = await callGatewayApi(
      `/user/channel/${encodeURIComponent(channelId)}/config-overrides`,
      { method: 'PATCH', body, userId }
    );

    if (!result.ok) {
      logger.warn({ settingId, error: result.error, channelId }, '[Channel Context] Update failed');
      return { success: false, error: result.error };
    }

    // Invalidate cache
    invalidateChannelSettingsCache(channelId);

    // Fetch fresh data with resolved values
    const gatewayClient = new GatewayClient();
    const channelSettings = await gatewayClient.getChannelSettings(channelId);
    const personalityId = channelSettings?.settings?.activatedPersonalityId ?? undefined;
    const newData = await fetchAndConvertSettingsData(userId, personalityId, channelId);

    logger.info({ settingId, newValue, channelId, userId }, '[Channel Context] Setting updated');

    return { success: true, newData };
  } catch (error) {
    logger.error({ err: error, settingId, channelId }, '[Channel Context] Error updating setting');
    return { success: false, error: 'Failed to update setting' };
  }
}
