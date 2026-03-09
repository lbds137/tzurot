/**
 * Character Overrides Dashboard
 *
 * Interactive dashboard for managing per-user per-personality config overrides.
 * Shows effective values from the full cascade with source indicators.
 * Any user can set their own overrides for any personality.
 *
 * Settings:
 * - Max Messages: 1-100 or Auto
 * - Max Age: Duration, Off, or Auto
 * - Max Images: 0-20 or Auto
 */

import type {
  ButtonInteraction,
  StringSelectMenuInteraction,
  ModalSubmitInteraction,
} from 'discord.js';
import {
  createLogger,
  DISCORD_COLORS,
  GATEWAY_TIMEOUTS,
  type EnvConfig,
  type ConfigOverrides,
  type ResolvedConfigOverrides,
  characterSettingsOptions,
} from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { callGatewayApi } from '../../utils/userGatewayClient.js';
import {
  type SettingsData,
  type SettingsDashboardConfig,
  type SettingsDashboardSession,
  type SettingUpdateResult,
  type PersonalityResponse,
  createSettingsDashboard,
  handleSettingsSelectMenu,
  handleSettingsButton,
  handleSettingsModal,
  isSettingsInteraction,
  parseSettingsCustomId,
  EXTENDED_CONTEXT_SETTINGS,
  MEMORY_SETTINGS,
  DISPLAY_SETTINGS,
  VOICE_CASCADE_SETTINGS,
  mapSettingToApiUpdate,
  buildCascadeSettingsData,
} from '../../utils/dashboard/settings/index.js';

const logger = createLogger('character-overrides');

/**
 * Entity type for custom IDs
 * Uses hyphen separator to avoid conflicts with :: delimiter
 * CommandHandler uses alias mapping to route 'character-overrides' → 'character'
 */
const ENTITY_TYPE = 'character-overrides';

/**
 * Dashboard configuration for character overrides
 */
const CHARACTER_OVERRIDES_CONFIG: SettingsDashboardConfig = {
  level: 'personality',
  entityType: ENTITY_TYPE,
  titlePrefix: 'Character Override',
  color: DISCORD_COLORS.BLURPLE,
  settings: [
    ...EXTENDED_CONTEXT_SETTINGS,
    ...MEMORY_SETTINGS,
    ...DISPLAY_SETTINGS,
    ...VOICE_CASCADE_SETTINGS,
  ],
};

/**
 * Handle /character overrides command - shows interactive dashboard
 */
export async function handleOverrides(
  context: DeferredCommandContext,
  _config: EnvConfig
): Promise<void> {
  // Reuse characterSettingsOptions — same option shape (character: string)
  const options = characterSettingsOptions(context.interaction);
  const characterSlug = options.character();
  const userId = context.user.id;

  logger.debug({ characterSlug, userId }, '[Character Overrides] Opening dashboard');

  try {
    // Fetch current character data from API gateway
    const result = await callGatewayApi<PersonalityResponse>(`/user/personality/${characterSlug}`, {
      method: 'GET',
      userId,
      timeout: GATEWAY_TIMEOUTS.DEFERRED,
    });

    if (!result.ok) {
      if (result.status === 404) {
        await context.editReply({
          content: `❌ Character "${characterSlug}" not found.`,
        });
        return;
      }
      logger.warn({ error: result.error, characterSlug }, '[Character Overrides] Fetch failed');
      await context.editReply({
        content: '❌ Failed to load character data.',
      });
      return;
    }

    const personality = result.data.personality;

    // Resolve full cascade overrides for this user+personality
    const cascadeResult = await callGatewayApi<ResolvedConfigOverrides>(
      `/user/config-overrides/resolve/${encodeURIComponent(personality.id)}`,
      { method: 'GET', userId, timeout: GATEWAY_TIMEOUTS.DEFERRED }
    );

    if (!cascadeResult.ok) {
      await context.editReply({
        content: '❌ Failed to fetch config settings.',
      });
      return;
    }

    // Convert resolved cascade to dashboard data format
    const data = convertToSettingsData(cascadeResult.data);

    // Create and display the dashboard
    await createSettingsDashboard(context.interaction, {
      config: CHARACTER_OVERRIDES_CONFIG,
      data,
      entityId: personality.id,
      entityName: `${personality.name} (${personality.slug})`,
      userId,
      updateHandler: createUpdateHandler(personality.id),
    });

    logger.info({ characterSlug, userId }, '[Character Overrides] Dashboard opened');
  } catch (error) {
    logger.error({ err: error, characterSlug }, '[Character Overrides] Error opening dashboard');

    await context.editReply({
      content: '❌ An error occurred while opening the overrides dashboard.',
    });
  }
}

/**
 * Handle select menu interactions for character overrides
 */
export async function handleCharacterOverridesSelectMenu(
  interaction: StringSelectMenuInteraction
): Promise<void> {
  if (!isSettingsInteraction(interaction.customId, ENTITY_TYPE)) {
    return;
  }

  const parsed = parseSettingsCustomId(interaction.customId);
  const personalityId = parsed?.entityId ?? null;
  if (personalityId === null) {
    return;
  }

  await handleSettingsSelectMenu(
    interaction,
    CHARACTER_OVERRIDES_CONFIG,
    createUpdateHandler(personalityId)
  );
}

/**
 * Handle button interactions for character overrides
 */
export async function handleCharacterOverridesButton(
  interaction: ButtonInteraction
): Promise<void> {
  if (!isSettingsInteraction(interaction.customId, ENTITY_TYPE)) {
    return;
  }

  const parsed = parseSettingsCustomId(interaction.customId);
  const personalityId = parsed?.entityId ?? null;
  if (personalityId === null) {
    return;
  }

  await handleSettingsButton(
    interaction,
    CHARACTER_OVERRIDES_CONFIG,
    createUpdateHandler(personalityId)
  );
}

/**
 * Handle modal submissions for character overrides
 */
export async function handleCharacterOverridesModal(
  interaction: ModalSubmitInteraction
): Promise<void> {
  if (!isSettingsInteraction(interaction.customId, ENTITY_TYPE)) {
    return;
  }

  const parsed = parseSettingsCustomId(interaction.customId);
  const personalityId = parsed?.entityId ?? null;
  if (personalityId === null) {
    return;
  }

  await handleSettingsModal(
    interaction,
    CHARACTER_OVERRIDES_CONFIG,
    createUpdateHandler(personalityId)
  );
}

/**
 * Check if a custom ID belongs to character overrides dashboard
 */
export function isCharacterOverridesInteraction(customId: string): boolean {
  return isSettingsInteraction(customId, ENTITY_TYPE);
}

/**
 * Convert cascade-resolved overrides to dashboard SettingsData format.
 * Extracts local overrides by checking which fields the user-personality tier set.
 */
function convertToSettingsData(resolved: ResolvedConfigOverrides): SettingsData {
  const localOverrides: Partial<ConfigOverrides> = {};
  for (const [field, source] of Object.entries(resolved.sources)) {
    if (source === 'user-personality') {
      // Safe: we only iterate config field keys from resolved.sources, never the
      // `sources` key itself, so the indexed value is always a config primitive.
      // `as never` satisfies the union type that includes Record<string, string>.
      localOverrides[field as keyof ConfigOverrides] = resolved[
        field as keyof ResolvedConfigOverrides
      ] as never;
    }
  }
  return buildCascadeSettingsData(
    resolved,
    Object.keys(localOverrides).length > 0 ? localOverrides : null,
    'user-personality'
  );
}

/**
 * Create a settings update handler bound to a specific personality.
 * Returns a 4-param handler matching the SettingsUpdateHandler signature.
 */
function createUpdateHandler(personalityId: string) {
  return (
    interaction: ButtonInteraction | ModalSubmitInteraction,
    _session: SettingsDashboardSession,
    settingId: string,
    newValue: unknown
  ): Promise<SettingUpdateResult> =>
    handleSettingUpdate(interaction, settingId, newValue, personalityId);
}

/**
 * Handle setting updates from the dashboard
 * Writes to user's per-personality config overrides via cascade endpoint
 */
async function handleSettingUpdate(
  interaction: ButtonInteraction | ModalSubmitInteraction,
  settingId: string,
  newValue: unknown,
  personalityId: string
): Promise<SettingUpdateResult> {
  const userId = interaction.user.id;

  logger.debug(
    { settingId, newValue, personalityId, userId },
    '[Character Overrides] Updating setting'
  );

  try {
    // Map setting ID to cascade field
    const body = mapSettingToApiUpdate(settingId, newValue);

    if (body === null) {
      return { success: false, error: 'Unknown setting' };
    }

    // Write to per-personality config overrides
    const result = await callGatewayApi(
      `/user/config-overrides/${encodeURIComponent(personalityId)}`,
      {
        method: 'PATCH',
        body,
        userId,
        timeout: GATEWAY_TIMEOUTS.DEFERRED,
      }
    );

    if (!result.ok) {
      logger.warn(
        { settingId, error: result.error, personalityId },
        '[Character Overrides] Update failed'
      );
      return { success: false, error: result.error };
    }

    // Re-resolve cascade to get updated effective values
    const cascadeResult = await callGatewayApi<ResolvedConfigOverrides>(
      `/user/config-overrides/resolve/${encodeURIComponent(personalityId)}`,
      { method: 'GET', userId, timeout: GATEWAY_TIMEOUTS.DEFERRED }
    );

    if (!cascadeResult.ok) {
      return { success: false, error: 'Failed to fetch updated settings' };
    }

    const newData = convertToSettingsData(cascadeResult.data);

    logger.info(
      { settingId, newValue, personalityId, userId },
      '[Character Overrides] Setting updated'
    );

    return { success: true, newData };
  } catch (error) {
    logger.error(
      { err: error, settingId, personalityId },
      '[Character Overrides] Error updating setting'
    );
    return { success: false, error: 'Failed to update setting' };
  }
}
