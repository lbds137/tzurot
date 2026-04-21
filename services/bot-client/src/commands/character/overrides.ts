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

/** Config for the character overrides update handler (full user-personality cascade) */
const CHARACTER_OVERRIDES_UPDATE_CONFIG = {
  patchEndpoint: (id: string) => `/user/config-overrides/${encodeURIComponent(id)}`,
  resolveEndpoint: (id: string) => `/user/config-overrides/resolve/${encodeURIComponent(id)}`,
  sourceTier: 'user-personality' as const,
  logContext: '[Character Overrides]',
};

function createUpdateHandler(personalityId: string): SettingUpdateHandler {
  return createSettingsUpdateHandler(personalityId, CHARACTER_OVERRIDES_UPDATE_CONFIG);
}

function convertToSettingsData(resolved: ResolvedConfigOverrides): SettingsData {
  return convertCascadeToSettingsData(resolved, 'user-personality');
}

// Interaction routers — generated by the shared factory so the 19-line
// guard/parse/forward pattern lives in exactly one place. See
// services/bot-client/src/utils/dashboard/settings/createSettingsCommandHandlers.ts
const characterOverridesHandlers = createSettingsCommandHandlers({
  entityType: ENTITY_TYPE,
  settingsConfig: CHARACTER_OVERRIDES_CONFIG,
  createUpdateHandler,
});

export const handleCharacterOverridesSelectMenu = characterOverridesHandlers.handleSelectMenu;
export const handleCharacterOverridesButton = characterOverridesHandlers.handleButton;
export const handleCharacterOverridesModal = characterOverridesHandlers.handleModal;
export const isCharacterOverridesInteraction = characterOverridesHandlers.isInteraction;
