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

/** Render `windowRows` in `arm` and wrap them in the `<memory_archive>` block. */
export function renderArmNotes(
  arm: RenderArm,
  corpus: CorpusResult,
  summaryByRowId: Map<string, SummaryRecord>,
  windowRows: CorpusRow[]
): string {
  const notes = windowRows.map(row => {
    const input = {
      createdAt: new Date(row.createdAt),
      subjectName: row.subjectName,
      displayName: corpus.personality.displayName,
      userText: row.split.user,
      assistantText: row.split.assistant,
      referenced: row.split.referenced,
      facts: row.facts,
      summary: summaryByRowId.get(row.id)?.summary ?? null,
    };
    if (arm === 'V') {
      return renderNoteV(input);
    }
    if (arm === 'F') {
      return renderNoteF(input).xml;
    }
    return renderNoteS(input).xml;
  });
  return wrapMemoryArchive(arm, notes.join('\n'));
}
