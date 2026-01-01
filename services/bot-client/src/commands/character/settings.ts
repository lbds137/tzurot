/**
 * Character Settings Subcommand
 *
 * Manages character-level settings (owner only).
 *
 * Actions:
 * - extended-context-enable: Force enable extended context for this character
 * - extended-context-disable: Force disable extended context for this character
 * - extended-context-auto: Follow channel/global settings (remove override)
 * - show: Show current settings
 *
 * @see docs/standards/TRI_STATE_PATTERN.md
 */

import type { ChatInputCommandInteraction } from 'discord.js';
import { createLogger, type EnvConfig } from '@tzurot/common-types';
import { callGatewayApi } from '../../utils/userGatewayClient.js';
import { GatewayClient } from '../../utils/GatewayClient.js';
import {
  buildTriStateStatusMessage,
  buildTriStateUpdateMessage,
  EXTENDED_CONTEXT_DESCRIPTION,
} from '../../utils/triStateHelpers.js';
import type { ExtendedContextSource } from '../../services/ExtendedContextResolver.js';

const logger = createLogger('character-settings');

type SettingsAction =
  | 'extended-context-enable'
  | 'extended-context-disable'
  | 'extended-context-auto'
  | 'show';

interface PersonalityResponse {
  personality: {
    id: string;
    name: string;
    slug: string;
    /** Tri-state: null=auto, true=on, false=off */
    extendedContext: boolean | null;
    ownerId: string | null;
  };
}

/**
 * Handle /character settings command
 */
export async function handleSettings(
  interaction: ChatInputCommandInteraction,
  _config: EnvConfig
): Promise<void> {
  const action = interaction.options.getString('action', true) as SettingsAction;
  const characterSlug = interaction.options.getString('character', true);
  const userId = interaction.user.id;

  logger.debug(
    { action, characterSlug, userId },
    '[Character Settings] Processing settings action'
  );

  try {
    switch (action) {
      case 'extended-context-enable':
        await handleExtendedContextUpdate(interaction, characterSlug, userId, true);
        break;
      case 'extended-context-disable':
        await handleExtendedContextUpdate(interaction, characterSlug, userId, false);
        break;
      case 'extended-context-auto':
        await handleExtendedContextUpdate(interaction, characterSlug, userId, null);
        break;
      case 'show':
        await handleShow(interaction, characterSlug, userId);
        break;
      default:
        await interaction.editReply({
          content: `Unknown action: ${action as string}`,
        });
    }
  } catch (error) {
    logger.error(
      { err: error, action, characterSlug },
      '[Character Settings] Error handling settings action'
    );

    // Only respond if we haven't already (deferReply is handled by top-level handler)
    if (!interaction.replied) {
      await interaction.editReply({
        content: 'An error occurred while processing your request.',
      });
    }
  }
}

/**
 * Update extended context setting for this character
 * @param value - true=ON, false=OFF, null=AUTO
 */
async function handleExtendedContextUpdate(
  interaction: ChatInputCommandInteraction,
  characterSlug: string,
  userId: string,
  value: boolean | null
): Promise<void> {
  // Note: deferReply is handled by top-level interactionCreate handler

  const result = await callGatewayApi(`/user/personality/${characterSlug}`, {
    method: 'PUT',
    body: { extendedContext: value },
    userId,
  });

  if (!result.ok) {
    if (result.status === 401) {
      await interaction.editReply({
        content: 'You do not have permission to edit this character.',
      });
      return;
    }
    if (result.status === 404) {
      await interaction.editReply({
        content: `Character "${characterSlug}" not found.`,
      });
      return;
    }
    logger.warn(
      { characterSlug, status: result.status, error: result.error, value },
      '[Character Settings] Failed to update extended context'
    );
    await interaction.editReply({
      content: `Failed to update setting: ${result.error}`,
    });
    return;
  }

  // For auto mode, get the effective value to show what it resolves to
  let effectiveEnabled: boolean | undefined;
  let source: string | undefined;

  if (value === null) {
    // Get global default since personality is now AUTO
    const gatewayClient = new GatewayClient();
    const globalDefault = await gatewayClient.getExtendedContextDefault();
    effectiveEnabled = globalDefault;
    source = 'global';
  }

  const actionLabel = value === true ? 'enabled' : value === false ? 'disabled' : 'set to auto';
  logger.info(
    { characterSlug, userId, value },
    `[Character Settings] Extended context ${actionLabel}`
  );

  await interaction.editReply({
    content: buildTriStateUpdateMessage({
      settingName: 'Extended Context',
      targetName: characterSlug,
      newValue: value,
      effectiveEnabled,
      source,
      targetType: 'character',
    }),
  });
}

/**
 * Show current character settings
 */
async function handleShow(
  interaction: ChatInputCommandInteraction,
  characterSlug: string,
  userId: string
): Promise<void> {
  // Note: deferReply is handled by top-level interactionCreate handler

  const result = await callGatewayApi<PersonalityResponse>(`/user/personality/${characterSlug}`, {
    method: 'GET',
    userId,
  });

  if (!result.ok) {
    if (result.status === 404) {
      await interaction.editReply({
        content: `Character "${characterSlug}" not found.`,
      });
      return;
    }
    logger.warn(
      { characterSlug, status: result.status, error: result.error },
      '[Character Settings] Failed to get character'
    );
    await interaction.editReply({
      content: `Failed to get character: ${result.error}`,
    });
    return;
  }

  const personality = result.data.personality;

  // Determine current value and source
  const currentValue: boolean | null = personality.extendedContext;
  let effectiveEnabled: boolean;
  let source: ExtendedContextSource;

  if (currentValue === true) {
    // Personality is ON - always enabled
    effectiveEnabled = true;
    source = 'personality';
  } else if (currentValue === false) {
    // Personality is OFF - always disabled
    effectiveEnabled = false;
    source = 'personality';
  } else {
    // Personality is AUTO (null) - show global default
    // Note: We can't show channel-specific resolution here since we don't know which channel
    const gatewayClient = new GatewayClient();
    const globalDefault = await gatewayClient.getExtendedContextDefault();
    effectiveEnabled = globalDefault;
    source = 'global';
  }

  await interaction.editReply({
    content: buildTriStateStatusMessage({
      settingName: 'Extended Context',
      targetName: personality.name,
      currentValue,
      effectiveEnabled,
      source,
      description: EXTENDED_CONTEXT_DESCRIPTION,
    }),
  });
}
