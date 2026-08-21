/**
 * Embed Attachment Naming
 *
 * The single derivation of the synthetic filename used for an image lifted out
 * of a Discord embed. Two independent producers need the same string: the
 * extractor that mints the synthetic vision attachment, and the embed XML
 * writer that echoes the name onto the embed's own image element so the model
 * can bind a description back to the embed it came from. Both derive from the
 * embed's position in the message's embed array, so neither has to know about
 * the other.
 */

import { EMBED_NAMING } from '@tzurot/common-types/constants/media';

/** Which image slot of an embed a synthetic attachment came from. */
export type EmbedImageSlot = typeof EMBED_NAMING.IMAGE_SLOT | typeof EMBED_NAMING.THUMBNAIL_SLOT;

/**
 * Build the synthetic attachment name for one embed image slot.
 *
 * @param embedIndex - Zero-based index of the embed within its message's embed array
 * @param slot - Which image slot of that embed
 * @returns e.g. `embed-1-image.png` (the index is rendered 1-based)
 */
export function embedImageAttachmentName(embedIndex: number, slot: EmbedImageSlot): string {
  return `${EMBED_NAMING.PREFIX}${embedIndex + 1}-${slot}${EMBED_NAMING.DEFAULT_EXTENSION}`;
}
