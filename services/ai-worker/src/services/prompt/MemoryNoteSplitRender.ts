/**
 * The memory-archive SPLIT render's pure pieces: capping the user turn and
 * assembling one split note's body across its four arms (verbatim fallback /
 * summary / excerpt / facts). `MemoryFormatter.ts` stays a thin dispatcher over
 * these — see its `formatSingleMemory` for the mode branch.
 *
 * Design: docs/proposals/backlog/memory-archive-format.md (D1-D10).
 */

import { escapeXmlContent } from '@tzurot/common-types/utils/promptSanitizer';
import { stripQuoteLines } from '@tzurot/common-types/utils/memoryContentSplit';
import {
  HIGH_SURROGATE_MIN,
  HIGH_SURROGATE_MAX,
} from '@tzurot/common-types/utils/codePointTruncation';
import { replacePromptPlaceholders } from '../../utils/promptPlaceholders.js';
import { stripLegacyLocationSpans } from './legacyLocationSpans.js';
import type { MemoryDocument, FactRenderNames } from '../ConversationalRAGTypes.js';

/** Catalog-wide p95 of the stored user half is ≈ 3.0k chars at measurement; the cap keeps a
 *  long note from crowding the archive budget. Boundary pinned by MEM-ARCH-004's test. */
export const ARCHIVE_USER_TURN_CAP_CHARS = 3000;

/** Bounded verbatim excerpt cap for own notes with no summary (MEM-ARCH-038). Boundary pinned by test. */
export const ARCHIVE_ASSISTANT_EXCERPT_CAP_CHARS = 700;

/** Truncation marker appended after a cap cut: a leading space then the bracketed ellipsis. */
const CAP_MARKER = ' […]';

/**
 * Cap `text` at `capChars`, preferring to cut at the last whitespace at or
 * before the cap (never mid-word); a hard cut at the cap is the fallback when
 * no whitespace exists in range.
 */
function capTextAt(text: string, capChars: number): { text: string; capped: boolean } {
  if (text.length <= capChars) {
    return { text, capped: false };
  }
  let cutIndex = -1;
  for (let i = capChars; i >= 0; i -= 1) {
    if (/\s/.test(text.charAt(i))) {
      cutIndex = i;
      break;
    }
  }
  let effectiveCutIndex = cutIndex >= 0 ? cutIndex : capChars;
  // A whitespace cut can never land mid-pair (surrogates are never whitespace),
  // so only the hard-cut fallback needs the check: never emit a lone high
  // surrogate at the end of the truncated text.
  if (cutIndex < 0) {
    const precedingCodeUnit = text.charCodeAt(effectiveCutIndex - 1);
    if (precedingCodeUnit >= HIGH_SURROGATE_MIN && precedingCodeUnit <= HIGH_SURROGATE_MAX) {
      effectiveCutIndex -= 1;
    }
  }
  const truncated = text.slice(0, effectiveCutIndex);
  return { text: truncated + CAP_MARKER, capped: true };
}

/**
 * Cap `text` at {@link ARCHIVE_USER_TURN_CAP_CHARS}, preferring to cut at the
 * last whitespace at or before the cap (never mid-word); a hard cut at the
 * cap is the fallback when no whitespace exists in range.
 */
// @spec MEM-ARCH-004 — the 3,000-char cap with the ` […]` marker
export function capUserTurn(text: string): { text: string; capped: boolean } {
  return capTextAt(text, ARCHIVE_USER_TURN_CAP_CHARS);
}

/**
 * Cap `text` at {@link ARCHIVE_ASSISTANT_EXCERPT_CAP_CHARS}, preferring to cut
 * at the last whitespace at or before the cap (never mid-word); a hard cut at
 * the cap is the fallback when no whitespace exists in range.
 */
// @spec MEM-ARCH-038 — the 700-char assistant excerpt cap
export function capAssistantExcerpt(text: string): { text: string; capped: boolean } {
  return capTextAt(text, ARCHIVE_ASSISTANT_EXCERPT_CAP_CHARS);
}

/** Result of rendering one split-mode note body. */
export interface SplitNoteBody {
  body: string;
  capped: boolean;
  /** Quote lines stripped from the USER turn (D1's rider). Assistant-side strips are not counted — the counter keeps its user-side meaning. */
  quoteLinesStripped: number;
  usedFallback: boolean;
  /** Rendered from a stored summary (D2's arm S) rather than from linked facts. */
  usedSummary: boolean;
  /** Rendered with a bounded verbatim assistant excerpt (MEM-ARCH-038) rather than summary or facts alone. */
  usedExcerpt: boolean;
}

/** Resolve arm S's speaker label: the doc's own `personalityName` when non-empty, else `names.personalityName`. */
function resolveSummaryPersonalityName(
  doc: MemoryDocument,
  names: FactRenderNames | undefined
): string | undefined {
  const docPersonalityName = doc.metadata?.personalityName;
  return docPersonalityName !== undefined && docPersonalityName.length > 0
    ? docPersonalityName
    : names?.personalityName;
}

/** Resolve a fact statement's `{user}`/`{assistant}` placeholders — same guard `formatSingleFact` uses. */
function resolveFactStatement(statement: string, names: FactRenderNames | undefined): string {
  const subjectName = names?.subjectName;
  const personalityName = names?.personalityName;
  if (
    subjectName === undefined ||
    subjectName.length === 0 ||
    personalityName === undefined ||
    personalityName.length === 0
  ) {
    return statement;
  }
  return replacePromptPlaceholders(statement, subjectName, personalityName, names?.discordUsername);
}

/**
 * Append the MEM-ARCH-038 excerpt line for a no-summary OWN note: the
 * assistant half of the stored content, capped and escaped, under its
 * speaker label. Returns whether an excerpt line was appended.
 */
// @spec MEM-ARCH-038 — own notes with no summary render a capped verbatim assistant excerpt
function appendAssistantExcerpt(
  lines: string[],
  doc: MemoryDocument,
  names: FactRenderNames | undefined
): { appended: boolean } {
  if (doc.metadata?.archiveRender?.foreign === true) {
    return { appended: false };
  }
  // Chunk rows are partial template slices — mirror of hasSummary's mapper-side exclusion (memoryUtils.ts).
  if (doc.metadata?.chunkGroupId !== null && doc.metadata?.chunkGroupId !== undefined) {
    return { appended: false };
  }
  const assistant = doc.metadata?.assistantTurn;
  if (assistant === undefined) {
    return { appended: false };
  }

  // The excerpt needs NO placeholder resolution: the stamped half is
  // placeholder-resolved at mapQueryResultToDocument, mirroring userTurn, so
  // the render needs no second pass.
  const afterLocationStrip = stripLegacyLocationSpans(assistant);
  const trimmed = afterLocationStrip.trim();
  if (trimmed.length === 0) {
    return { appended: false };
  }

  // A `> ` line inside an assistant half usually quotes the user, but can
  // carry quoted own-prose or another character's words; stripping drops
  // all three classes rather than deciding per line.
  const { text: afterQuoteStrip } = stripQuoteLines(trimmed);
  const trimmedAfterStrip = afterQuoteStrip.trim();
  if (trimmedAfterStrip.length === 0) {
    return { appended: false };
  }

  const collapsed = trimmedAfterStrip.replace(/\s+/g, ' ');
  const { text: cappedExcerpt } = capAssistantExcerpt(collapsed);
  const personalityName = resolveSummaryPersonalityName(doc, names);
  const escapedExcerpt = escapeXmlContent(cappedExcerpt);
  lines.push(
    personalityName !== undefined && personalityName.length > 0
      ? `${escapeXmlContent(personalityName)}: ${escapedExcerpt}`
      : escapedExcerpt
  );
  return { appended: true };
}

/**
 * Render one memory doc's split-mode note body: the user turn verbatim
 * (quote-stripped, capped, escaped) followed by a stored assistant summary
 * (arm S), a bounded verbatim assistant excerpt (MEM-ARCH-038), or linked
 * facts salience-descending — or, for a legacy row with no stored `userTurn`,
 * the verbatim `pageContent` fallback (no speaker label, no quote stripping,
 * no facts section).
 */
export function renderSplitNoteBody(doc: MemoryDocument, names?: FactRenderNames): SplitNoteBody {
  const userTurn = doc.metadata?.userTurn;

  // @spec MEM-ARCH-006 — unparseable rows render verbatim under the cap, and are COUNTED
  if (userTurn === undefined) {
    const { text: cappedText, capped } = capUserTurn(stripLegacyLocationSpans(doc.pageContent));
    return {
      body: escapeXmlContent(cappedText),
      capped,
      quoteLinesStripped: 0,
      usedFallback: true,
      usedSummary: false,
      usedExcerpt: false,
    };
  }

  const afterLocationStrip = stripLegacyLocationSpans(userTurn);
  const { text: afterQuoteStrip, strippedCount } = stripQuoteLines(afterLocationStrip);
  const { text: cappedText, capped } = capUserTurn(afterQuoteStrip);
  const escapedUserTurn = escapeXmlContent(cappedText);

  const subjectName = doc.metadata?.subjectName;
  const hasSubject = subjectName !== undefined && subjectName.length > 0;
  const lines = [
    hasSubject ? `${escapeXmlContent(subjectName)}: ${escapedUserTurn}` : escapedUserTurn,
  ];

  // @spec MEM-ARCH-021 — arm S: user turn + the character's summary, no facts section
  const assistantSummary = doc.metadata?.archiveRender?.assistantSummary;
  if (assistantSummary !== undefined && assistantSummary.length > 0) {
    const personalityName = resolveSummaryPersonalityName(doc, names);
    const escapedSummary = escapeXmlContent(assistantSummary);
    lines.push(
      personalityName !== undefined && personalityName.length > 0
        ? `${escapeXmlContent(personalityName)}: ${escapedSummary}`
        : escapedSummary
    );
    return {
      body: lines.join('\n'),
      capped,
      quoteLinesStripped: strippedCount,
      usedFallback: false,
      usedSummary: true,
      usedExcerpt: false,
    };
  }

  // @spec MEM-ARCH-038 — own notes with no summary render a capped verbatim assistant excerpt
  const excerptResult = appendAssistantExcerpt(lines, doc, names);

  const linkedFacts = doc.metadata?.archiveRender?.linkedFacts ?? [];
  if (linkedFacts.length > 0) {
    const sorted = [...linkedFacts].sort((a, b) => b.salience - a.salience);
    lines.push('Recorded about this exchange:');
    for (const fact of sorted) {
      lines.push(`- ${escapeXmlContent(resolveFactStatement(fact.statement, names))}`);
    }
  }

  return {
    body: lines.join('\n'),
    capped,
    quoteLinesStripped: strippedCount,
    usedFallback: false,
    usedSummary: false,
    usedExcerpt: excerptResult.appended,
  };
}

/** Aggregate telemetry for one turn's memory-archive render — IDs/counts only, never text. */
export interface ArchiveRenderSummary {
  /** `'split'` iff EVERY note in the turn rendered in split mode; a shared-LTM
   *  turn mixing own verbatim notes with foreign split notes reports `'verbatim'`
   *  here even though it carries split notes (see `foreignNotes`). */
  mode: 'split' | 'verbatim';
  notes: number;
  /** D5's `verbatim_fallback_renders` telemetry: split-mode notes that had no
   *  stored `userTurn` and rendered through the verbatim fallback instead. */
  verbatimFallbackNotes: number;
  cappedNotes: number;
  /** Quote lines stripped from the USER turn (D1's rider). Assistant-side strips are not counted — the counter keeps its user-side meaning. */
  quoteLinesStripped: number;
  linkedFacts: number;
  /** Split notes rendered from a stored summary (D2's arm S) rather than from linked facts. */
  summaryNotes: number;
  /** Split-mode own notes rendered with a bounded verbatim assistant excerpt (MEM-ARCH-038). */
  excerptNotes: number;
  /** Notes authored by a personality other than the responder (shared-LTM retrieval,
   *  `with=` on the note's tag). Counts only — never the note's text. */
  foreignNotes: number;
  /** Foreign notes with no stored `userTurn`, omitted from the block entirely
   *  because their only fallback render is the other character's verbatim
   *  reply. Counts only — never the note's text. */
  omittedForeignNotes: number;
}
