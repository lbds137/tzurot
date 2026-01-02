/**
 * Character Settings Subcommand
 *
 * Manages character-level extended context settings (owner only).
 *
 * Actions:
 * - show: Show current settings with embed
 * - enable: Force enable extended context for this character
 * - disable: Force disable extended context for this character
 * - auto: Follow channel/global settings (remove override)
 * - set-max-messages: Set max messages (1-100)
 * - set-max-age: Set max age (e.g., 2h, off, auto)
 * - set-max-images: Set max images (0-20)
 *
 * @see docs/standards/TRI_STATE_PATTERN.md
 */

import type { ChatInputCommandInteraction } from 'discord.js';
import { EmbedBuilder } from 'discord.js';
import { createLogger, Duration, DISCORD_COLORS, type EnvConfig } from '@tzurot/common-types';
import { callGatewayApi } from '../../utils/userGatewayClient.js';
import { GatewayClient } from '../../utils/GatewayClient.js';
import {
  buildTriStateUpdateMessage,
  EXTENDED_CONTEXT_DESCRIPTION,
} from '../../utils/triStateHelpers.js';
import type { ExtendedContextSource } from '../../services/ExtendedContextResolver.js';

const logger = createLogger('character-settings');

type SettingsAction =
  | 'enable'
  | 'disable'
  | 'auto'
  | 'show'
  | 'set-max-messages'
  | 'set-max-age'
  | 'set-max-images';

interface PersonalityResponse {
  personality: {
    id: string;
    name: string;
    slug: string;
    /** Tri-state: null=auto, true=on, false=off */
    extendedContext: boolean | null;
    extendedContextMaxMessages: number | null;
    extendedContextMaxAge: number | null;
    extendedContextMaxImages: number | null;
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
      case 'enable':
        await handleExtendedContextUpdate(interaction, characterSlug, userId, true);
        break;
      case 'disable':
        await handleExtendedContextUpdate(interaction, characterSlug, userId, false);
        break;
      case 'auto':
        await handleExtendedContextUpdate(interaction, characterSlug, userId, null);
        break;
      case 'show':
        await handleShow(interaction, characterSlug, userId);
        break;
      case 'set-max-messages':
        await handleSetMaxMessages(interaction, characterSlug, userId);
        break;
      case 'set-max-age':
        await handleSetMaxAge(interaction, characterSlug, userId);
        break;
      case 'set-max-images':
        await handleSetMaxImages(interaction, characterSlug, userId);
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
 * Show current character settings with embed
 */
async function handleShow(
  interaction: ChatInputCommandInteraction,
  characterSlug: string,
  userId: string
): Promise<void> {
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

  // Get admin settings for global defaults
  const gatewayClient = new GatewayClient();
  const adminSettings = await gatewayClient.getAdminSettings();

  if (adminSettings === null) {
    await interaction.editReply({ content: 'Failed to fetch global settings.' });
    return;
  }

  // Build embed with all settings
  const embed = new EmbedBuilder()
    .setTitle('Extended Context Settings')
    .setDescription(`Settings for **${personality.name}** (\`${personality.slug}\`)`)
    .setColor(DISCORD_COLORS.BLURPLE);

  // Extended Context Enabled
  const extendedContextValue = personality.extendedContext;
  const extendedContextEffective = extendedContextValue ?? adminSettings.extendedContextDefault;
  const extendedContextSource: ExtendedContextSource =
    extendedContextValue !== null ? 'personality' : 'global';

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
  const maxMessagesValue = personality.extendedContextMaxMessages;
  const maxMessagesEffective = maxMessagesValue ?? adminSettings.extendedContextMaxMessages;
  const maxMessagesSource: ExtendedContextSource =
    maxMessagesValue !== null ? 'personality' : 'global';

  embed.addFields({
    name: 'Max Messages',
    value: formatNumericSetting(maxMessagesValue, maxMessagesEffective, maxMessagesSource),
    inline: true,
  });

  // Max Age
  const maxAgeValue = personality.extendedContextMaxAge;
  const maxAgeEffective = maxAgeValue ?? adminSettings.extendedContextMaxAge;
  const maxAgeSource: ExtendedContextSource = maxAgeValue !== null ? 'personality' : 'global';

  const maxAgeDuration = Duration.fromDb(maxAgeEffective);
  embed.addFields({
    name: 'Max Age',
    value: formatDurationSetting(maxAgeValue, maxAgeDuration.toHuman(), maxAgeSource),
    inline: true,
  });

  // Max Images
  const maxImagesValue = personality.extendedContextMaxImages;
  const maxImagesEffective = maxImagesValue ?? adminSettings.extendedContextMaxImages;
  const maxImagesSource: ExtendedContextSource = maxImagesValue !== null ? 'personality' : 'global';

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
  characterValue: boolean | null | undefined,
  effective: boolean,
  source: ExtendedContextSource
): string {
  const characterLabel =
    characterValue === null || characterValue === undefined
      ? 'Auto'
      : characterValue
        ? 'On'
        : 'Off';
  const effectiveLabel = effective ? '**Enabled**' : '**Disabled**';
  return `Setting: **${characterLabel}**\nEffective: ${effectiveLabel} (from ${source})`;
}

/**
 * Format numeric setting with source
 */
function formatNumericSetting(
  characterValue: number | null | undefined,
  effective: number,
  source: ExtendedContextSource
): string {
  const characterLabel =
    characterValue === null || characterValue === undefined ? 'Auto' : `${characterValue}`;
  return `Setting: **${characterLabel}**\nEffective: **${effective}** (from ${source})`;
}

/**
 * Format duration setting with source
 */
function formatDurationSetting(
  characterValue: number | null | undefined,
  effectiveHuman: string,
  source: ExtendedContextSource
): string {
  let characterLabel: string;
  if (characterValue === null || characterValue === undefined) {
    characterLabel = 'Auto';
  } else {
    const duration = Duration.fromDb(characterValue);
    characterLabel = duration.toHuman();
  }
  return `Setting: **${characterLabel}**\nEffective: **${effectiveHuman}** (from ${source})`;
}

/**
 * Set max messages for this character
 */
async function handleSetMaxMessages(
  interaction: ChatInputCommandInteraction,
  characterSlug: string,
  userId: string
): Promise<void> {
  const value = interaction.options.getInteger('value');

  if (value === null) {
    // Show current value with hint
    const result = await callGatewayApi<PersonalityResponse>(`/user/personality/${characterSlug}`, {
      method: 'GET',
      userId,
    });

    if (!result.ok) {
      await interaction.editReply({
        content:
          result.status === 404
            ? `Character "${characterSlug}" not found.`
            : `Failed: ${result.error}`,
      });
      return;
    }

    const gatewayClient = new GatewayClient();
    const adminSettings = await gatewayClient.getAdminSettings();

    const characterValue = result.data.personality.extendedContextMaxMessages;
    const effectiveValue = characterValue ?? adminSettings?.extendedContextMaxMessages ?? 20;

    await interaction.editReply({
      content:
        `**Max Messages for ${characterSlug}**\n\n` +
        `Character setting: **${characterValue ?? 'Auto'}**\n` +
        `Effective value: **${effectiveValue}** (from ${characterValue === null ? 'global' : 'character'})\n\n` +
        `To change, use \`/character settings character:${characterSlug} action:set-max-messages value:<1-100>\`\n` +
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

  const result = await callGatewayApi(`/user/personality/${characterSlug}`, {
    method: 'PUT',
    body: { extendedContextMaxMessages: updateValue },
    userId,
  });

  if (!result.ok) {
    await handleApiError(interaction, result, characterSlug);
    return;
  }

  logger.info(
    { characterSlug, value: updateValue, userId },
    '[Character Settings] Max messages updated'
  );

  if (updateValue === null) {
    await interaction.editReply({
      content: `**Max messages set to Auto** for ${characterSlug}.\n\nThis will follow the channel/global defaults.`,
    });
  } else {
    await interaction.editReply({
      content: `**Max messages set to ${updateValue}** for ${characterSlug}.\n\nExtended context will fetch up to ${updateValue} recent messages.`,
    });
  }
}

/**
 * Set max age for this character
 */
async function handleSetMaxAge(
  interaction: ChatInputCommandInteraction,
  characterSlug: string,
  userId: string
): Promise<void> {
  const value = interaction.options.getString('duration');

  if (value === null) {
    // Show current value with hint
    const result = await callGatewayApi<PersonalityResponse>(`/user/personality/${characterSlug}`, {
      method: 'GET',
      userId,
    });

    if (!result.ok) {
      await interaction.editReply({
        content:
          result.status === 404
            ? `Character "${characterSlug}" not found.`
            : `Failed: ${result.error}`,
      });
      return;
    }

    const gatewayClient = new GatewayClient();
    const adminSettings = await gatewayClient.getAdminSettings();

    const characterValue = result.data.personality.extendedContextMaxAge;
    const effectiveValue = characterValue ?? adminSettings?.extendedContextMaxAge;
    const effectiveDuration = Duration.fromDb(effectiveValue ?? null);

    let characterLabel: string;
    if (characterValue === null || characterValue === undefined) {
      characterLabel = 'Auto';
    } else {
      characterLabel = Duration.fromDb(characterValue).toHuman();
    }

    await interaction.editReply({
      content:
        `**Max Age for ${characterSlug}**\n\n` +
        `Character setting: **${characterLabel}**\n` +
        `Effective value: **${effectiveDuration.toHuman()}** (from ${characterValue === null ? 'global' : 'character'})\n\n` +
        `To change, use \`/character settings character:${characterSlug} action:set-max-age duration:<value>\`\n` +
        `Examples: \`2h\`, \`30m\`, \`1d\`, \`off\` (disable age filter), \`auto\` (use global)`,
    });
    return;
  }

  // Handle "auto" to reset to global
  if (value.toLowerCase() === 'auto') {
    const result = await callGatewayApi(`/user/personality/${characterSlug}`, {
      method: 'PUT',
      body: { extendedContextMaxAge: null },
      userId,
    });

    if (!result.ok) {
      await handleApiError(interaction, result, characterSlug);
      return;
    }

    await interaction.editReply({
      content: `**Max age set to Auto** for ${characterSlug}.\n\nThis will follow the channel/global defaults.`,
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

  const result = await callGatewayApi(`/user/personality/${characterSlug}`, {
    method: 'PUT',
    body: { extendedContextMaxAge: duration.toDb() },
    userId,
  });

  if (!result.ok) {
    await handleApiError(interaction, result, characterSlug);
    return;
  }

  logger.info(
    { characterSlug, value: duration.toDb(), userId },
    '[Character Settings] Max age updated'
  );

  if (duration.isEnabled) {
    await interaction.editReply({
      content: `**Max age set to ${duration.toHuman()}** for ${characterSlug}.\n\nExtended context will only include messages from the last ${duration.toHuman()}.`,
    });
  } else {
    await interaction.editReply({
      content: `**Max age filter disabled** for ${characterSlug}.\n\nExtended context will include messages of any age (up to max messages limit).`,
    });
  }
}

/**
 * Set max images for this character
 */
async function handleSetMaxImages(
  interaction: ChatInputCommandInteraction,
  characterSlug: string,
  userId: string
): Promise<void> {
  const value = interaction.options.getInteger('value');

  if (value === null) {
    // Show current value with hint
    const result = await callGatewayApi<PersonalityResponse>(`/user/personality/${characterSlug}`, {
      method: 'GET',
      userId,
    });

    if (!result.ok) {
      await interaction.editReply({
        content:
          result.status === 404
            ? `Character "${characterSlug}" not found.`
            : `Failed: ${result.error}`,
      });
      return;
    }

    const gatewayClient = new GatewayClient();
    const adminSettings = await gatewayClient.getAdminSettings();

    const characterValue = result.data.personality.extendedContextMaxImages;
    const effectiveValue = characterValue ?? adminSettings?.extendedContextMaxImages ?? 0;

    await interaction.editReply({
      content:
        `**Max Images for ${characterSlug}**\n\n` +
        `Character setting: **${characterValue ?? 'Auto'}**\n` +
        `Effective value: **${effectiveValue}** (from ${characterValue === null ? 'global' : 'character'})\n\n` +
        `To change, use \`/character settings character:${characterSlug} action:set-max-images value:<0-20>\`\n` +
        `Use \`value:0\` for 0 images`,
    });
    return;
  }

  // Validate range
  if (value < 0 || value > 20) {
    await interaction.editReply({ content: 'Max images must be between 0 and 20.' });
    return;
  }

  const result = await callGatewayApi(`/user/personality/${characterSlug}`, {
    method: 'PUT',
    body: { extendedContextMaxImages: value },
    userId,
  });

  if (!result.ok) {
    await handleApiError(interaction, result, characterSlug);
    return;
  }

  logger.info({ characterSlug, value, userId }, '[Character Settings] Max images updated');

  if (value === 0) {
    await interaction.editReply({
      content: `**Max images set to 0** for ${characterSlug}.\n\nImages from extended context messages will not be sent to the AI.`,
    });
  } else {
    await interaction.editReply({
      content: `**Max images set to ${value}** for ${characterSlug}.\n\nUp to ${value} images from extended context messages may be included.`,
    });
  }
}

/**
 * Handle common API errors
 */
async function handleApiError(
  interaction: ChatInputCommandInteraction,
  result: { ok: false; status: number; error: string },
  characterSlug: string
): Promise<void> {
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
  await interaction.editReply({
    content: `Failed to update: ${result.error}`,
  });
}
