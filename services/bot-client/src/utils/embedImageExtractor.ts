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
    // Prefer proxyURL: Discord re-hosts external embed images on media.discordapp.net,
    // which satisfies our strict CDN allowlist. `url` is the original source (e.g. Reddit,
    // Imgur) and will be rejected. Fall back to `url` only when proxyURL is absent —
    // bot-sent embeds occasionally ship without it.
    const imageUrl = embed.image?.proxyURL ?? embed.image?.url;
    if (imageUrl !== undefined && imageUrl.length > 0) {
      imageAttachments.push({
        url: imageUrl,
        contentType: CONTENT_TYPES.IMAGE_PNG,
        name: `${EMBED_NAMING.IMAGE_PREFIX}${imageAttachments.length + 1}${EMBED_NAMING.DEFAULT_EXTENSION}`,
        size: undefined,
      });
    }

    const thumbnailUrl = embed.thumbnail?.proxyURL ?? embed.thumbnail?.url;
    if (thumbnailUrl !== undefined && thumbnailUrl.length > 0) {
      imageAttachments.push({
        url: thumbnailUrl,
        contentType: CONTENT_TYPES.IMAGE_PNG,
        name: `${EMBED_NAMING.THUMBNAIL_PREFIX}${imageAttachments.length + 1}${EMBED_NAMING.DEFAULT_EXTENSION}`,
        size: undefined,
      });
    }
  }

  return imageAttachments.length > 0 ? imageAttachments : undefined;
}
