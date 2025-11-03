/**
 * Embed Image Extractor
 *
 * Extracts images and thumbnails from Discord embeds and converts them
 * to AttachmentMetadata format so they can be processed by the vision model
 */

import { Embed } from 'discord.js';
import type { AttachmentMetadata } from '@tzurot/common-types';

/**
 * Extract image and thumbnail URLs from Discord embeds as attachment metadata
 * @param embeds - Array of Discord embeds
 * @returns Array of attachment metadata for embed images, or undefined if no images
 */
export function extractEmbedImages(embeds: Embed[]): AttachmentMetadata[] | undefined {
  if (!embeds || embeds.length === 0) {
    return undefined;
  }

  const imageAttachments: AttachmentMetadata[] = [];

  for (const embed of embeds) {
    // Extract main image
    if (embed.image?.url) {
      imageAttachments.push({
        url: embed.image.url,
        contentType: 'image/png', // Discord embeds are typically PNG
        name: `embed-image-${imageAttachments.length + 1}.png`,
        size: undefined, // Size not available for embed images
      });
    }

    // Extract thumbnail
    if (embed.thumbnail?.url) {
      imageAttachments.push({
        url: embed.thumbnail.url,
        contentType: 'image/png',
        name: `embed-thumbnail-${imageAttachments.length + 1}.png`,
        size: undefined,
      });
    }
  }

  return imageAttachments.length > 0 ? imageAttachments : undefined;
}
