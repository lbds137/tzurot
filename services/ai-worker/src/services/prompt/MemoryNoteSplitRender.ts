/**
 * The memory-archive SPLIT render's pure pieces: capping the user turn and
 * assembling one split note's body (user turn verbatim + linked facts,
 * assistant prose omitted). `MemoryFormatter.ts` stays a thin dispatcher over
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

/** Truncation marker appended after a cap cut: a leading space then the bracketed ellipsis. */
const CAP_MARKER = ' […]';

/**
 * Cap `text` at {@link ARCHIVE_USER_TURN_CAP_CHARS}, preferring to cut at the
 * last whitespace at or before the cap (never mid-word); a hard cut at the
 * cap is the fallback when no whitespace exists in range.
 */
// @spec MEM-ARCH-004 — the 3,000-char cap with the ` […]` marker
export function capUserTurn(text: string): { text: string; capped: boolean } {
  if (text.length <= ARCHIVE_USER_TURN_CAP_CHARS) {
    return { text, capped: false };
  }
  let cutIndex = -1;
  for (let i = ARCHIVE_USER_TURN_CAP_CHARS; i >= 0; i -= 1) {
    if (/\s/.test(text.charAt(i))) {
      cutIndex = i;
      break;
    }
  }
  let effectiveCutIndex = cutIndex >= 0 ? cutIndex : ARCHIVE_USER_TURN_CAP_CHARS;
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

/** Result of rendering one split-mode note body. */
export interface SplitNoteBody {
  body: string;
  capped: boolean;
  quoteLinesStripped: number;
  usedFallback: boolean;
  /** Rendered from a stored summary (D2's arm S) rather than from linked facts. */
  usedSummary: boolean;
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
 * Render one memory doc's split-mode note body: the user turn verbatim
 * (quote-stripped, capped, escaped) plus linked facts salience-descending —
 * or, for a legacy row with no stored `userTurn`, the verbatim `pageContent`
 * fallback (no speaker label, no quote stripping, no facts section).
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
    };
  }

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
  };
}

/** Aggregate telemetry for one turn's memory-archive render — IDs/counts only, never text. */
export interface ArchiveRenderSummary {
  mode: 'split' | 'verbatim';
  notes: number;
  /** D5's `verbatim_fallback_renders` telemetry: split-mode notes that had no
   *  stored `userTurn` and rendered through the verbatim fallback instead. */
  verbatimFallbackNotes: number;
  cappedNotes: number;
  quoteLinesStripped: number;
  linkedFacts: number;
  /** Split notes rendered from a stored summary (D2's arm S) rather than from linked facts. */
  summaryNotes: number;
}
