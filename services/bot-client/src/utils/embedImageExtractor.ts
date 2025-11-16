/**
 * Embed Image Extractor
 *
 * Extracts images and thumbnails from Discord embeds and converts them
 * to AttachmentMetadata format so they can be processed by the vision model
 */

import { Embed } from 'discord.js';
import type { AttachmentMetadata } from '@tzurot/common-types';
import { CONTENT_TYPES, EMBED_NAMING } from '@tzurot/common-types';

/**
 * Extract image and thumbnail URLs from Discord embeds as attachment metadata
 * @param embeds - Array of Discord embeds (can be undefined)
 * @returns Array of attachment metadata for embed images, or undefined if no images
 */
export function extractEmbedImages(embeds: Embed[] | undefined): AttachmentMetadata[] | undefined {
  if (!embeds || embeds.length === 0) {
    return undefined;
  }

  const imageAttachments: AttachmentMetadata[] = [];

  for (const embed of embeds) {
    // Extract main image
    if (embed.image?.url !== undefined && embed.image.url.length > 0) {
      imageAttachments.push({
        url: embed.image.url,
        contentType: CONTENT_TYPES.IMAGE_PNG, // Discord embeds are typically PNG
        name: `${EMBED_NAMING.IMAGE_PREFIX}${imageAttachments.length + 1}${EMBED_NAMING.DEFAULT_EXTENSION}`,
        size: undefined, // Size not available for embed images
      });
    }

    // Extract thumbnail
    if (embed.thumbnail?.url !== undefined && embed.thumbnail.url.length > 0) {
      imageAttachments.push({
        url: embed.thumbnail.url,
        contentType: CONTENT_TYPES.IMAGE_PNG,
        name: `${EMBED_NAMING.THUMBNAIL_PREFIX}${imageAttachments.length + 1}${EMBED_NAMING.DEFAULT_EXTENSION}`,
        size: undefined,
      });
    }
  }

  return imageAttachments.length > 0 ? imageAttachments : undefined;
}
