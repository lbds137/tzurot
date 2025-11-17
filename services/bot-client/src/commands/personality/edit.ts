/**
 * Personality Edit Subcommand
 * Handles /personality edit
 */

import type { ChatInputCommandInteraction } from 'discord.js';
import { MessageFlags, EmbedBuilder } from 'discord.js';
import {
  getConfig,
  createLogger,
  CONTENT_TYPES,
  DISCORD_COLORS,
} from '@tzurot/common-types';
import { processAvatarAttachment, AvatarProcessingError } from '../../utils/avatarProcessor.js';

const logger = createLogger('personality-edit');

/**
 * Handle /personality edit subcommand
 */
export async function handleEdit(
  interaction: ChatInputCommandInteraction,
  config: ReturnType<typeof getConfig>
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    // Get required parameter
    const slug = interaction.options.getString('slug', true);

    // Get optional parameters (only update what's provided)
    const name = interaction.options.getString('name');
    const characterInfo = interaction.options.getString('character-info');
    const personalityTraits = interaction.options.getString('personality-traits');
    const displayName = interaction.options.getString('display-name');
    const tone = interaction.options.getString('tone');
    const age = interaction.options.getString('age');
    const likes = interaction.options.getString('likes');
    const dislikes = interaction.options.getString('dislikes');
    const avatarAttachment = interaction.options.getAttachment('avatar');

    // Validate at least one field is provided
    if (
      (name === undefined || name === null || name.length === 0) &&
      (characterInfo === undefined || characterInfo === null || characterInfo.length === 0) &&
      (personalityTraits === undefined ||
        personalityTraits === null ||
        personalityTraits.length === 0) &&
      (displayName === undefined || displayName === null || displayName.length === 0) &&
      (tone === undefined || tone === null || tone.length === 0) &&
      (age === undefined || age === null || age.length === 0) &&
      (likes === undefined || likes === null || likes.length === 0) &&
      (dislikes === undefined || dislikes === null || dislikes.length === 0) &&
      !avatarAttachment
    ) {
      await interaction.editReply(
        '❌ You must provide at least one field to update.\n' +
          'Use the command options to specify what you want to change.'
      );
      return;
    }

    // Validate avatar if provided
    let avatarBase64: string | undefined;
    if (avatarAttachment) {
      try {
        avatarBase64 = await processAvatarAttachment(avatarAttachment, 'Personality Edit');
      } catch (error) {
        if (error instanceof AvatarProcessingError) {
          await interaction.editReply(error.message);
        } else {
          await interaction.editReply('❌ Failed to process avatar image');
        }
        return;
      }
    }

    // Build request payload with only provided fields
    const payload: Record<string, unknown> = {
      slug,
      ownerId: interaction.user.id,
    };

    if (name !== null && name !== undefined && name.length > 0) {payload.name = name;}
    if (characterInfo !== null && characterInfo !== undefined && characterInfo.length > 0) {payload.characterInfo = characterInfo;}
    if (personalityTraits !== null && personalityTraits !== undefined && personalityTraits.length > 0) {payload.personalityTraits = personalityTraits;}
    if (displayName !== null && displayName !== undefined && displayName.length > 0) {payload.displayName = displayName;}
    if (tone !== null && tone !== undefined && tone.length > 0) {payload.personalityTone = tone;}
    if (age !== null && age !== undefined && age.length > 0) {payload.personalityAge = age;}
    if (likes !== null && likes !== undefined && likes.length > 0) {payload.personalityLikes = likes;}
    if (dislikes !== null && dislikes !== undefined && dislikes.length > 0) {payload.personalityDislikes = dislikes;}
    if (avatarBase64 !== undefined && avatarBase64 !== null && avatarBase64.length > 0) {payload.avatarData = avatarBase64;}

    // Call API Gateway to edit personality
    const gatewayUrl = config.GATEWAY_URL;
    const response = await fetch(`${gatewayUrl}/admin/personality/${slug}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': CONTENT_TYPES.JSON,
        'X-Owner-Id': interaction.user.id,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error({ status: response.status, error: errorText }, 'Failed to edit personality');

      // Check for common errors
      if (response.status === 404) {
        await interaction.editReply(
          `❌ Personality with slug \`${slug}\` not found.\n` + 'Check the slug and try again.'
        );
        return;
      }

      await interaction.editReply(
        `❌ Failed to edit personality (HTTP ${response.status}):\n` +
          `\`\`\`\n${errorText.slice(0, 1500)}\n\`\`\``
      );
      return;
    }

    await response.json();

    // Build success embed
    const embed = new EmbedBuilder()
      .setColor(DISCORD_COLORS.SUCCESS)
      .setTitle('✅ Personality Updated Successfully')
      .setDescription(`Updated personality: **${name ?? slug}** (\`${slug}\`)`)
      .setTimestamp();

    const updatedFields: string[] = [];
    if (name !== undefined && name !== null && name.length > 0) {updatedFields.push(`Name: ${name}`);}
    if (characterInfo !== undefined && characterInfo !== null && characterInfo.length > 0) {updatedFields.push('Character Info');}
    if (personalityTraits !== undefined && personalityTraits !== null && personalityTraits.length > 0) {updatedFields.push('Personality Traits');}
    if (displayName !== undefined && displayName !== null && displayName.length > 0) {updatedFields.push(`Display Name: ${displayName}`);}
    if (tone !== undefined && tone !== null && tone.length > 0) {updatedFields.push(`Tone: ${tone}`);}
    if (age !== undefined && age !== null && age.length > 0) {updatedFields.push(`Age: ${age}`);}
    if (likes !== undefined && likes !== null && likes.length > 0) {updatedFields.push('Likes');}
    if (dislikes !== undefined && dislikes !== null && dislikes.length > 0) {updatedFields.push('Dislikes');}
    if (avatarAttachment !== undefined && avatarAttachment !== null) {updatedFields.push('Avatar');}

    embed.addFields({ name: 'Updated Fields', value: updatedFields.join('\n'), inline: false });

    await interaction.editReply({ embeds: [embed] });

    logger.info(`[Personality Edit] Updated personality: ${slug} by ${interaction.user.tag}`);
  } catch (error) {
    logger.error({ err: error }, 'Error editing personality');
    await interaction.editReply(
      '❌ An unexpected error occurred while editing the personality.\n' +
        'Check bot logs for details.'
    );
  }
}
