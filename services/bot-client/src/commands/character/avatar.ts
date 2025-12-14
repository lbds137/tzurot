/**
 * Character Avatar Handler
 *
 * Handles avatar upload and update for characters.
 * Automatically resizes large images to fit within the API gateway's body limit.
 */

import { MessageFlags } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import sharp from 'sharp';
import { createLogger, type EnvConfig } from '@tzurot/common-types';
import { fetchCharacter, updateCharacter } from './api.js';

const logger = createLogger('character-avatar');

// Avatar validation constants
const VALID_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
// Max input size - we'll resize anything larger than this
const MAX_INPUT_SIZE_MB = 25;
const MAX_INPUT_SIZE_BYTES = MAX_INPUT_SIZE_MB * 1024 * 1024;
// Target size for base64 payload (accounting for ~33% base64 overhead)
// API gateway has 10MB limit, so target 7MB raw → ~9.3MB base64
const TARGET_SIZE_BYTES = 7 * 1024 * 1024;
// Resize dimensions - large enough for quality, small enough to fit
const RESIZE_WIDTH = 1024;
const RESIZE_HEIGHT = 1024;

/**
 * Handle avatar upload subcommand
 */
export async function handleAvatar(
  interaction: ChatInputCommandInteraction,
  config: EnvConfig
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

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

    let imageBuffer = Buffer.from(await imageResponse.arrayBuffer());

    // Resize if the image is too large for the API gateway
    if (imageBuffer.length > TARGET_SIZE_BYTES) {
      logger.info({ originalSize: imageBuffer.length, slug }, 'Resizing large avatar image');

      try {
        // Progressively reduce quality until image fits within target size
        const qualityLevels = [85, 70, 55, 40];
        let resized: Buffer | null = null;

        for (const quality of qualityLevels) {
          resized = await sharp(imageBuffer)
            .resize(RESIZE_WIDTH, RESIZE_HEIGHT, {
              fit: 'inside',
              withoutEnlargement: true,
            })
            .jpeg({ quality })
            .toBuffer();

          if (resized.length <= TARGET_SIZE_BYTES) {
            logger.info({ newSize: resized.length, quality, slug }, 'Avatar image resized successfully');
            break;
          }

          logger.info({ size: resized.length, quality, slug }, 'Resize still too large, trying lower quality');
        }

        // Final check - if still too large after all quality levels, reject
        if (!resized || resized.length > TARGET_SIZE_BYTES) {
          logger.warn({ size: resized?.length, slug }, 'Image still too large after all compression attempts');
          await interaction.editReply(
            '❌ This image is too complex to resize automatically. Please use a simpler image or reduce its size manually.'
          );
          return;
        }

        imageBuffer = Buffer.from(resized);
      } catch (resizeError) {
        logger.error({ err: resizeError, slug }, 'Failed to resize avatar image');
        await interaction.editReply(
          '❌ Failed to process the image. Please try a different image format (PNG, JPG, or WebP).'
        );
        return;
      }
    }

    const base64Image = imageBuffer.toString('base64');

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

// Export constants for testing
export const _testExports = {
  VALID_IMAGE_TYPES,
  MAX_INPUT_SIZE_MB,
  MAX_INPUT_SIZE_BYTES,
  TARGET_SIZE_BYTES,
  RESIZE_WIDTH,
  RESIZE_HEIGHT,
};
