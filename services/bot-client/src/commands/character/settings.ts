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

import {
  createLogger,
  DISCORD_COLORS,
  GATEWAY_TIMEOUTS,
  type EnvConfig,
  type ResolvedConfigOverrides,
  characterSettingsOptions,
} from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { callGatewayApi, toGatewayUser } from '../../utils/userGatewayClient.js';
import {
  type SettingsData,
  type SettingsDashboardConfig,
  type SettingUpdateHandler,
  type PersonalityResponse,
  createSettingsDashboard,
  createSettingsCommandHandlers,
  EXTENDED_CONTEXT_SETTINGS,
  MEMORY_SETTINGS,
  DISPLAY_SETTINGS,
  VOICE_CASCADE_SETTINGS,
} from '../../utils/dashboard/settings/index.js';
import {
  createSettingsUpdateHandler,
  convertCascadeToSettingsData,
} from '../../utils/dashboard/settings/settingsUpdateFactory.js';

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
  settings: [
    ...EXTENDED_CONTEXT_SETTINGS,
    ...MEMORY_SETTINGS,
    ...DISPLAY_SETTINGS,
    ...VOICE_CASCADE_SETTINGS,
  ],
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

  logger.debug({ characterSlug, userId }, 'Opening dashboard');

  try {
    // Fetch current character data from API gateway
    const result = await callGatewayApi<PersonalityResponse>(
      `/user/personality/${encodeURIComponent(characterSlug)}`,
      {
        method: 'GET',
        user: toGatewayUser(context.user),
        timeout: GATEWAY_TIMEOUTS.DEFERRED,
      }
    );

    if (!result.ok) {
      if (result.status === 404) {
        await context.editReply({
          content: `❌ Character "${characterSlug}" not found.`,
        });
        return;
      }
      logger.warn({ error: result.error, characterSlug }, 'Fetch failed');
      await context.editReply({
        content: '❌ Failed to load character data.',
      });
      return;
    }

    const personality = result.data.personality;

    // Resolve 3-tier cascade (hardcoded → admin → personality) for creator view
    const cascadeResult = await callGatewayApi<ResolvedConfigOverrides>(
      `/user/config-overrides/resolve-personality/${encodeURIComponent(personality.id)}`,
      { method: 'GET', user: toGatewayUser(context.user), timeout: GATEWAY_TIMEOUTS.DEFERRED }
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
      entityId: personality.id,
      entityName: `${personality.name} (${personality.slug})`,
      userId,
      updateHandler: createUpdateHandler(personality.id),
    });

    logger.info({ characterSlug, userId }, 'Dashboard opened');
  } catch (error) {
    logger.error({ err: error, characterSlug }, 'Error opening dashboard');

    await context.editReply({
      content: '❌ An error occurred while opening the settings dashboard.',
    });
  }
}

/** Config for the character settings update handler (3-tier cascade, creator-only) */
const CHARACTER_SETTINGS_UPDATE_CONFIG = {
  patchEndpoint: (id: string) => `/user/config-overrides/personality/${encodeURIComponent(id)}`,
  resolveEndpoint: (id: string) =>
    `/user/config-overrides/resolve-personality/${encodeURIComponent(id)}`,
  sourceTier: 'personality' as const,
  logContext: '[Character Settings]',
};

function createUpdateHandler(personalityId: string): SettingUpdateHandler {
  return createSettingsUpdateHandler(personalityId, CHARACTER_SETTINGS_UPDATE_CONFIG);
}

function convertToSettingsData(resolved: ResolvedConfigOverrides): SettingsData {
  return convertCascadeToSettingsData(resolved, 'personality');
}

// Interaction routers — generated by the shared factory so the 19-line
// guard/parse/forward pattern lives in exactly one place. See
// services/bot-client/src/utils/dashboard/settings/createSettingsCommandHandlers.ts
const characterSettingsHandlers = createSettingsCommandHandlers({
  entityType: ENTITY_TYPE,
  settingsConfig: CHARACTER_SETTINGS_CONFIG,
  createUpdateHandler,
});

export const handleCharacterSettingsSelectMenu = characterSettingsHandlers.handleSelectMenu;
export const handleCharacterSettingsButton = characterSettingsHandlers.handleButton;
export const handleCharacterSettingsModal = characterSettingsHandlers.handleModal;
export const isCharacterSettingsInteraction = characterSettingsHandlers.isInteraction;
