import { describe, it, expect, vi } from 'vitest';
import { UsageError } from '../utils/errors.js';
import {
  resolvePlaceholders,
  selectSampleRows,
  groupFactsByMemoryId,
  computeCorpusStats,
  buildCorpus,
  type CorpusRow,
} from './render-pilot-corpus.js';

function fakePrisma(overrides: { personality?: unknown; queryRawResults?: unknown[][] } = {}) {
  const queryRawResults = overrides.queryRawResults ?? [[], []];
  let call = 0;
  return {
    personality: { findUnique: vi.fn().mockResolvedValue(overrides.personality ?? null) },
    persona: { findMany: vi.fn().mockResolvedValue([]) },
    $queryRaw: vi.fn().mockImplementation(() => {
      const result = queryRawResults[call] ?? [];
      call += 1;
      return Promise.resolve(result);
    }),
  } as any;
}

describe('resolvePlaceholders', () => {
  it('replaces {user} and {assistant}', () => {
    expect(resolvePlaceholders('{user}: hi\n{assistant}: hello', 'Alice', 'Nova')).toBe(
      'Alice: hi\nNova: hello'
    );
  });

  it('replaces every assistant placeholder variant, case-insensitively', () => {
    const text = '{{Char}} said hi. {SHAPE} agreed. {Personality} smiled.';
    expect(resolvePlaceholders(text, 'Alice', 'Nova')).toBe(
      'Nova said hi. Nova agreed. Nova smiled.'
    );
  });

  it('replaces the {{user}} double-brace variant', () => {
    expect(resolvePlaceholders('{{User}} waved', 'Alice', 'Nova')).toBe('Alice waved');
  });

  it('does not expand $& in a replacement name (closure replacer)', () => {
    expect(resolvePlaceholders('{user}: hi', '$&weird', 'Nova')).toBe('$&weird: hi');
  });
});

describe('selectSampleRows', () => {
  const row = (id: string, chars: number, createdAt: string) => ({
    id,
    persona_id: null,
    content: '',
    created_at: new Date(createdAt),
    content_chars: chars,
  });

  it('unions the byLargest and byLatest sets without duplicates', () => {
    const byLargest = [row('a', 100, '2026-01-01')];
    const byLatest = [row('c', 10, '2026-01-10')];
    const sample = selectSampleRows(byLargest, byLatest);
    expect(sample.map(r => r.id).sort()).toEqual(['a', 'c']);
  });

  it('deduplicates a row present in both sets', () => {
    const byLargest = [row('a', 100, '2026-01-10')];
    const byLatest = [row('a', 100, '2026-01-10')];
    const sample = selectSampleRows(byLargest, byLatest);
    expect(sample.map(r => r.id)).toEqual(['a']);
  });
});

describe('groupFactsByMemoryId', () => {
  it('groups facts by each cited source memory id, sorted by salience desc', () => {
    const facts = [
      { id: 'f1', statement: 'low', salience: 0.2, tier: 'observed', source_memory_ids: ['m1'] },
      { id: 'f2', statement: 'high', salience: 0.9, tier: 'observed', source_memory_ids: ['m1'] },
      { id: 'f3', statement: 'other', salience: 0.5, tier: 'observed', source_memory_ids: ['m2'] },
    ];
    const grouped = groupFactsByMemoryId(facts);
    expect(grouped.get('m1')?.map(f => f.id)).toEqual(['f2', 'f1']);
    expect(grouped.get('m2')?.map(f => f.id)).toEqual(['f3']);
  });
});

describe('computeCorpusStats', () => {
  function makeRow(overrides: Partial<CorpusRow> = {}): CorpusRow {
    return {
      id: 'r1',
      createdAt: '2026-01-01T00:00:00.000Z',
      contentChars: 50,
      split: { user: 'hi', assistant: 'hello', referenced: null },
      subjectName: 'Alice',
      facts: [],
      ...overrides,
    };
  }

  it('counts referenced rows, rows without facts, and computes facts-per-row mean', () => {
    const rows = [
      makeRow({ split: { user: 'a', assistant: 'b', referenced: 'x' } }),
      makeRow({ facts: [{ id: 'f1', statement: 's', salience: 0.5, tier: 'observed' }] }),
      makeRow(),
    ];
    const stats = computeCorpusStats(rows, 2, 3, 10);
    expect(stats).toMatchObject({
      rows: 3,
      unparseable: 2,
      excludedChunked: 3,
      eligibleTotal: 10,
      rowsWithReferenced: 1,
      rowsWithoutFacts: 2,
    });
    expect(stats.factsPerRowMean).toBeCloseTo(1 / 3, 5);
  });

  it('returns zeroed stats for an empty row set', () => {
    const stats = computeCorpusStats([], 0, 0, 0);
    expect(stats.rows).toBe(0);
    expect(stats.factsPerRowMean).toBe(0);
    expect(stats.userCharsP50).toBe(0);
  });
});

describe('buildCorpus', () => {
  it('throws UsageError for an unknown slug', async () => {
    const prisma = fakePrisma({ personality: null });
    await expect(
      buildCorpus(prisma, { slug: 'nope', largest: 5, latest: 5 })
    ).rejects.toBeInstanceOf(UsageError);
  });

  it('splits rows, excludes unparseable rows, and resolves placeholders end to end', async () => {
    // Query order: (a) counts, (b) byLargest (chunk_group_id IS NULL, so the
    // chunked row never appears here — it's already excluded server-side),
    // (c) byLatest, (d) linked facts.
    const prisma = fakePrisma({
      personality: {
        id: 'p1',
        name: 'Nova',
        displayName: 'Nova',
        personalityTraits: 'warm',
        personalityTone: null,
        conversationalExamples: null,
      },
      queryRawResults: [
        [{ eligible: 3, chunked: 1 }],
        [
          {
            id: 'm1',
            persona_id: null,
            content: '{user}: hi\n{assistant}: hello',
            created_at: new Date('2026-01-01'),
            content_chars: 30,
          },
          {
            id: 'm2',
            persona_id: null,
            content: 'unparseable garbage',
            created_at: new Date('2026-01-02'),
            content_chars: 20,
          },
        ],
        [],
        [],
      ],
    });
    const result = await buildCorpus(prisma, { slug: 'nova', largest: 10, latest: 10 });
    expect(result.stats.eligibleTotal).toBe(3);
    expect(result.stats.excludedChunked).toBe(1);
    expect(result.stats.unparseable).toBe(1);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].split).toEqual({ user: 'hi', assistant: 'hello', referenced: null });
    expect(result.rows[0].subjectName).toBe('User');
  });
});
