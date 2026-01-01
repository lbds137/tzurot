/**
 * Character Settings Subcommand
 *
 * Manages character-level settings (owner only).
 *
 * Actions:
 * - extended-context-enable: Allow extended context for this character
 * - extended-context-disable: Disable extended context for this character
 * - show: Show current settings
 */

import type { ChatInputCommandInteraction } from 'discord.js';
import { createLogger, type EnvConfig } from '@tzurot/common-types';
import { callGatewayApi } from '../../utils/userGatewayClient.js';

const logger = createLogger('character-settings');

type SettingsAction = 'extended-context-enable' | 'extended-context-disable' | 'show';

interface PersonalityResponse {
  personality: {
    id: string;
    name: string;
    slug: string;
    supportsExtendedContext: boolean;
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
        await handleExtendedContextEnable(interaction, characterSlug, userId);
        break;
      case 'extended-context-disable':
        await handleExtendedContextDisable(interaction, characterSlug, userId);
        break;
      case 'show':
        await handleShow(interaction, characterSlug, userId);
        break;
      default:
        await interaction.reply({
          content: `Unknown action: ${action as string}`,
          ephemeral: true,
        });
    }
  } catch (error) {
    logger.error(
      { err: error, action, characterSlug },
      '[Character Settings] Error handling settings action'
    );

    if (interaction.deferred) {
      await interaction.editReply({
        content: 'An error occurred while processing your request.',
      });
    } else {
      await interaction.reply({
        content: 'An error occurred while processing your request.',
        ephemeral: true,
      });
    }
  }
}

/**
 * Enable extended context for this character
 */
async function handleExtendedContextEnable(
  interaction: ChatInputCommandInteraction,
  characterSlug: string,
  userId: string
): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const result = await callGatewayApi(`/user/personality/${characterSlug}`, {
    method: 'PUT',
    body: { supportsExtendedContext: true },
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
      { characterSlug, status: result.status, error: result.error },
      '[Character Settings] Failed to enable extended context'
    );
    await interaction.editReply({
      content: `Failed to update setting: ${result.error}`,
    });
    return;
  }

  logger.info({ characterSlug, userId }, '[Character Settings] Extended context enabled');
  await interaction.editReply({
    content:
      `**Extended context enabled** for **${characterSlug}**.\n\n` +
      'This character can now see recent channel messages (up to 100) when responding ' +
      '(if the channel has extended context enabled).',
  });
}

/**
 * Disable extended context for this character
 */
async function handleExtendedContextDisable(
  interaction: ChatInputCommandInteraction,
  characterSlug: string,
  userId: string
): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const result = await callGatewayApi(`/user/personality/${characterSlug}`, {
    method: 'PUT',
    body: { supportsExtendedContext: false },
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
      { characterSlug, status: result.status, error: result.error },
      '[Character Settings] Failed to disable extended context'
    );
    await interaction.editReply({
      content: `Failed to update setting: ${result.error}`,
    });
    return;
  }

  logger.info({ characterSlug, userId }, '[Character Settings] Extended context disabled');
  await interaction.editReply({
    content:
      `**Extended context disabled** for **${characterSlug}**.\n\n` +
      'This character will no longer see recent channel messages, ' +
      'only its own conversation history.',
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
  await interaction.deferReply({ ephemeral: true });

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

  const extendedContextStatus = personality.supportsExtendedContext
    ? '**Enabled**'
    : '**Disabled**';

  await interaction.editReply({
    content:
      `**Settings for ${personality.name}**\n\n` +
      `Extended Context: ${extendedContextStatus}\n\n` +
      `Extended context allows this character to see recent channel messages ` +
      `(up to 100) when responding, if the channel also has extended context enabled.`,
  });
}
