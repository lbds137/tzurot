import { describe, it, expect } from 'vitest';
import { renderArmNotes } from './render-pilot-archive.js';
import type { CorpusResult, CorpusRow } from './render-pilot-corpus.js';
import type { SummaryRecord } from './render-pilot-metrics.js';

function makeCorpus(rows: CorpusRow[]): CorpusResult {
  return {
    personality: {
      id: 'p1',
      name: 'Nova',
      displayName: 'Nova',
      personalityTraits: 'warm',
      personalityTone: null,
      conversationalExamples: null,
    },
    rows,
    stats: {
      rows: rows.length,
      unparseable: 0,
      excludedChunked: 0,
      eligibleTotal: rows.length,
      rowsWithReferenced: 0,
      rowsWithoutFacts: rows.length,
      factsPerRowMean: 0,
      userCharsP50: 0,
      userCharsP95: 0,
      assistantCharsP50: 0,
      assistantCharsP95: 0,
    },
  };
}

function makeRow(id: string, referenced: string | null = null): CorpusRow {
  return {
    id,
    createdAt: '2026-01-01T00:00:00.000Z',
    contentChars: 30,
    subjectName: 'Alice',
    facts: [],
    split: { user: 'hi', assistant: 'hello', referenced },
  };
}

describe('renderArmNotes', () => {
  it('renders arm V with the referenced block included', () => {
    const corpus = makeCorpus([makeRow('m1', 'a photo')]);
    const { xml } = renderArmNotes('V', corpus, new Map(), corpus.rows);
    expect(xml).toContain('[Referenced content: a photo]');
    expect(xml).toContain('<memory_archive');
  });

  it('renders arm F without the referenced block', () => {
    const corpus = makeCorpus([makeRow('m1', 'a photo')]);
    const { xml } = renderArmNotes('F', corpus, new Map(), corpus.rows);
    expect(xml).not.toContain('Referenced content');
  });

  it('renders arm S using the cached summary for the row', () => {
    const corpus = makeCorpus([makeRow('m1')]);
    const summaryByRowId = new Map<string, SummaryRecord>([
      [
        'm1',
        {
          tokens: 10,
          state: 'within_soft',
          hasFirstPerson: false,
          parseFailed: false,
          summary: 'Alice said hi.',
        },
      ],
    ]);
    const { xml, summaryFallbackRows } = renderArmNotes('S', corpus, summaryByRowId, corpus.rows);
    expect(xml).toContain('Alice said hi.');
    expect(summaryFallbackRows).toBe(0);
  });

  it('joins multiple rows into one archive block', () => {
    const corpus = makeCorpus([makeRow('m1'), makeRow('m2')]);
    const { xml } = renderArmNotes('V', corpus, new Map(), corpus.rows);
    expect(xml.match(/<historical_note/g)).toHaveLength(2);
  });

  // D2 (docs/proposals/backlog/memory-archive-format.md): a row with no usable
  // summary must render as arm F, not as arm S with an empty assistant turn.
  // Canary: reverting the fallback in renderArmNotes back to a bare renderNoteS
  // call must redden this test.
  it('falls back to arm F when a row has no cached summary', () => {
    const corpus = makeCorpus([makeRow('m1')]);
    const { xml, summaryFallbackRows } = renderArmNotes('S', corpus, new Map(), corpus.rows);
    // renderNoteF never emits a "displayName: ..." assistant line; renderNoteS always does.
    expect(xml).not.toContain('Nova:');
    expect(summaryFallbackRows).toBe(1);
  });

  it('does not fall back to arm F when the cached summary is present and non-empty', () => {
    const corpus = makeCorpus([makeRow('m1')]);
    const summaryByRowId = new Map<string, SummaryRecord>([
      [
        'm1',
        {
          tokens: 10,
          state: 'within_soft',
          hasFirstPerson: false,
          parseFailed: false,
          summary: 'Alice said hi.',
        },
      ],
    ]);
    const { xml, summaryFallbackRows } = renderArmNotes('S', corpus, summaryByRowId, corpus.rows);
    expect(xml).toContain('Nova:');
    expect(summaryFallbackRows).toBe(0);
  });
});
