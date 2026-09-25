/**
 * Embed Attachment Naming
 *
 * The single derivation of the synthetic filename used for an image lifted out
 * of a Discord embed. Two independent producers need the same string: the
 * extractor that mints the synthetic vision attachment, and the embed XML
 * writer that echoes the name onto the embed's own image element so the model
 * can bind a description back to the embed it came from. Both derive from the
 * embed's position in its SOURCE embed array — plus, for an embed inside a
 * forwarded snapshot, the snapshot's own position in the message's snapshot
 * collection — so neither producer has to know about the other. Every walker
 * that visits snapshots — `extractForwardedAttachments`, the snapshot XML
 * loop in `buildMessageContent`, and `ReferenceFormatter.appendForwardedSnapshots`
 * — iterates the same `message.messageSnapshots` collection in the same
 * order, so their snapshot ordinals agree without coordination; pinned by the
 * three-walker test in ReferenceFormatter.test.ts. Covers three producer
 * pairs: the legacy image slot, the legacy thumbnail slot, and one item of a
 * Components-V2 media gallery.
 */

import { EMBED_NAMING } from '@tzurot/common-types/constants/media';

/** Which image slot of an embed a synthetic attachment came from. */
export type EmbedImageSlot = typeof EMBED_NAMING.IMAGE_SLOT | typeof EMBED_NAMING.THUMBNAIL_SLOT;

/**
 * Scopes a synthetic embed attachment name to the forwarded snapshot it came
 * from. Absent for the message's own (wrapper) embeds; present for an embed
 * inside a forwarded snapshot, whose embed array restarts at index 0 for
 * every snapshot — without this, two snapshots' first embeds would both mint
 * `embed-1-image.png`.
 */
export interface EmbedNameScope {
  /** Zero-based position of the snapshot in the message's snapshot collection (rendered 1-based) */
  snapshotIndex: number;
}

/**
 * Build the shared `embed-N` / `forward-K-embed-N` stem both name functions extend.
 */
function embedNameStem(embedIndex: number, scope: EmbedNameScope | undefined): string {
  const base = `${EMBED_NAMING.PREFIX}${embedIndex + 1}`;
  return scope === undefined
    ? base
    : `${EMBED_NAMING.SNAPSHOT_PREFIX}${scope.snapshotIndex + 1}-${base}`;
}

/**
 * Build the synthetic attachment name for one embed image slot.
 *
 * @param embedIndex - Zero-based index of the embed within its source embed array
 * @param slot - Which image slot of that embed
 * @param scope - Snapshot scope, when this embed came from a forwarded snapshot
 * @returns e.g. `embed-1-image.png` (the index is rendered 1-based), or
 *   `forward-2-embed-1-image.png` for an embed in the second forwarded snapshot
 */
export function embedImageAttachmentName(
  embedIndex: number,
  slot: EmbedImageSlot,
  scope?: EmbedNameScope
): string {
  return `${embedNameStem(embedIndex, scope)}-${slot}${EMBED_NAMING.DEFAULT_EXTENSION}`;
}

/**
 * Build the synthetic attachment name for one item of an embed's
 * Components-V2 media gallery.
 *
 * @param embedIndex - Zero-based index of the embed within its source embed array
 * @param mediaIndex - Zero-based index of the media item within the embed's gallery
 * @param scope - Snapshot scope, when this embed came from a forwarded snapshot
 * @returns e.g. `embed-1-media-1.png` (both indexes are rendered 1-based), or
 *   `forward-2-embed-1-media-3.png` for a gallery item in the second forwarded snapshot
 */
export function embedMediaAttachmentName(
  embedIndex: number,
  mediaIndex: number,
  scope?: EmbedNameScope
): string {
  return `${embedNameStem(embedIndex, scope)}-${EMBED_NAMING.MEDIA_SLOT}-${mediaIndex + 1}${EMBED_NAMING.DEFAULT_EXTENSION}`;
}
