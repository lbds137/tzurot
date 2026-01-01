/**
 * Channel Context Subcommand
 *
 * Manages extended context settings for channels.
 * Extended context allows personalities to see recent channel messages
 * beyond just bot conversations stored in the database.
 *
 * Actions:
 * - enable: Force enable extended context for this channel
 * - disable: Force disable extended context for this channel
 * - auto: Follow global default (remove channel override)
 * - status: Show current extended context setting
 *
 * @see docs/standards/TRI_STATE_PATTERN.md
 */

import type { ChatInputCommandInteraction } from 'discord.js';
import { PermissionFlagsBits } from 'discord.js';
import { createLogger } from '@tzurot/common-types';
import { callGatewayApi } from '../../utils/userGatewayClient.js';
import { GatewayClient, invalidateChannelSettingsCache } from '../../utils/GatewayClient.js';
import {
  buildTriStateStatusMessage,
  buildTriStateUpdateMessage,
  EXTENDED_CONTEXT_DESCRIPTION,
} from '../../utils/triStateHelpers.js';
import type { ExtendedContextSource } from '../../services/ExtendedContextResolver.js';

const logger = createLogger('channel-context');

type ContextAction = 'enable' | 'disable' | 'status' | 'auto';

/**
 * Handle /channel context command
 */
export async function handleContext(interaction: ChatInputCommandInteraction): Promise<void> {
  const action = interaction.options.getString('action', true) as ContextAction;
  const channelId = interaction.channelId;
  const userId = interaction.user.id;

  // Check permissions: Manage Messages required
  // Note: deferReply is handled by top-level interactionCreate handler
  if (interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages) !== true) {
    await interaction.editReply({
      content: 'You need the **Manage Messages** permission to manage channel context settings.',
    });
    return;
  }

  logger.debug({ action, channelId, userId }, '[Channel Context] Processing context action');

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
      case 'auto':
        await handleAuto(interaction, channelId, userId);
        break;
      default:
        await interaction.editReply({
          content: `Unknown action: ${action as string}`,
        });
    }
  } catch (error) {
    logger.error(
      { err: error, action, channelId },
      '[Channel Context] Error handling context action'
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
 * Enable extended context for this channel (force ON)
 */
async function handleEnable(
  interaction: ChatInputCommandInteraction,
  channelId: string,
  userId: string
): Promise<void> {
  const result = await callGatewayApi(`/user/channel/${channelId}/extended-context`, {
    method: 'PATCH',
    body: { extendedContext: true },
    userId,
  });

  if (!result.ok) {
    logger.warn(
      { channelId, status: result.status, error: result.error },
      '[Channel Context] Failed to enable'
    );
    await interaction.editReply({
      content: `Failed to enable extended context: ${result.error}`,
    });
    return;
  }

  // Invalidate cache for this channel
  invalidateChannelSettingsCache(channelId);

  logger.info({ channelId, userId }, '[Channel Context] Extended context enabled');
  await interaction.editReply({
    content: buildTriStateUpdateMessage({
      settingName: 'Extended Context',
      targetName: 'this channel',
      newValue: true,
      targetType: 'channel',
    }),
  });
}

/**
 * Disable extended context for this channel (force OFF)
 */
async function handleDisable(
  interaction: ChatInputCommandInteraction,
  channelId: string,
  userId: string
): Promise<void> {
  const result = await callGatewayApi(`/user/channel/${channelId}/extended-context`, {
    method: 'PATCH',
    body: { extendedContext: false },
    userId,
  });

  if (!result.ok) {
    logger.warn(
      { channelId, status: result.status, error: result.error },
      '[Channel Context] Failed to disable'
    );
    await interaction.editReply({
      content: `Failed to disable extended context: ${result.error}`,
    });
    return;
  }

  // Invalidate cache for this channel
  invalidateChannelSettingsCache(channelId);

  logger.info({ channelId, userId }, '[Channel Context] Extended context disabled');
  await interaction.editReply({
    content: buildTriStateUpdateMessage({
      settingName: 'Extended Context',
      targetName: 'this channel',
      newValue: false,
      targetType: 'channel',
    }),
  });
}

/**
 * Show current extended context status
 */
async function handleStatus(
  interaction: ChatInputCommandInteraction,
  channelId: string
): Promise<void> {
  const gatewayClient = new GatewayClient();
  const settings = await gatewayClient.getChannelSettings(channelId);
  const globalDefault = await gatewayClient.getExtendedContextDefault();

  // Determine current value and source
  let currentValue: boolean | null = null;
  let effectiveEnabled: boolean;
  let source: ExtendedContextSource;

  if (
    settings?.hasSettings === true &&
    settings.settings?.extendedContext !== null &&
    settings.settings?.extendedContext !== undefined
  ) {
    // Channel has explicit setting
    currentValue = settings.settings.extendedContext;
    effectiveEnabled = currentValue;
    source = 'channel';
  } else {
    // Using global default (channel is AUTO)
    currentValue = null;
    effectiveEnabled = globalDefault;
    source = 'global';
  }

  await interaction.editReply({
    content: buildTriStateStatusMessage({
      settingName: 'Extended Context',
      targetName: 'this channel',
      currentValue,
      effectiveEnabled,
      source,
      description: EXTENDED_CONTEXT_DESCRIPTION,
    }),
  });
}

/**
 * Set channel to auto (follow global default)
 */
async function handleAuto(
  interaction: ChatInputCommandInteraction,
  channelId: string,
  userId: string
): Promise<void> {
  const result = await callGatewayApi(`/user/channel/${channelId}/extended-context`, {
    method: 'PATCH',
    body: { extendedContext: null },
    userId,
  });

  if (!result.ok) {
    logger.warn(
      { channelId, status: result.status, error: result.error },
      '[Channel Context] Failed to set auto'
    );
    await interaction.editReply({
      content: `Failed to set auto mode: ${result.error}`,
    });
    return;
  }

  // Invalidate cache for this channel
  invalidateChannelSettingsCache(channelId);

  // Get the current global default to show what this resolves to
  const gatewayClient = new GatewayClient();
  const globalDefault = await gatewayClient.getExtendedContextDefault();

  logger.info({ channelId, userId }, '[Channel Context] Extended context set to auto');
  await interaction.editReply({
    content: buildTriStateUpdateMessage({
      settingName: 'Extended Context',
      targetName: 'this channel',
      newValue: null,
      effectiveEnabled: globalDefault,
      source: 'global',
      targetType: 'channel',
    }),
  });
}
