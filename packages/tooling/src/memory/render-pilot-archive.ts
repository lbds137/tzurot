/**
 * Builds one arm's `<memory_archive>` block for a window of corpus rows —
 * shared by the answers and voice stages, which both need to render the same
 * window in all three arms.
 */

import type { CorpusResult, CorpusRow } from './render-pilot-corpus.js';
import {
  renderNoteV,
  renderNoteF,
  renderNoteS,
  wrapMemoryArchive,
  type RenderArm,
} from './render-pilot-render.js';
import type { SummaryRecord } from './render-pilot-metrics.js';

/** Result of {@link renderArmNotes}: the wrapped archive XML plus a fallback count meaningful only for arm S. */
export interface RenderArmNotesResult {
  xml: string;
  /** Rows rendered as arm F instead of arm S because no usable summary was available. Always 0 for arms V and F. */
  summaryFallbackRows: number;
}

/**
 * Render `windowRows` in `arm` and wrap them in the `<memory_archive>` block.
 * Per D2 (docs/proposals/backlog/memory-archive-format.md): a row with no
 * usable summary renders as arm F (user side + facts) instead of arm S, so a
 * null or empty summary never renders as an empty assistant turn.
 */
export function renderArmNotes(
  arm: RenderArm,
  corpus: CorpusResult,
  summaryByRowId: Map<string, SummaryRecord>,
  windowRows: CorpusRow[]
): RenderArmNotesResult {
  let summaryFallbackRows = 0;
  const notes = windowRows.map(row => {
    const summary = summaryByRowId.get(row.id)?.summary ?? null;
    const input = {
      createdAt: new Date(row.createdAt),
      subjectName: row.subjectName,
      displayName: corpus.personality.displayName,
      userText: row.split.user,
      assistantText: row.split.assistant,
      referenced: row.split.referenced,
      facts: row.facts,
      summary,
    };
    if (arm === 'V') {
      return renderNoteV(input);
    }
    if (arm === 'F') {
      return renderNoteF(input).xml;
    }
    if (summary === null || summary.trim().length === 0) {
      summaryFallbackRows += 1;
      return renderNoteF(input).xml;
    }
    return renderNoteS(input).xml;
  });
  return { xml: wrapMemoryArchive(arm, notes.join('\n')), summaryFallbackRows };
}
