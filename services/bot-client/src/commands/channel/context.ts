/**
 * Channel Context Subcommand
 *
 * Manages extended context settings for channels.
 * Extended context allows personalities to see recent channel messages
 * beyond just bot conversations stored in the database.
 *
 * Actions:
 * - status: Show current extended context settings
 * - enable: Force enable extended context for this channel
 * - disable: Force disable extended context for this channel
 * - auto: Follow global default (remove channel override)
 * - set-max-messages: Set max messages for this channel (1-100)
 * - set-max-age: Set max age for this channel (e.g., 2h, off, auto)
 * - set-max-images: Set max images for this channel (0-20)
 *
 * @see docs/standards/TRI_STATE_PATTERN.md
 */

import type { ChatInputCommandInteraction } from 'discord.js';
import { PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { createLogger, Duration, DISCORD_COLORS } from '@tzurot/common-types';
import { callGatewayApi } from '../../utils/userGatewayClient.js';
import { GatewayClient, invalidateChannelSettingsCache } from '../../utils/GatewayClient.js';
import {
  buildTriStateUpdateMessage,
  EXTENDED_CONTEXT_DESCRIPTION,
} from '../../utils/triStateHelpers.js';
import type { ExtendedContextSource } from '../../services/ExtendedContextResolver.js';

const logger = createLogger('channel-context');

type ContextAction =
  | 'enable'
  | 'disable'
  | 'status'
  | 'auto'
  | 'set-max-messages'
  | 'set-max-age'
  | 'set-max-images';

/**
 * Handle /channel context command
 */
export async function handleContext(interaction: ChatInputCommandInteraction): Promise<void> {
  const action = interaction.options.getString('action', true) as ContextAction;
  const channelId = interaction.channelId;
  const userId = interaction.user.id;

  // Check permissions: Manage Messages required
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
      case 'set-max-messages':
        await handleSetMaxMessages(interaction, channelId, userId);
        break;
      case 'set-max-age':
        await handleSetMaxAge(interaction, channelId, userId);
        break;
      case 'set-max-images':
        await handleSetMaxImages(interaction, channelId, userId);
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
 * Show current extended context status with all settings
 */
async function handleStatus(
  interaction: ChatInputCommandInteraction,
  channelId: string
): Promise<void> {
  const gatewayClient = new GatewayClient();
  const settings = await gatewayClient.getChannelSettings(channelId);
  const adminSettings = await gatewayClient.getAdminSettings();

  if (adminSettings === null) {
    await interaction.editReply({ content: 'Failed to fetch global settings.' });
    return;
  }

  // Build embed with all settings
  const embed = new EmbedBuilder()
    .setTitle('Extended Context Settings')
    .setDescription(`Settings for <#${channelId}>`)
    .setColor(DISCORD_COLORS.BLURPLE);

  // Determine current values and sources
  const channelSettings = settings?.settings;

  // Extended Context Enabled
  const extendedContextValue = channelSettings?.extendedContext ?? null;
  const extendedContextEffective = extendedContextValue ?? adminSettings.extendedContextDefault;
  const extendedContextSource: ExtendedContextSource =
    extendedContextValue !== null && extendedContextValue !== undefined ? 'channel' : 'global';

  embed.addFields({
    name: 'Extended Context',
    value: formatSettingValue(
      extendedContextValue,
      extendedContextEffective,
      extendedContextSource
    ),
    inline: false,
  });

  // Max Messages
  const maxMessagesValue = channelSettings?.extendedContextMaxMessages ?? null;
  const maxMessagesEffective = maxMessagesValue ?? adminSettings.extendedContextMaxMessages;
  const maxMessagesSource: ExtendedContextSource = maxMessagesValue !== null ? 'channel' : 'global';

  embed.addFields({
    name: 'Max Messages',
    value: formatNumericSetting(maxMessagesValue, maxMessagesEffective, maxMessagesSource),
    inline: true,
  });

  // Max Age
  const maxAgeValue = channelSettings?.extendedContextMaxAge ?? null;
  const maxAgeEffective = maxAgeValue ?? adminSettings.extendedContextMaxAge;
  const maxAgeSource: ExtendedContextSource = maxAgeValue !== null ? 'channel' : 'global';

  const maxAgeDuration = Duration.fromDb(maxAgeEffective);
  embed.addFields({
    name: 'Max Age',
    value: formatDurationSetting(maxAgeValue, maxAgeDuration.toHuman(), maxAgeSource),
    inline: true,
  });

  // Max Images
  const maxImagesValue = channelSettings?.extendedContextMaxImages ?? null;
  const maxImagesEffective = maxImagesValue ?? adminSettings.extendedContextMaxImages;
  const maxImagesSource: ExtendedContextSource = maxImagesValue !== null ? 'channel' : 'global';

  embed.addFields({
    name: 'Max Images',
    value: formatNumericSetting(maxImagesValue, maxImagesEffective, maxImagesSource),
    inline: true,
  });

  // Footer with description
  embed.setFooter({ text: EXTENDED_CONTEXT_DESCRIPTION });

  await interaction.editReply({ embeds: [embed] });
}

/**
 * Format boolean setting value with source
 */
function formatSettingValue(
  channelValue: boolean | null | undefined,
  effective: boolean,
  source: ExtendedContextSource
): string {
  const channelLabel =
    channelValue === null || channelValue === undefined ? 'Auto' : channelValue ? 'On' : 'Off';
  const effectiveLabel = effective ? '**Enabled**' : '**Disabled**';
  return `Setting: **${channelLabel}**\nEffective: ${effectiveLabel} (from ${source})`;
}

/**
 * Format numeric setting with source
 */
function formatNumericSetting(
  channelValue: number | null | undefined,
  effective: number,
  source: ExtendedContextSource
): string {
  const channelLabel =
    channelValue === null || channelValue === undefined ? 'Auto' : `${channelValue}`;
  return `Setting: **${channelLabel}**\nEffective: **${effective}** (from ${source})`;
}

/**
 * Format duration setting with source
 */
function formatDurationSetting(
  channelValue: number | null | undefined,
  effectiveHuman: string,
  source: ExtendedContextSource
): string {
  let channelLabel: string;
  if (channelValue === null || channelValue === undefined) {
    channelLabel = 'Auto';
  } else {
    const duration = Duration.fromDb(channelValue);
    channelLabel = duration.toHuman();
  }
  return `Setting: **${channelLabel}**\nEffective: **${effectiveHuman}** (from ${source})`;
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

  invalidateChannelSettingsCache(channelId);

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

/**
 * Set max messages for this channel
 */
async function handleSetMaxMessages(
  interaction: ChatInputCommandInteraction,
  channelId: string,
  userId: string
): Promise<void> {
  const value = interaction.options.getInteger('value');

  if (value === null) {
    // Show current value with hint
    const gatewayClient = new GatewayClient();
    const settings = await gatewayClient.getChannelSettings(channelId);
    const adminSettings = await gatewayClient.getAdminSettings();

    const channelValue = settings?.settings?.extendedContextMaxMessages ?? null;
    const effectiveValue = channelValue ?? adminSettings?.extendedContextMaxMessages ?? 20;

    await interaction.editReply({
      content:
        `**Max Messages for this channel**\n\n` +
        `Channel setting: **${channelValue === null ? 'Auto' : channelValue}**\n` +
        `Effective value: **${effectiveValue}** (from ${channelValue === null ? 'global' : 'channel'})\n\n` +
        `To change, use \`/channel context action:set-max-messages value:<1-100>\`\n` +
        `To use global setting, use \`value:0\` (auto)`,
    });
    return;
  }

  // Handle 0 as "auto" (use global default)
  const updateValue = value === 0 ? null : value;

  // Validate range
  if (updateValue !== null && (updateValue < 1 || updateValue > 100)) {
    await interaction.editReply({
      content: 'Max messages must be between 1 and 100, or 0 for auto.',
    });
    return;
  }

  const result = await callGatewayApi(`/user/channel/${channelId}/extended-context`, {
    method: 'PATCH',
    body: { extendedContextMaxMessages: updateValue },
    userId,
  });

  if (!result.ok) {
    await interaction.editReply({ content: `Failed to update: ${result.error}` });
    return;
  }

  invalidateChannelSettingsCache(channelId);

  logger.info({ channelId, value: updateValue, userId }, '[Channel Context] Max messages updated');

  if (updateValue === null) {
    await interaction.editReply({
      content:
        '**Max messages set to Auto** for this channel.\n\nThis will follow the global default.',
    });
  } else {
    await interaction.editReply({
      content: `**Max messages set to ${updateValue}** for this channel.\n\nExtended context will fetch up to ${updateValue} recent messages.`,
    });
  }
}

/**
 * Set max age for this channel
 */
async function handleSetMaxAge(
  interaction: ChatInputCommandInteraction,
  channelId: string,
  userId: string
): Promise<void> {
  const value = interaction.options.getString('duration');

  if (value === null) {
    // Show current value with hint
    const gatewayClient = new GatewayClient();
    const settings = await gatewayClient.getChannelSettings(channelId);
    const adminSettings = await gatewayClient.getAdminSettings();

    const channelValue = settings?.settings?.extendedContextMaxAge ?? null;
    const effectiveValue = channelValue ?? adminSettings?.extendedContextMaxAge;
    const effectiveDuration = Duration.fromDb(effectiveValue ?? null);

    let channelLabel: string;
    if (channelValue === null || channelValue === undefined) {
      channelLabel = 'Auto';
    } else {
      channelLabel = Duration.fromDb(channelValue).toHuman();
    }

    await interaction.editReply({
      content:
        `**Max Age for this channel**\n\n` +
        `Channel setting: **${channelLabel}**\n` +
        `Effective value: **${effectiveDuration.toHuman()}** (from ${channelValue === null ? 'global' : 'channel'})\n\n` +
        `To change, use \`/channel context action:set-max-age duration:<value>\`\n` +
        `Examples: \`2h\`, \`30m\`, \`1d\`, \`off\` (disable age filter), \`auto\` (use global)`,
    });
    return;
  }

  // Handle "auto" to reset to global
  if (value.toLowerCase() === 'auto') {
    const result = await callGatewayApi(`/user/channel/${channelId}/extended-context`, {
      method: 'PATCH',
      body: { extendedContextMaxAge: null },
      userId,
    });

    if (!result.ok) {
      await interaction.editReply({ content: `Failed to update: ${result.error}` });
      return;
    }

    invalidateChannelSettingsCache(channelId);

    await interaction.editReply({
      content: '**Max age set to Auto** for this channel.\n\nThis will follow the global default.',
    });
    return;
  }

  // Parse the duration
  let duration: Duration;
  try {
    duration = Duration.parse(value);
  } catch {
    await interaction.editReply({
      content:
        `Invalid duration: "${value}"\n\n` +
        `Use formats like \`2h\`, \`30m\`, \`1d\`, \`off\`, or \`auto\`.`,
    });
    return;
  }

  // Validate bounds if enabled
  if (duration.isEnabled) {
    const seconds = duration.toSeconds();
    if (seconds !== null && seconds < 60) {
      await interaction.editReply({ content: 'Max age must be at least 1 minute.' });
      return;
    }
  }

  const result = await callGatewayApi(`/user/channel/${channelId}/extended-context`, {
    method: 'PATCH',
    body: { extendedContextMaxAge: duration.toDb() },
    userId,
  });

  if (!result.ok) {
    await interaction.editReply({ content: `Failed to update: ${result.error}` });
    return;
  }

  invalidateChannelSettingsCache(channelId);

  logger.info({ channelId, value: duration.toDb(), userId }, '[Channel Context] Max age updated');

  if (duration.isEnabled) {
    await interaction.editReply({
      content: `**Max age set to ${duration.toHuman()}** for this channel.\n\nExtended context will only include messages from the last ${duration.toHuman()}.`,
    });
  } else {
    await interaction.editReply({
      content:
        '**Max age filter disabled** for this channel.\n\nExtended context will include messages of any age (up to max messages limit).',
    });
  }
}

/**
 * Set max images for this channel
 */
async function handleSetMaxImages(
  interaction: ChatInputCommandInteraction,
  channelId: string,
  userId: string
): Promise<void> {
  const value = interaction.options.getInteger('value');

  if (value === null) {
    // Show current value with hint
    const gatewayClient = new GatewayClient();
    const settings = await gatewayClient.getChannelSettings(channelId);
    const adminSettings = await gatewayClient.getAdminSettings();

    const channelValue = settings?.settings?.extendedContextMaxImages ?? null;
    const effectiveValue = channelValue ?? adminSettings?.extendedContextMaxImages ?? 0;

    await interaction.editReply({
      content:
        `**Max Images for this channel**\n\n` +
        `Channel setting: **${channelValue === null ? 'Auto' : channelValue}**\n` +
        `Effective value: **${effectiveValue}** (from ${channelValue === null ? 'global' : 'channel'})\n\n` +
        `To change, use \`/channel context action:set-max-images value:<0-20>\`\n` +
        `Use \`value:0\` for 0 images, or type \`auto\` in duration field to use global`,
    });
    return;
  }

  // Validate range
  if (value < 0 || value > 20) {
    await interaction.editReply({ content: 'Max images must be between 0 and 20.' });
    return;
  }

  const result = await callGatewayApi(`/user/channel/${channelId}/extended-context`, {
    method: 'PATCH',
    body: { extendedContextMaxImages: value },
    userId,
  });

  if (!result.ok) {
    await interaction.editReply({ content: `Failed to update: ${result.error}` });
    return;
  }

  invalidateChannelSettingsCache(channelId);

  logger.info({ channelId, value, userId }, '[Channel Context] Max images updated');

  if (value === 0) {
    await interaction.editReply({
      content:
        '**Max images set to 0** for this channel.\n\nImages from extended context messages will not be sent to the AI.',
    });
  } else {
    await interaction.editReply({
      content: `**Max images set to ${value}** for this channel.\n\nUp to ${value} images from extended context messages may be included.`,
    });
  }
}
