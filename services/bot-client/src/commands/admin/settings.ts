/**
 * Admin Settings Subcommand
 *
 * Manages global bot settings (owner only).
 *
 * Actions:
 * - extended-context-enable: Enable extended context globally by default
 * - extended-context-disable: Disable extended context globally by default
 * - list: Show all bot settings
 */

import type { ChatInputCommandInteraction } from 'discord.js';
import { createLogger, BotSettingKeys } from '@tzurot/common-types';
import { adminFetch, adminPutJson } from '../../utils/adminApiClient.js';

const logger = createLogger('admin-settings');

type SettingsAction = 'extended-context-enable' | 'extended-context-disable' | 'list';

interface BotSettingsListResponse {
  settings: {
    id: string;
    key: string;
    value: string;
    description: string | null;
    updatedAt: string;
  }[];
}

/**
 * Handle /admin settings command
 */
export async function handleSettings(interaction: ChatInputCommandInteraction): Promise<void> {
  const action = interaction.options.getString('action', true) as SettingsAction;
  const userId = interaction.user.id;

  logger.debug({ action, userId }, '[Admin Settings] Processing settings action');

  try {
    switch (action) {
      case 'extended-context-enable':
        await handleExtendedContextEnable(interaction);
        break;
      case 'extended-context-disable':
        await handleExtendedContextDisable(interaction);
        break;
      case 'list':
        await handleList(interaction);
        break;
      default:
        await interaction.editReply({
          content: `Unknown action: ${action as string}`,
        });
    }
  } catch (error) {
    logger.error({ err: error, action }, '[Admin Settings] Error handling settings action');

    // Only respond if we haven't already (deferReply is handled by top-level handler)
    if (!interaction.replied) {
      await interaction.editReply({
        content: 'An error occurred while processing your request.',
      });
    }
  }
}

/**
 * Enable extended context globally by default
 */
async function handleExtendedContextEnable(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  // Note: deferReply is handled by top-level interactionCreate handler

  const response = await adminPutJson(
    `/admin/settings/${BotSettingKeys.EXTENDED_CONTEXT_DEFAULT}`,
    {
      value: 'true',
      description: 'Default extended context setting for channels without explicit override',
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    logger.warn(
      { status: response.status, error: errorText },
      '[Admin Settings] Failed to enable extended context'
    );
    await interaction.editReply({
      content: `Failed to update setting: ${errorText}`,
    });
    return;
  }

  logger.info('[Admin Settings] Extended context enabled globally');
  await interaction.editReply({
    content:
      '**Extended context enabled globally by default**.\n\n' +
      'All channels without explicit overrides will now have extended context enabled.\n' +
      'Personalities will see recent channel messages (up to 100) when responding.',
  });
}

/**
 * Disable extended context globally by default
 */
async function handleExtendedContextDisable(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  // Note: deferReply is handled by top-level interactionCreate handler

  const response = await adminPutJson(
    `/admin/settings/${BotSettingKeys.EXTENDED_CONTEXT_DEFAULT}`,
    {
      value: 'false',
      description: 'Default extended context setting for channels without explicit override',
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    logger.warn(
      { status: response.status, error: errorText },
      '[Admin Settings] Failed to disable extended context'
    );
    await interaction.editReply({
      content: `Failed to update setting: ${errorText}`,
    });
    return;
  }

  logger.info('[Admin Settings] Extended context disabled globally');
  await interaction.editReply({
    content:
      '**Extended context disabled globally by default**.\n\n' +
      'All channels without explicit overrides will now have extended context disabled.\n' +
      'Personalities will only see their own conversation history.',
  });
}

/**
 * List all bot settings
 */
async function handleList(interaction: ChatInputCommandInteraction): Promise<void> {
  // Note: deferReply is handled by top-level interactionCreate handler

  const response = await adminFetch('/admin/settings', {
    method: 'GET',
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.warn(
      { status: response.status, error: errorText },
      '[Admin Settings] Failed to list settings'
    );
    await interaction.editReply({
      content: `Failed to list settings: ${errorText}`,
    });
    return;
  }

  const data = (await response.json()) as BotSettingsListResponse;

  if (data.settings.length === 0) {
    await interaction.editReply({
      content: '**Bot Settings**\n\nNo settings configured yet.',
    });
    return;
  }

  const settingsText = data.settings
    .map(s => {
      const updatedAt = new Date(s.updatedAt).toLocaleDateString();
      return `**${s.key}**: \`${s.value}\`\n  ${s.description ?? 'No description'} (updated: ${updatedAt})`;
    })
    .join('\n\n');

  await interaction.editReply({
    content: `**Bot Settings**\n\n${settingsText}`,
  });
}
