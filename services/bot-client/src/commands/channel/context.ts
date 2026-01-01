/**
 * Channel Context Subcommand
 *
 * Manages extended context settings for channels.
 * Extended context allows personalities to see recent channel messages
 * beyond just bot conversations stored in the database.
 *
 * Actions:
 * - enable: Enable extended context for this channel
 * - disable: Disable extended context for this channel
 * - status: Show current extended context setting
 * - clear: Remove channel override (use global default)
 */

import type { ChatInputCommandInteraction } from 'discord.js';
import { PermissionFlagsBits } from 'discord.js';
import { createLogger } from '@tzurot/common-types';
import { callGatewayApi } from '../../utils/userGatewayClient.js';
import { GatewayClient, invalidateChannelSettingsCache } from '../../utils/GatewayClient.js';

const logger = createLogger('channel-context');

type ContextAction = 'enable' | 'disable' | 'status' | 'clear';

/**
 * Handle /channel context command
 */
export async function handleContext(interaction: ChatInputCommandInteraction): Promise<void> {
  const action = interaction.options.getString('action', true) as ContextAction;
  const channelId = interaction.channelId;
  const userId = interaction.user.id;

  // Check permissions: Manage Messages required
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) {
    await interaction.reply({
      content: 'You need the **Manage Messages** permission to manage channel context settings.',
      ephemeral: true,
    });
    return;
  }

  logger.debug(
    { action, channelId, userId },
    '[Channel Context] Processing context action'
  );

  try {
    switch (action) {
      case 'enable':
        await handleEnable(interaction, channelId, userId);
        break;
      case 'disable':
        await handleDisable(interaction, channelId, userId);
        break;
      case 'status':
        await handleStatus(interaction, channelId);
        break;
      case 'clear':
        await handleClear(interaction, channelId, userId);
        break;
      default:
        await interaction.reply({
          content: `Unknown action: ${action as string}`,
          ephemeral: true,
        });
    }
  } catch (error) {
    logger.error({ err: error, action, channelId }, '[Channel Context] Error handling context action');
    await interaction.reply({
      content: 'An error occurred while processing your request.',
      ephemeral: true,
    });
  }
}

/**
 * Enable extended context for this channel
 */
async function handleEnable(
  interaction: ChatInputCommandInteraction,
  channelId: string,
  userId: string
): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const response = await callGatewayApi(`/user/channel/${channelId}/extended-context`, {
    method: 'PATCH',
    body: JSON.stringify({ extendedContext: true }),
    userId,
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.warn({ channelId, status: response.status, error: errorText }, '[Channel Context] Failed to enable');
    await interaction.editReply({
      content: `Failed to enable extended context: ${errorText}`,
    });
    return;
  }

  // Invalidate cache for this channel
  invalidateChannelSettingsCache(channelId);

  logger.info({ channelId, userId }, '[Channel Context] Extended context enabled');
  await interaction.editReply({
    content: '**Extended context enabled** for this channel.\n\nPersonalities will now see recent channel messages (up to 100) when responding, providing better context for conversations.',
  });
}

/**
 * Disable extended context for this channel
 */
async function handleDisable(
  interaction: ChatInputCommandInteraction,
  channelId: string,
  userId: string
): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const response = await callGatewayApi(`/user/channel/${channelId}/extended-context`, {
    method: 'PATCH',
    body: JSON.stringify({ extendedContext: false }),
    userId,
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.warn({ channelId, status: response.status, error: errorText }, '[Channel Context] Failed to disable');
    await interaction.editReply({
      content: `Failed to disable extended context: ${errorText}`,
    });
    return;
  }

  // Invalidate cache for this channel
  invalidateChannelSettingsCache(channelId);

  logger.info({ channelId, userId }, '[Channel Context] Extended context disabled');
  await interaction.editReply({
    content: '**Extended context disabled** for this channel.\n\nPersonalities will only see their own conversation history when responding.',
  });
}

/**
 * Show current extended context status
 */
async function handleStatus(
  interaction: ChatInputCommandInteraction,
  channelId: string
): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const gatewayClient = new GatewayClient();
  const settings = await gatewayClient.getChannelSettings(channelId);
  const globalDefault = await gatewayClient.getExtendedContextDefault();

  let status: string;
  let source: string;
  let enabled: boolean;

  if (settings?.hasSettings === true && settings.settings?.extendedContext !== null && settings.settings?.extendedContext !== undefined) {
    // Channel has explicit setting
    enabled = settings.settings.extendedContext;
    source = 'channel override';
  } else {
    // Using global default
    enabled = globalDefault;
    source = 'global default';
  }

  status = enabled ? '**Enabled**' : '**Disabled**';

  await interaction.editReply({
    content: `**Extended Context Status**\n\n` +
      `Current setting: ${status}\n` +
      `Source: ${source}\n` +
      `Global default: ${globalDefault ? 'enabled' : 'disabled'}\n\n` +
      `Extended context allows personalities to see recent channel messages (up to 100) for better conversational awareness.`,
  });
}

/**
 * Clear channel override (use global default)
 */
async function handleClear(
  interaction: ChatInputCommandInteraction,
  channelId: string,
  userId: string
): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const response = await callGatewayApi(`/user/channel/${channelId}/extended-context`, {
    method: 'PATCH',
    body: JSON.stringify({ extendedContext: null }),
    userId,
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.warn({ channelId, status: response.status, error: errorText }, '[Channel Context] Failed to clear');
    await interaction.editReply({
      content: `Failed to clear channel override: ${errorText}`,
    });
    return;
  }

  // Invalidate cache for this channel
  invalidateChannelSettingsCache(channelId);

  // Get the current global default
  const gatewayClient = new GatewayClient();
  const globalDefault = await gatewayClient.getExtendedContextDefault();

  logger.info({ channelId, userId }, '[Channel Context] Channel override cleared');
  await interaction.editReply({
    content: `**Channel override cleared**.\n\nThis channel will now use the global default setting: ${globalDefault ? '**enabled**' : '**disabled**'}.`,
  });
}
