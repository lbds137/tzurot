/**
 * Personality Create Subcommand
 * Handles /personality create
 */

import type { ChatInputCommandInteraction } from 'discord.js';
import { MessageFlags, EmbedBuilder } from 'discord.js';
import {
  getConfig,
  createLogger,
  CONTENT_TYPES,
  DISCORD_LIMITS,
  DISCORD_COLORS,
} from '@tzurot/common-types';
import { processAvatarAttachment, AvatarProcessingError } from '../../utils/avatarProcessor.js';

const logger = createLogger('personality-create');

/**
 * Handle /personality create subcommand
 */
export async function handleCreate(
  interaction: ChatInputCommandInteraction,
  config: ReturnType<typeof getConfig>
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    // Get required parameters
    const name = interaction.options.getString('name', true);
    const slug = interaction.options.getString('slug', true);
    const characterInfo = interaction.options.getString('character-info', true);
    const personalityTraits = interaction.options.getString('personality-traits', true);

    // Get optional parameters
    const displayName = interaction.options.getString('display-name');
    const tone = interaction.options.getString('tone');
    const age = interaction.options.getString('age');
    const likes = interaction.options.getString('likes');
    const dislikes = interaction.options.getString('dislikes');
    const avatarAttachment = interaction.options.getAttachment('avatar');

    // Validate slug format (lowercase, hyphens only)
    if (!/^[a-z0-9-]+$/.test(slug)) {
      await interaction.editReply(
        '❌ Invalid slug format. Use only lowercase letters, numbers, and hyphens.\n' +
          `Example: \`${name.toLowerCase().replace(/[^a-z0-9-]/g, '-')}\``
      );
      return;
    }

    // Validate avatar if provided
    let avatarBase64: string | undefined;
    if (avatarAttachment) {
      try {
        avatarBase64 = await processAvatarAttachment(avatarAttachment, 'Personality Create');
      } catch (error) {
        if (error instanceof AvatarProcessingError) {
          await interaction.editReply(error.message);
        } else {
          await interaction.editReply('❌ Failed to process avatar image');
        }
        return;
      }
    }

    // Build request payload
    const payload = {
      name,
      slug,
      characterInfo,
      personalityTraits,
      displayName: displayName ?? undefined,
      personalityTone: tone ?? undefined,
      personalityAge: age ?? undefined,
      personalityLikes: likes ?? undefined,
      personalityDislikes: dislikes ?? undefined,
      avatarData: avatarBase64,
      ownerId: interaction.user.id,
    };

    // Call API Gateway to create personality
    const gatewayUrl = config.GATEWAY_URL;
    const response = await fetch(`${gatewayUrl}/admin/personality`, {
      method: 'POST',
      headers: {
        'Content-Type': CONTENT_TYPES.JSON,
        'X-Owner-Id': interaction.user.id,
        'X-Service-Auth': config.INTERNAL_SERVICE_SECRET ?? '',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error({ status: response.status, error: errorText }, 'Failed to create personality');

      // Check for common errors
      if (response.status === 409) {
        await interaction.editReply(
          `❌ A personality with the slug \`${slug}\` already exists.\n` +
            'Please choose a different slug.'
        );
        return;
      }

      await interaction.editReply(
        `❌ Failed to create personality (HTTP ${response.status}):\n` +
          `\`\`\`\n${errorText.slice(0, 1500)}\n\`\`\``
      );
      return;
    }

    await response.json();

    // Build success embed
    const embed = new EmbedBuilder()
      .setColor(DISCORD_COLORS.SUCCESS)
      .setTitle('✅ Personality Created Successfully')
      .setDescription(`Created new personality: **${name}** (\`${slug}\`)`)
      .addFields(
        {
          name: 'Character Info',
          value: characterInfo.slice(0, DISCORD_LIMITS.EMBED_FIELD),
          inline: false,
        },
        {
          name: 'Personality Traits',
          value: personalityTraits.slice(0, DISCORD_LIMITS.EMBED_FIELD),
          inline: false,
        }
      )
      .setTimestamp();

    if (displayName !== undefined && displayName !== null && displayName.length > 0) {
      embed.addFields({ name: 'Display Name', value: displayName, inline: true });
    }
    if (tone !== undefined && tone !== null && tone.length > 0) {
      embed.addFields({ name: 'Tone', value: tone, inline: true });
    }
    if (age !== undefined && age !== null && age.length > 0) {
      embed.addFields({ name: 'Age', value: age, inline: true });
    }
    if (avatarAttachment) {
      embed.addFields({ name: 'Avatar', value: '✅ Uploaded and processed', inline: true });
    }

    await interaction.editReply({ embeds: [embed] });

    logger.info(`[Personality Create] Created personality: ${slug} by ${interaction.user.tag}`);
  } catch (error) {
    logger.error({ err: error }, 'Error creating personality');
    await interaction.editReply(
      '❌ An unexpected error occurred while creating the personality.\n' +
        'Check bot logs for details.'
    );
  }
}
