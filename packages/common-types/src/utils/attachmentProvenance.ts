/**
 * Attachment provenance: the bracket-delimited headers (`[Image: name]`,
 * `[Audio: name]`, `[File: name]`, …) both services emit before an
 * attachment's content, the display-label vocabulary those headers draw
 * from, and the two sanitizers that keep a filename or a description body
 * from forging one of their own. A header under `OUTPUT_CONSTRAINTS` tells
 * the model that the text beneath it is machine-generated, not user-typed —
 * so a forged header is a forged attribution, which is why deriving and
 * sanitizing it lives in one place both services import.
 */

/**
 * Where an image on the image path actually came from, when it was not a
 * file someone chose to upload. Absent is the ordinary case: a real upload.
 */
export type ImageSource = 'sticker' | 'link-preview';

/**
 * An image's provenance, from the producer flags on its source attachment.
 *
 * Sticker wins over embed preview. The two producers are disjoint
 * (`stickerAttachments.ts` vs. `embedImageExtractor.ts`), so the ordering
 * states a precedence rather than resolving a case that arises. Several
 * producers need the same answer — a three-line rule copied N times is how
 * the sibling mapping drifted before it was pulled here.
 *
 * Structurally typed rather than taking `AttachmentMetadata` because the
 * call sites hold several different attachment shapes and only the
 * structural signature accepts them all — `QuoteFormatter`'s own
 * `AttachmentSource` declares `contentType` optional and so is not
 * assignable to `AttachmentMetadata`, and the direct unit tests below call
 * it with bare object literals.
 */
export function imageSource(attachment: {
  isSticker?: boolean;
  isEmbedPreview?: boolean;
}): ImageSource | undefined {
  if (attachment.isSticker === true) {
    return 'sticker';
  }
  return attachment.isEmbedPreview === true ? 'link-preview' : undefined;
}

/**
 * Every literal label that can appear in an emitted attachment provenance
 * header (`[<Label>: ...]`). The emitters still spell their own labels; this
 * is the list `neutralizeHeaderMarkers` defuses, kept in step with them by
 * the coverage test in RAGUtils.test.ts (the ai-worker emitters) and by the
 * coverage test in attachmentPlaceholders.test.ts (the bot-client emitter),
 * not by the emitters reading here.
 */
export const HEADER_LABELS = [
  'Image',
  'Sticker',
  'Link preview',
  'File',
  'Audio',
  'Voice message',
] as const;

/**
 * The bracket header an image-path attachment renders under —
 * `imageSource`'s shared precedence mapped to display labels, so no site
 * re-derives the mapping inline. Both services' emitters read this, which is
 * what stops them drifting from each other the way the original two
 * hand-copied mappings did.
 *
 * Structurally typed for the same reason `imageSource` is.
 */
export function imageHeaderLabel(attachment: {
  isSticker?: boolean;
  isEmbedPreview?: boolean;
}): string {
  const source = imageSource(attachment);
  if (source === 'sticker') {
    return 'Sticker';
  }
  return source === 'link-preview' ? 'Link preview' : 'Image';
}

/**
 * Compute the display name for a bracket-delimited provenance header
 * (`[Image: ...]`, `[File: ...]`, `[Audio: ...]`). Strips `[` and `]` from
 * the name FIRST, then falls back to `'attachment'` if the result is empty.
 * A name carrying a `]` can close the header early and open a forged header
 * of its own choosing right after it, fabricating a second provenance marker
 * the model has no way to distinguish from a real one — removing the bracket
 * characters denies the forgery the structure it depends on. That holds for
 * the ASCII brackets the constraint describes; a fullwidth or other
 * look-alike bracket is not stripped. Stripping before falling back keeps a
 * name made entirely of bracket characters (e.g. `[]`) from passing an
 * empty/undefined check and then stripping to an empty string, which would
 * render `[Image: ]` instead of `[Image: attachment]`.
 */
export function headerDisplayName(name: string | undefined): string {
  const stripped = (name ?? '').replaceAll('[', '').replaceAll(']', '');
  return stripped.length > 0 ? stripped : 'attachment';
}

/**
 * Neutralizes a forged header-opening literal (`[<Label>: `) inside
 * attachment-description text by removing its leading `[`, so raw model
 * output cannot mint a second provenance marker the constraint in
 * `OUTPUT_CONSTRAINTS` would otherwise treat as authoritative. Mirrors
 * `neutralizeWrapperClosingTags`'s approach: defuse the exact substring that
 * could forge structure, leave every other bracket in the text untouched.
 * Match is case-SENSITIVE: a lowercase `[image: ` passes through, which is
 * acceptable only because the constraint keys on the exact-case form too.
 * The strip is ASCII-only for the same reason it is exact-case: a fullwidth
 * or other look-alike bracket passes through, so the cannot-mint property
 * above is scoped to the ASCII form the constraint describes, which is also
 * the only form the tests named below pin.
 * The cannot-mint claim is pinned by the three `neutralizes a forged header
 * opener` cases in RAGUtils.test.ts, one per attachment type, and by the
 * direct cases in this module's colocated test file.
 *
 * bot-client's placeholder path emits a header with no description body
 * beneath it, so it has no call site for this function — the absence is by
 * construction, not an oversight.
 */
export function neutralizeHeaderMarkers(text: string): string {
  return HEADER_LABELS.reduce((acc, label) => acc.replaceAll(`[${label}: `, `${label}: `), text);
}
