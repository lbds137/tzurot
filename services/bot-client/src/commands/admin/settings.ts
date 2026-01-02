/**
 * Admin Settings Subcommand
 *
 * Manages global bot settings via AdminSettings singleton (owner only).
 *
 * Actions:
 * - show: Display current settings dashboard
 * - toggle-extended-context: Toggle extended context default (on/off)
 * - set-max-messages: Set max messages for extended context (1-100)
 * - set-max-age: Set max age for extended context (e.g., "2h", "off")
 * - set-max-images: Set max images for extended context (0-20)
 *
 * @see docs/planning/EXTENDED_CONTEXT_IMPROVEMENTS.md
 */

import type { ChatInputCommandInteraction } from 'discord.js';
import { EmbedBuilder } from 'discord.js';
import {
  createLogger,
  Duration,
  DISCORD_COLORS,
  type GetAdminSettingsResponse,
} from '@tzurot/common-types';
import { adminFetch, adminPatchJson } from '../../utils/adminApiClient.js';

const logger = createLogger('admin-settings');

type SettingsAction =
  | 'show'
  | 'toggle-extended-context'
  | 'set-max-messages'
  | 'set-max-age'
  | 'set-max-images';

/**
 * Handle /admin settings command
 */
export async function handleSettings(interaction: ChatInputCommandInteraction): Promise<void> {
  const action = interaction.options.getString('action', true) as SettingsAction;
  const userId = interaction.user.id;

  logger.debug({ action, userId }, '[Admin Settings] Processing settings action');

  try {
    switch (action) {
      case 'show':
        await handleShow(interaction);
        break;
      case 'toggle-extended-context':
        await handleToggleExtendedContext(interaction);
        break;
      case 'set-max-messages':
        await handleSetMaxMessages(interaction);
        break;
      case 'set-max-age':
        await handleSetMaxAge(interaction);
        break;
      case 'set-max-images':
        await handleSetMaxImages(interaction);
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
 * Fetch AdminSettings from API gateway
 */
async function fetchAdminSettings(
  userId: string
): Promise<GetAdminSettingsResponse | null> {
  const response = await adminFetch('/admin/settings', {
    method: 'GET',
    userId,
  });

  if (!response.ok) {
    return null;
  }

  return (await response.json()) as GetAdminSettingsResponse;
}

/**
 * Update AdminSettings via API gateway
 */
async function updateAdminSettings(
  userId: string,
  updates: Record<string, unknown>
): Promise<{ success: boolean; error?: string; data?: GetAdminSettingsResponse }> {
  const response = await adminPatchJson('/admin/settings', updates, userId);

  if (!response.ok) {
    const errorText = await response.text();
    return { success: false, error: errorText };
  }

  const data = (await response.json()) as GetAdminSettingsResponse;
  return { success: true, data };
}

/**
 * Build settings dashboard embed
 */
function buildSettingsEmbed(settings: GetAdminSettingsResponse): EmbedBuilder {
  const maxAgeDuration = Duration.fromDb(settings.extendedContextMaxAge);

  return new EmbedBuilder()
    .setTitle('Admin Settings')
    .setDescription('Global bot configuration for extended context and other features.')
    .setColor(DISCORD_COLORS.BLURPLE)
    .addFields(
      {
        name: 'Extended Context Default',
        value: settings.extendedContextDefault ? '**Enabled**' : '**Disabled**',
        inline: true,
      },
      {
        name: 'Max Messages',
        value: `**${settings.extendedContextMaxMessages}**`,
        inline: true,
      },
      {
        name: 'Max Age',
        value: `**${maxAgeDuration.toHuman()}**`,
        inline: true,
      },
      {
        name: 'Max Images',
        value: `**${settings.extendedContextMaxImages}**`,
        inline: true,
      }
    )
    .setFooter({ text: `Last updated: ${new Date(settings.updatedAt).toLocaleString()}` })
    .setTimestamp();
}

/**
 * Show current settings dashboard
 */
async function handleShow(interaction: ChatInputCommandInteraction): Promise<void> {
  const settings = await fetchAdminSettings(interaction.user.id);

  if (settings === null) {
    await interaction.editReply({
      content: 'Failed to fetch admin settings.',
    });
    return;
  }

  const embed = buildSettingsEmbed(settings);
  await interaction.editReply({ embeds: [embed] });
}

/**
 * Toggle extended context default on/off
 */
async function handleToggleExtendedContext(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  // Fetch current settings
  const current = await fetchAdminSettings(interaction.user.id);
  if (current === null) {
    await interaction.editReply({ content: 'Failed to fetch current settings.' });
    return;
  }

  // Toggle the value
  const newValue = !current.extendedContextDefault;
  const result = await updateAdminSettings(interaction.user.id, {
    extendedContextDefault: newValue,
  });

  if (!result.success) {
    await interaction.editReply({ content: `Failed to update: ${result.error}` });
    return;
  }

  logger.info(
    { newValue, userId: interaction.user.id },
    '[Admin Settings] Extended context default toggled'
  );

  await interaction.editReply({
    content:
      `**Extended context ${newValue ? 'enabled' : 'disabled'} globally by default.**\n\n` +
      (newValue
        ? 'Channels without explicit overrides will now have extended context enabled.'
        : 'Channels without explicit overrides will now have extended context disabled.'),
  });
}

/**
 * Set max messages for extended context
 */
async function handleSetMaxMessages(interaction: ChatInputCommandInteraction): Promise<void> {
  const value = interaction.options.getInteger('value');

  if (value === null) {
    // Show current value
    const settings = await fetchAdminSettings(interaction.user.id);
    if (settings === null) {
      await interaction.editReply({ content: 'Failed to fetch current settings.' });
      return;
    }
    await interaction.editReply({
      content: `**Current max messages:** ${settings.extendedContextMaxMessages}\n\nTo change, use \`/admin settings action:set-max-messages value:<1-100>\``,
    });
    return;
  }

  // Validate range (Zod in API will also validate, but good UX to check early)
  if (value < 1 || value > 100) {
    await interaction.editReply({ content: 'Max messages must be between 1 and 100.' });
    return;
  }

  const result = await updateAdminSettings(interaction.user.id, {
    extendedContextMaxMessages: value,
  });

  if (!result.success) {
    await interaction.editReply({ content: `Failed to update: ${result.error}` });
    return;
  }

  logger.info({ value, userId: interaction.user.id }, '[Admin Settings] Max messages updated');

  await interaction.editReply({
    content: `**Max messages set to ${value}.**\n\nExtended context will now fetch up to ${value} recent messages from Discord channels.`,
  });
}

/**
 * Set max age for extended context
 */
async function handleSetMaxAge(interaction: ChatInputCommandInteraction): Promise<void> {
  const value = interaction.options.getString('duration');

  if (value === null) {
    // Show current value
    const settings = await fetchAdminSettings(interaction.user.id);
    if (settings === null) {
      await interaction.editReply({ content: 'Failed to fetch current settings.' });
      return;
    }

    const duration = Duration.fromDb(settings.extendedContextMaxAge);
    await interaction.editReply({
      content:
        `**Current max age:** ${duration.toHuman()}\n\n` +
        `To change, use \`/admin settings action:set-max-age value:<duration>\`\n` +
        `Examples: \`2h\`, \`30m\`, \`1d\`, \`off\` (to disable age filter)`,
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
        `Use formats like \`2h\`, \`30m\`, \`1d\`, or \`off\` to disable.`,
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

  const result = await updateAdminSettings(interaction.user.id, {
    extendedContextMaxAge: duration.toDb(),
  });

  if (!result.success) {
    await interaction.editReply({ content: `Failed to update: ${result.error}` });
    return;
  }

  logger.info(
    { value: duration.toDb(), userId: interaction.user.id },
    '[Admin Settings] Max age updated'
  );

  if (duration.isEnabled) {
    await interaction.editReply({
      content: `**Max age set to ${duration.toHuman()}.**\n\nExtended context will only include messages from the last ${duration.toHuman()}.`,
    });
  } else {
    await interaction.editReply({
      content: '**Max age filter disabled.**\n\nExtended context will include messages of any age (up to max messages limit).',
    });
  }
}

/**
 * Set max images for extended context
 */
async function handleSetMaxImages(interaction: ChatInputCommandInteraction): Promise<void> {
  const value = interaction.options.getInteger('value');

  if (value === null) {
    // Show current value
    const settings = await fetchAdminSettings(interaction.user.id);
    if (settings === null) {
      await interaction.editReply({ content: 'Failed to fetch current settings.' });
      return;
    }
    await interaction.editReply({
      content:
        `**Current max images:** ${settings.extendedContextMaxImages}\n\n` +
        `To change, use \`/admin settings action:set-max-images value:<0-20>\``,
    });
    return;
  }

  // Validate range
  if (value < 0 || value > 20) {
    await interaction.editReply({ content: 'Max images must be between 0 and 20.' });
    return;
  }

  const result = await updateAdminSettings(interaction.user.id, {
    extendedContextMaxImages: value,
  });

  if (!result.success) {
    await interaction.editReply({ content: `Failed to update: ${result.error}` });
    return;
  }

  logger.info({ value, userId: interaction.user.id }, '[Admin Settings] Max images updated');

  if (value === 0) {
    await interaction.editReply({
      content: '**Max images set to 0.**\n\nImages from extended context messages will not be sent to the AI.',
    });
  } else {
    await interaction.editReply({
      content: `**Max images set to ${value}.**\n\nUp to ${value} images from extended context messages may be included in AI context.`,
    });
  }
}
