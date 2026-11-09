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

import { escapeRegExpLiteral } from './regexLiteral.js';

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
  'Spoiler image',
  'Sticker',
  'Link preview',
  'File',
  'Spoiler file',
  'Audio',
  'Spoiler audio',
  'Voice message',
  'Spoiler voice message',
] as const;

/**
 * The bracket header an image-path attachment renders under —
 * `imageSource`'s shared precedence mapped to display labels, so no site
 * re-derives the mapping inline. Both services' emitters read this, which is
 * what stops them drifting from each other the way the original two
 * hand-copied mappings did.
 *
 * Precedence: sticker → 'Sticker'; link-preview → 'Link preview'; a plain
 * upload the poster marked as a spoiler → 'Spoiler image'; otherwise
 * 'Image'. A Components-V2 gallery link-preview item CAN be spoilered (the
 * poster can mark a gallery item as a spoiler independently of the plain-
 * upload flag), and link-preview wins: the header states provenance (the
 * participant shared a link, not a file), while the spoiler flag still
 * reaches the render as `spoiler="true"` on the `<image>` element — see
 * `attachmentSpoiler`. A synthetic sticker attachment is never spoilered, so
 * only the link-preview arm of this precedence resolves a case that
 * genuinely arises.
 *
 * Structurally typed for the same reason `imageSource` is.
 */
export function imageHeaderLabel(attachment: {
  isSticker?: boolean;
  isEmbedPreview?: boolean;
  isSpoiler?: boolean;
}): string {
  const source = imageSource(attachment);
  if (source === 'sticker') {
    return 'Sticker';
  }
  if (source === 'link-preview') {
    return 'Link preview';
  }
  return attachment.isSpoiler === true ? 'Spoiler image' : 'Image';
}

/**
 * The `spoiler="true"` attribute value every attachment-element producer
 * uses to carry a poster's spoiler flag — image, file, voice, and audio
 * alike, not only the image path `imageSource` mirrors. Returns `true` iff
 * the attachment is spoilered, else `undefined` — so the attribute is
 * omitted rather than rendered as `spoiler="false"`.
 */
export function attachmentSpoiler(attachment: { isSpoiler?: boolean }): true | undefined {
  return attachment.isSpoiler === true ? true : undefined;
}

/**
 * The bracket header a generic-file attachment renders under: 'Spoiler file'
 * when the poster hid it behind a spoiler, else 'File'. Parallel to
 * `imageHeaderLabel`'s spoiler arm, but files have no sticker/link-preview
 * provenance to precede it.
 */
export function fileHeaderLabel(attachment: { isSpoiler?: boolean }): string {
  return attachment.isSpoiler === true ? 'Spoiler file' : 'File';
}

/**
 * The bracket header a non-voice audio attachment renders under: 'Spoiler
 * audio' when the poster hid it behind a spoiler, else 'Audio'. Voice
 * messages use `voiceHeaderLabel` instead — a voice message's header names
 * its duration, not a filename, so one attachment takes one or the other.
 */
export function audioHeaderLabel(attachment: { isSpoiler?: boolean }): string {
  return attachment.isSpoiler === true ? 'Spoiler audio' : 'Audio';
}

/**
 * The bracket header a voice message renders under: 'Spoiler voice message'
 * when the poster hid it behind a spoiler, else 'Voice message'.
 */
export function voiceHeaderLabel(attachment: { isSpoiler?: boolean }): string {
  return attachment.isSpoiler === true ? 'Spoiler voice message' : 'Voice message';
}

/**
 * Regex character-class source for the `Ps`/`Pe` characters deliberately kept
 * — spliced into a negative lookahead, not a plain list of characters. Two
 * groups: the ASCII `(` `)` `{` `}` (not look-alikes of `[` `]`, common in
 * filenames), and five quotation marks Unicode files under `Ps`/`Pe`: the
 * low-9 quotes U+201A and U+201E (`Ps`), U+301D (`Ps`), and U+301E and U+301F
 * (`Pe`). A quote cannot open or close a `[ ]` header, so stripping one buys
 * nothing and mangles quoted German, Polish or CJK filenames. Pinned by the
 * kept-quote cases in this module's colocated test file.
 */
const KEPT_CHARACTER_CLASS = '[(){}\\u201A\\u201E\\u301D\\u301E\\u301F]';

/**
 * Regex source (for a `u`-flag pattern) matching one bracket-class character:
 * any Unicode `Ps`/`Pe` character except the kept set (`KEPT_CHARACTER_CLASS`:
 * ASCII `(` `)` `{` `}` and five quotation marks).
 *
 * Unpinned limit: bracket-shaped characters outside `Ps`/`Pe`, e.g. the math
 * bracket pieces U+23A1 to U+23A6 (category `Sm`), pass through both
 * sanitizers; this case is neither handled nor tested.
 */
const HEADER_BRACKET_CLASS_SOURCE = `(?!${KEPT_CHARACTER_CLASS})[\\p{Ps}\\p{Pe}]`;

/**
 * The opener half of the class: `Ps` minus the kept `Ps` members (ASCII `(`
 * `{` and the quotes U+201A, U+201E, U+301D), derived from the shared
 * class (`HEADER_BRACKET_CLASS_SOURCE`) so the two halves cannot drift.
 */
const HEADER_OPENER_SOURCE = `(?=\\p{Ps})${HEADER_BRACKET_CLASS_SOURCE}`;

const BRACKET_CLASS_GLOBAL = new RegExp(HEADER_BRACKET_CLASS_SOURCE, 'gu');

/**
 * A run of openers directly before `<Label>: `. The leading lookbehind
 * anchors the match at the start of a run, intended to keep a long bracket
 * run from being retried from every position (not verified by a committed
 * test; a one-off 200k-bracket probe ran in milliseconds). Label order is
 * irrelevant: the lookahead requires the colon and space right after the
 * label.
 */
const HEADER_OPENER_RUN = new RegExp(
  `(?<!${HEADER_OPENER_SOURCE})(?:${HEADER_OPENER_SOURCE})+(?=(?:${HEADER_LABELS.map(escapeRegExpLiteral).join('|')}): )`,
  'gu'
);

/**
 * Compute the display name for a bracket-delimited provenance header
 * (`[Image: ...]`, `[File: ...]`, `[Audio: ...]`). Strips every bracket-class
 * character from the name FIRST, then falls back to `'attachment'` if the
 * result is empty. A name carrying a `]` can close the header early and open
 * a forged header of its own choosing right after it, fabricating a second
 * provenance marker the model has no way to distinguish from a real one —
 * removing the bracket characters denies the forgery the structure it
 * depends on.
 *
 * The stripped class is every Unicode `Ps` (open punctuation) and `Pe` (close
 * punctuation) character (`HEADER_BRACKET_CLASS_SOURCE`): ASCII `[` `]`, the
 * fullwidth `［` `］`, CJK corner and lenticular brackets, and so on — except
 * the kept set (`KEPT_CHARACTER_CLASS`): the four ASCII `(` `)` `{` `}`, which
 * are not look-alikes of `[` `]` and are common in real filenames
 * (`photo (1).jpg`), and five quotation marks Unicode files under `Ps`/`Pe`
 * (U+201A, U+201E, U+301D, U+301E, U+301F), which cannot open or close a
 * `[ ]` header, so stripping them would only mangle quoted German, Polish or
 * CJK filenames (`„Bericht“.pdf`). The parenthesis/brace exclusion is
 * ASCII-only, so the fullwidth `（` `）` (U+FF08/U+FF09) are
 * stripped (pinned by the fullwidth-parentheses case). CJK or fullwidth
 * filenames therefore lose their brackets; that is accepted.
 * Pinned by the look-alike, CJK, kept-four and byte-identical cases in this
 * module's colocated test file. Stripping before falling back keeps a name
 * made entirely of bracket characters (e.g. `[]` or `［］`) from passing an
 * empty/undefined check and then stripping to an empty string, which would
 * render `[Image: ]` instead of `[Image: attachment]`.
 *
 * Class limits (characters outside `Ps`/`Pe`): see `HEADER_BRACKET_CLASS_SOURCE`.
 */
export function headerDisplayName(name: string | undefined): string {
  const stripped = (name ?? '').replace(BRACKET_CLASS_GLOBAL, '');
  return stripped.length > 0 ? stripped : 'attachment';
}

/**
 * Neutralizes a forged header-opening literal (`[<Label>: `) inside
 * attachment-description text by removing its leading opener, so raw model
 * output cannot mint a second provenance marker the constraint in
 * `OUTPUT_CONSTRAINTS` would otherwise treat as authoritative. Mirrors
 * `neutralizeWrapperClosingTags`'s approach: defuse the exact substring that
 * could forge structure, leave every other bracket in the text untouched.
 * Match is case-SENSITIVE: a lowercase `[image: ` passes through, which is
 * acceptable only because the constraint keys on the exact-case form too.
 *
 * An opener is any Unicode `Ps` character except the kept ASCII `(` `{` and
 * the kept quotation marks U+201A, U+201E, U+301D (so `[`, the fullwidth `［`,
 * CJK `「` `【`, …), the same class `headerDisplayName` strips minus its close
 * half. A RUN of consecutive openers directly before `<Label>: ` is removed
 * whole, so `［[Image: x` and `[[Image: x` both become `Image: x` rather than
 * leaving a residual forge. Pinned by the look-alike, `(`/`{`, kept-quote,
 * lowercase, untouched-bracket and run-strip cases in this module's colocated
 * test file.
 *
 * Unpinned limit: the colon and space after the label are matched as ASCII
 * only (a look-alike colon such as fullwidth U+FF1A is out of scope); and a
 * character between the opener and the label (a space, or a zero-width
 * character such as U+200B) means `neutralizeHeaderMarkers` does not defuse
 * the opener. Neither case is handled or tested. Class limits (characters
 * outside `Ps`/`Pe`): see `HEADER_BRACKET_CLASS_SOURCE`.
 *
 * The cannot-mint claim for the ASCII form is pinned by the three
 * `neutralizes a forged header opener` cases in RAGUtils.test.ts, one per
 * attachment type, and by the direct cases in this module's colocated test
 * file.
 *
 * bot-client's placeholder path emits a header with no description body
 * beneath it, so it has no call site for this function — the absence is by
 * construction, not an oversight.
 */
export function neutralizeHeaderMarkers(text: string): string {
  return text.replace(HEADER_OPENER_RUN, '');
}
