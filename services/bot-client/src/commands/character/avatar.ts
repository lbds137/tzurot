/**
 * Character Avatar Handler
 *
 * Handles avatar upload and update for characters.
 * Automatically resizes large images to fit within the API gateway's body limit.
 */

import type { ChatInputCommandInteraction } from 'discord.js';
import { createLogger, type EnvConfig } from '@tzurot/common-types';
import { fetchCharacter, updateCharacter } from './api.js';
import {
  VALID_IMAGE_TYPES,
  MAX_INPUT_SIZE_MB,
  MAX_INPUT_SIZE_BYTES,
  processAvatarBuffer,
} from './avatarUtils.js';

const logger = createLogger('character-avatar');

/**
 * Handle avatar upload subcommand
 */
export async function handleAvatar(
  interaction: ChatInputCommandInteraction,
  config: EnvConfig
): Promise<void> {
  // Note: deferReply is handled by top-level interactionCreate handler
  const slug = interaction.options.getString('character', true);
  const attachment = interaction.options.getAttachment('image', true);

  // Validate attachment is an image
  if (attachment.contentType === null || !VALID_IMAGE_TYPES.includes(attachment.contentType)) {
    await interaction.editReply(
      '❌ Invalid image format. Please upload a PNG, JPG, GIF, or WebP image.'
    );
    return;
  }

  // Check file size - reject extremely large files
  if (attachment.size > MAX_INPUT_SIZE_BYTES) {
    await interaction.editReply(
      `❌ Image too large. Please upload an image under ${MAX_INPUT_SIZE_MB}MB.`
    );
    return;
  }

  try {
    // Check if user can edit this character
    const character = await fetchCharacter(slug, config, interaction.user.id);
    if (!character) {
      await interaction.editReply(`❌ Character \`${slug}\` not found or not accessible.`);
      return;
    }

    // Use server-side permission check (compares internal User UUIDs, not Discord IDs)
    if (!character.canEdit) {
      await interaction.editReply(
        `❌ You don't have permission to edit \`${slug}\`.\n` +
          'You can only edit characters you own.'
      );
      return;
    }

    // Download the image
    const imageResponse = await fetch(attachment.url);
    if (!imageResponse.ok) {
      await interaction.editReply('❌ Failed to download the image. Please try again.');
      return;
    }

    const rawBuffer = Buffer.from(await imageResponse.arrayBuffer());

    // Process avatar (resize if needed)
    const result = await processAvatarBuffer(rawBuffer, slug);
    if (!result.success) {
      await interaction.editReply(`❌ ${result.message}`);
      return;
    }

    const base64Image = result.buffer.toString('base64');

    // Update character with new avatar
    await updateCharacter(slug, { avatarData: base64Image }, interaction.user.id, config);

    await interaction.editReply(
      `✅ Avatar updated for **${character.displayName ?? character.name}**!`
    );

    logger.info({ slug, userId: interaction.user.id }, 'Character avatar updated');
  } catch (error) {
    logger.error({ err: error, slug }, 'Failed to update avatar');
    await interaction.editReply('❌ Failed to update avatar. Please try again.');
  }
}

// Re-export constants for testing (from avatarUtils)
export { VALID_IMAGE_TYPES, MAX_INPUT_SIZE_MB, MAX_INPUT_SIZE_BYTES } from './avatarUtils.js';
