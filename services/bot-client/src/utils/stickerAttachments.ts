/**
 * Sticker → synthetic attachment conversion.
 *
 * A sticker has a stable URL and a derivable content type, which is everything
 * the existing attachment → download → vision → describe chain needs. Rather
 * than building a parallel describe path, stickers are handed to that chain as
 * `AttachmentMetadata` — the same trick `embedImageExtractor.ts` already uses
 * for embed images — so they inherit the CDN allowlist, the resize/size caps,
 * the vision-model cascade, the failure fallbacks, and the description cache
 * for free.
 *
 * Two properties of stickers shape everything here:
 *
 * 1. **The image is immutable per snowflake.** Changing a sticker's image
 *    requires delete + re-upload, which mints a NEW id (`GuildStickerEditOptions`
 *    accepts only name/description/tags — no file). So the snowflake is a
 *    permanently valid cache key: `AttachmentMetadata.id` feeds
 *    `deriveAttachmentCacheKey`, and the description never needs invalidating.
 * 2. **Lottie stickers have no raster form.** Their CDN URL resolves to a
 *    `.json` vector-animation document, not an image, so they cannot go down a
 *    vision path at all and are excluded here. `stickerPollDescriptions.ts`
 *    still renders their name + Discord-authored description, which is a
 *    convenient overlap: Discord's own Lottie packs ship real descriptions, so
 *    the un-rasterizable slice is largely the slice that needs vision least.
 */

import { StickerFormatType, type Message, type Sticker } from 'discord.js';
import { CONTENT_TYPES } from '@tzurot/common-types/constants/media';
import { type AttachmentMetadata } from '@tzurot/common-types/types/schemas/discord';
import { collectAllStickers } from './stickerPollDescriptions.js';

/**
 * Whether a sticker has a raster form a vision model could look at.
 *
 * Enumerates the rasterizable formats rather than excluding Lottie, so a future
 * Discord format defaults to "not rasterizable" — a new vector format would
 * otherwise silently start feeding `.json` documents to the vision pipeline.
 */
export function isRasterizableSticker(sticker: Sticker): boolean {
  return (
    sticker.format === StickerFormatType.PNG ||
    sticker.format === StickerFormatType.APNG ||
    sticker.format === StickerFormatType.GIF
  );
}

/**
 * Content type for a rasterizable sticker's CDN URL.
 *
 * APNG is served with a `.png` extension (it IS a PNG, animated), so it shares
 * PNG's type. Only GIF differs. Animated formats get their first frame
 * described, which is an accepted limitation.
 */
function stickerContentType(sticker: Sticker): string {
  return sticker.format === StickerFormatType.GIF
    ? CONTENT_TYPES.IMAGE_GIF
    : CONTENT_TYPES.IMAGE_PNG;
}

/**
 * Convert a message's rasterizable stickers into synthetic image attachments.
 *
 * Returns `undefined` (not `[]`) when there is nothing to convert, matching
 * `extractEmbedImages`'s contract so both can be spread the same way.
 */
export function extractStickerImages(message: Message): AttachmentMetadata[] | undefined {
  const rasterizable = collectAllStickers(message).filter(isRasterizableSticker);
  if (rasterizable.length === 0) {
    return undefined;
  }

  return rasterizable.map(sticker => ({
    // The snowflake IS the cache identity — see the immutability note above.
    id: sticker.id,
    url: sticker.url,
    contentType: stickerContentType(sticker),
    name: sticker.name,
    isSticker: true,
  }));
}
