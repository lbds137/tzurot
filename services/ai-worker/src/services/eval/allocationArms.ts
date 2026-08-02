/**
 * Attachment-allocation arm queries (TASK-393's A/B).
 *
 * The search-query builder is unbounded while the embedder reads only 512
 * tokens — on attachment-bearing turns the description overflows the window at
 * the MEDIAN (mined p50 3,654 chars against a ~2,000-char window). These arms
 * sweep HOW MUCH attachment text the query carries, dose-response style, so the
 * judged pools can locate the optimum instead of reasoning to it:
 *
 * - `bare-dense`    — the user's own text only (0 attachment chars; control).
 * - `lead-dense`    — bare + the lead sentence of each image description
 *                     (voice transcripts ride whole: they ARE the user's words,
 *                     not a model's description of them).
 * - `budget-dense`  — bare + descriptions truncated to half the window
 *                     (`ATTACHMENT_SEARCH_BUDGET_CHARS`), the per-part-allocation
 *                     policy shape.
 * - `current-dense` — bare + full descriptions; the embedder truncates at 512
 *                     tokens keeping the head. This is production behavior.
 *
 * ## Stored format vs. the live query
 *
 * The goldens carry the STORED enrichment (`[Image: name]` headers, transcripts
 * in `<voice_transcripts>` wrappers — `buildAttachmentDescriptions`'s display
 * format). The live search query embeds `extractContentDescriptions` output:
 * raw descriptions/transcripts joined by blank lines, no headers, no wrappers.
 * {@link parseAttachmentSegments} strips the storage dressing so every arm —
 * including `current` — is built from the text production actually embeds.
 *
 * The budget constant and truncation come from the PRODUCTION policy module
 * (`../prompt/searchQueryBudget.ts`) — the arm measures literally the code
 * that ships, so measurement and policy cannot drift apart.
 */

import {
  ATTACHMENT_SEARCH_BUDGET_CHARS,
  truncateAtWordBoundary,
} from '../prompt/searchQueryBudget.js';

/** Dense arms in report order: production first, then ascending attachment text. */
export const ALLOCATION_DENSE_ARMS = [
  'current-dense',
  'bare-dense',
  'lead-dense',
  'budget-dense',
] as const;

export type AllocationDenseArm = (typeof ALLOCATION_DENSE_ARMS)[number];

/**
 * The FTS diversity arm's name — shared by the pooling producer and the scoring
 * consumer so a rename can't leave the scorer silently reading an arm no
 * candidate carries.
 */
export const ALLOCATION_FTS_ARM = 'current-fts';

/** One attachment's query-relevant text, stripped of storage formatting. */
export interface AttachmentSegment {
  /** True for voice/audio transcripts — user speech, never lead-truncated. */
  isTranscript: boolean;
  /** Header-stripped, wrapper-unwrapped text, as the live search query carries it. */
  text: string;
}

/** Storage-format attachment headers, at the start or after a blank line. */
const HEADER_RE = /(?:^|\n\n)\[(?:Image|Sticker|Voice message|Audio|File):[^\]\n]*\]/g;

const TRANSCRIPT_RE = /<transcript>([\s\S]*?)<\/transcript>/g;

/**
 * Split a stored attachment block into per-attachment segments, dropping the
 * bracket headers and unwrapping `<voice_transcripts>` down to the spoken text.
 * Header-only entries (bare placeholders with no description) yield nothing.
 */
export function parseAttachmentSegments(attachmentText: string): AttachmentSegment[] {
  const starts: number[] = [];
  for (const match of attachmentText.matchAll(HEADER_RE)) {
    starts.push(match.index + (match[0].startsWith('\n\n') ? 2 : 0));
  }
  const segments: AttachmentSegment[] = [];
  starts.forEach((start, index) => {
    const block = attachmentText.slice(start, starts[index + 1]).trim();
    const headerEnd = block.indexOf('\n');
    const body = headerEnd === -1 ? '' : block.slice(headerEnd + 1).trim();
    if (body.length === 0) {
      return;
    }
    if (body.includes('<voice_transcripts>')) {
      const spoken = [...body.matchAll(TRANSCRIPT_RE)]
        .map(match => match[1].trim())
        .filter(text => text.length > 0)
        .join('\n');
      if (spoken.length > 0) {
        segments.push({ isTranscript: true, text: spoken });
      }
      return;
    }
    segments.push({ isTranscript: false, text: body });
  });
  return segments;
}

/**
 * First sentence of a description (up to `.` / `!` / `?` before whitespace or
 * end), falling back to the first line, then the whole text. Abbreviation
 * false-positives ("approx. 3m") cut early — tolerable for an eval arm whose
 * question is "does a SHORT lead beat the full description", not the exact cut.
 */
export function leadSentence(text: string): string {
  const match = /^[\s\S]*?[.!?](?=\s|$)/.exec(text);
  if (match !== null) {
    return match[0].trim();
  }
  const firstLine = text.split('\n', 1)[0].trim();
  return firstLine.length > 0 ? firstLine : text.trim();
}

/**
 * Build every dense arm's query for one golden. An empty string means the arm
 * has nothing to search with (an image-only turn under the bare policy) — the
 * pooling runner skips the retrieval and the arm scores the miss it earned.
 */
export function buildAllocationQueries(golden: {
  messageBare: string;
  attachmentText: string;
}): Record<AllocationDenseArm, string> {
  const segments = parseAttachmentSegments(golden.attachmentText);
  const full = joinParts(...segments.map(segment => segment.text));
  const lead = joinParts(
    ...segments.map(segment => (segment.isTranscript ? segment.text : leadSentence(segment.text)))
  );
  const bare = golden.messageBare.trim();
  return {
    'current-dense': joinParts(bare, full),
    'bare-dense': bare,
    'lead-dense': joinParts(bare, lead),
    'budget-dense': joinParts(bare, truncateAtWordBoundary(full, ATTACHMENT_SEARCH_BUDGET_CHARS)),
  };
}

/** Join non-empty parts with the builder's separator (blank line). */
function joinParts(...parts: string[]): string {
  return parts.filter(part => part.length > 0).join('\n\n');
}
