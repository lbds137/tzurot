/**
 * Embed Image Extractor
 *
 * Extracts images and thumbnails from Discord embeds and converts them
 * to AttachmentMetadata format so they can be processed by the vision model.
 * Each synthetic attachment is named from the embed's own index and image
 * slot (see `embedAttachmentName.ts`), not a running counter, so the name is
 * reproducible from the embed's position alone. Covers three slots: the
 * legacy image, the legacy thumbnail, and each item of a Components-V2
 * media gallery.
 */

import { type Embed } from 'discord.js';
import { CONTENT_TYPES, EMBED_NAMING } from '@tzurot/common-types/constants/media';
import { type AttachmentMetadata } from '@tzurot/common-types/types/schemas/discord';
import { embedImageAttachmentName, embedMediaAttachmentName } from './embedAttachmentName.js';
import { readEmbedComponents, collectEmbedComponentMedia } from './embedComponents.js';

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

  // Name each synthetic attachment from (embedIndex, slot) rather than a
  // running counter over `imageAttachments.length`: a counter interleaves
  // across embeds and slots (image, thumbnail, image, thumbnail, ...), so
  // the per-embed XML echo (EmbedParser) has no way to reconstruct which
  // name belongs to which embed. Deriving from the embed's own position
  // keeps both producers in agreement without either knowing about the other.
  for (const [embedIndex, embed] of embeds.entries()) {
    // Prefer proxyURL: Discord re-hosts external embed images on media.discordapp.net,
    // which satisfies our strict CDN allowlist. `url` is the original source (e.g. Reddit,
    // Imgur) and will be rejected. Fall back to `url` only when proxyURL is absent —
    // bot-sent embeds occasionally ship without it. Discord re-hosts Components-V2
    // gallery media on images-ext-1.discordapp.net instead, which is not on
    // ai-worker's CDN allowlist, so it is fetched through the external-image
    // fallback the same as a non-proxied legacy image; preferring the proxy
    // still avoids origin-host 403s.
    const imageUrl = embed.image?.proxyURL ?? embed.image?.url;
    if (imageUrl !== undefined && imageUrl.length > 0) {
      imageAttachments.push({
        url: imageUrl,
        contentType: CONTENT_TYPES.IMAGE_PNG,
        name: embedImageAttachmentName(embedIndex, EMBED_NAMING.IMAGE_SLOT),
        isEmbedPreview: true,
        size: undefined,
      });
    }

    const thumbnailUrl = embed.thumbnail?.proxyURL ?? embed.thumbnail?.url;
    if (thumbnailUrl !== undefined && thumbnailUrl.length > 0) {
      imageAttachments.push({
        url: thumbnailUrl,
        contentType: CONTENT_TYPES.IMAGE_PNG,
        name: embedImageAttachmentName(embedIndex, EMBED_NAMING.THUMBNAIL_SLOT),
        isEmbedPreview: true,
        size: undefined,
      });
    }

    const galleryMedia = collectEmbedComponentMedia(readEmbedComponents(embed.toJSON()));
    for (const [mediaIndex, media] of galleryMedia.entries()) {
      imageAttachments.push({
        url: media.proxyUrl ?? media.url,
        contentType: media.contentType ?? CONTENT_TYPES.IMAGE_PNG,
        name: embedMediaAttachmentName(embedIndex, mediaIndex),
        isEmbedPreview: true,
        size: undefined,
      });
    }
  }

  return imageAttachments.length > 0 ? imageAttachments : undefined;
}
