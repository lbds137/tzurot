/**
 * Character Settings Dashboard (Creator/Owner Only)
 *
 * Interactive dashboard for managing personality-level config defaults.
 * Shows effective values from the 3-tier cascade (hardcoded → admin → personality)
 * with source indicators. Only the personality creator can edit these defaults.
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
  parseCharacterEntityId,
  EXTENDED_CONTEXT_SETTINGS,
  MEMORY_SETTINGS,
  DISPLAY_SETTINGS,
  mapSettingToApiUpdate,
  buildCascadeSettingsData,
} from '../../utils/dashboard/settings/index.js';

const logger = createLogger('character-settings');

/**
 * Entity type for custom IDs
 * Uses hyphen separator to avoid conflicts with :: delimiter
 * CommandHandler uses alias mapping to route 'character-settings' → 'character'
 */
const ENTITY_TYPE = 'character-settings';

/**
 * Dashboard configuration for character settings
 */
const CHARACTER_SETTINGS_CONFIG: SettingsDashboardConfig = {
  level: 'personality',
  entityType: ENTITY_TYPE,
  titlePrefix: 'Character',
  color: DISCORD_COLORS.BLURPLE,
  settings: [...EXTENDED_CONTEXT_SETTINGS, ...MEMORY_SETTINGS, ...DISPLAY_SETTINGS],
};

/**
 * Handle /character settings command - shows interactive dashboard
 */
export async function handleSettings(
  context: DeferredCommandContext,
  _config: EnvConfig
): Promise<void> {
  const options = characterSettingsOptions(context.interaction);
  const characterSlug = options.character();
  const userId = context.user.id;

  logger.debug({ characterSlug, userId }, '[Character Settings] Opening dashboard');

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
      logger.warn({ error: result.error, characterSlug }, '[Character Settings] Fetch failed');
      await context.editReply({
        content: '❌ Failed to load character data.',
      });
      return;
    }

    const personality = result.data.personality;

    // Resolve 3-tier cascade (hardcoded → admin → personality) for creator view
    const cascadeResult = await callGatewayApi<ResolvedConfigOverrides>(
      `/user/config-overrides/resolve-personality/${encodeURIComponent(personality.id)}`,
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
      config: CHARACTER_SETTINGS_CONFIG,
      data,
      entityId: `${characterSlug}--${personality.id}`,
      entityName: `${personality.name} (${personality.slug})`,
      userId,
      updateHandler: createUpdateHandler(characterSlug, personality.id),
    });

    logger.info({ characterSlug, userId }, '[Character Settings] Dashboard opened');
  } catch (error) {
    logger.error({ err: error, characterSlug }, '[Character Settings] Error opening dashboard');

    await context.editReply({
      content: '❌ An error occurred while opening the settings dashboard.',
    });
  }
}

/**
 * Handle select menu interactions for character settings
 */
export async function handleCharacterSettingsSelectMenu(
  interaction: StringSelectMenuInteraction
): Promise<void> {
  if (!isSettingsInteraction(interaction.customId, ENTITY_TYPE)) {
    return;
  }

  const parsed = parseSettingsCustomId(interaction.customId);
  const entityId = parsed?.entityId ?? null;
  if (entityId === null) {
    return;
  }

  const [characterSlug, personalityId] = parseCharacterEntityId(entityId);
  if (characterSlug === null) {
    return;
  }

  await handleSettingsSelectMenu(
    interaction,
    CHARACTER_SETTINGS_CONFIG,
    createUpdateHandler(characterSlug, personalityId)
  );
}

/**
 * Handle button interactions for character settings
 */
export async function handleCharacterSettingsButton(interaction: ButtonInteraction): Promise<void> {
  if (!isSettingsInteraction(interaction.customId, ENTITY_TYPE)) {
    return;
  }

  const parsed = parseSettingsCustomId(interaction.customId);
  const entityId = parsed?.entityId ?? null;
  if (entityId === null) {
    return;
  }

  const [characterSlug, personalityId] = parseCharacterEntityId(entityId);
  if (characterSlug === null) {
    return;
  }

  await handleSettingsButton(
    interaction,
    CHARACTER_SETTINGS_CONFIG,
    createUpdateHandler(characterSlug, personalityId)
  );
}

/**
 * Handle modal submissions for character settings
 */
export async function handleCharacterSettingsModal(
  interaction: ModalSubmitInteraction
): Promise<void> {
  if (!isSettingsInteraction(interaction.customId, ENTITY_TYPE)) {
    return;
  }

  const parsed = parseSettingsCustomId(interaction.customId);
  const entityId = parsed?.entityId ?? null;
  if (entityId === null) {
    return;
  }

  const [characterSlug, personalityId] = parseCharacterEntityId(entityId);
  if (characterSlug === null) {
    return;
  }

  await handleSettingsModal(
    interaction,
    CHARACTER_SETTINGS_CONFIG,
    createUpdateHandler(characterSlug, personalityId)
  );
}

/**
 * Check if a custom ID belongs to character settings dashboard
 */
export function isCharacterSettingsInteraction(customId: string): boolean {
  return isSettingsInteraction(customId, ENTITY_TYPE);
}

/**
 * Convert cascade-resolved overrides to dashboard SettingsData format.
 * Extracts local overrides by checking which fields the personality tier set.
 */
function convertToSettingsData(resolved: ResolvedConfigOverrides): SettingsData {
  const localOverrides: Partial<ConfigOverrides> = {};
  for (const [field, source] of Object.entries(resolved.sources)) {
    if (source === 'personality') {
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
    'personality'
  );
}

/**
 * Create a settings update handler bound to a specific character+personality.
 * Returns a 4-param handler matching the SettingsUpdateHandler signature.
 */
function createUpdateHandler(characterSlug: string, personalityId: string | null) {
  return (
    interaction: ButtonInteraction | ModalSubmitInteraction,
    _session: SettingsDashboardSession,
    settingId: string,
    newValue: unknown
  ): Promise<SettingUpdateResult> =>
    handleSettingUpdate(interaction, settingId, newValue, characterSlug, personalityId);
}

/**
 * Handle setting updates from the dashboard
 * Writes to personality-level config defaults via cascade endpoint (creator-only)
 */
async function handleSettingUpdate(
  interaction: ButtonInteraction | ModalSubmitInteraction,
  settingId: string,
  newValue: unknown,
  characterSlug: string,
  personalityId: string | null
): Promise<SettingUpdateResult> {
  const userId = interaction.user.id;

  if (personalityId === null) {
    return { success: false, error: 'Missing personality ID' };
  }

  logger.debug(
    { settingId, newValue, characterSlug, personalityId, userId },
    '[Character Settings] Updating setting'
  );

  try {
    // Map setting ID to cascade field
    const body = mapSettingToApiUpdate(settingId, newValue);

    if (body === null) {
      return { success: false, error: 'Unknown setting' };
    }

    // Write to personality-level config defaults (creator-only)
    const result = await callGatewayApi(
      `/user/config-overrides/personality/${encodeURIComponent(personalityId)}`,
      {
        method: 'PATCH',
        body,
        userId,
        timeout: GATEWAY_TIMEOUTS.DEFERRED,
      }
    );

    if (!result.ok) {
      logger.warn(
        { settingId, error: result.error, characterSlug },
        '[Character Settings] Update failed'
      );
      return { success: false, error: result.error };
    }

    // Re-resolve 3-tier cascade to get updated effective values
    const cascadeResult = await callGatewayApi<ResolvedConfigOverrides>(
      `/user/config-overrides/resolve-personality/${encodeURIComponent(personalityId)}`,
      { method: 'GET', userId, timeout: GATEWAY_TIMEOUTS.DEFERRED }
    );

    if (!cascadeResult.ok) {
      return { success: false, error: 'Failed to fetch updated settings' };
    }

    const newData = convertToSettingsData(cascadeResult.data);

    logger.info(
      { settingId, newValue, characterSlug, userId },
      '[Character Settings] Setting updated'
    );

    return { success: true, newData };
  } catch (error) {
    logger.error(
      { err: error, settingId, characterSlug },
      '[Character Settings] Error updating setting'
    );
    return { success: false, error: 'Failed to update setting' };
  }
}
