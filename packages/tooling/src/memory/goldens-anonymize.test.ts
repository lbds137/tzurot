import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockReadFileSync = vi.fn();
const mockWriteFileSync = vi.fn();
const mockMkdirSync = vi.fn();
vi.mock('node:fs', () => ({
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
  writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
  mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
}));

import {
  anonymizeGoldens,
  countBelowFloor,
  extractEntityCandidates,
  proposeSwapMap,
  applySwapMap,
  type CorpusRawRow,
  type SwapMap,
} from './goldens-anonymize.js';

function row(id: string, content: string, senders: string[] = []): CorpusRawRow {
  return { id, personalityId: 'pers-1', createdAt: '2026-01-01T00:00:00.000Z', content, senders };
}

describe('extractEntityCandidates', () => {
  it('detects capitalized names and multi-word runs, counting frequency', () => {
    const counts = extractEntityCandidates([
      'Vladlena met Rex at the party. Vladlena laughed.',
      'Rex Winters arrived later.',
    ]);
    expect(counts.get('Vladlena')).toBe(2);
    expect(counts.get('Rex Winters')).toBe(1);
  });

  it('filters single-word sentence-starter stopwords but keeps multi-word runs', () => {
    const counts = extractEntityCandidates(['The cat sat. When Morning Glory bloomed.']);
    expect(counts.has('The')).toBe(false);
    expect(counts.get('Morning Glory')).toBe(1);
  });

  it('detects @handles', () => {
    const counts = extractEntityCandidates(['ping @lbds137 about it', 'again @lbds137']);
    expect(counts.get('@lbds137')).toBe(2);
  });
});

describe('proposeSwapMap', () => {
  it('orders by frequency, assigns stable placeholders, and drops singletons', () => {
    const candidates = new Map([
      ['Rex', 5],
      ['Vladlena', 9],
      ['Oneoff', 1],
    ]);
    const map = proposeSwapMap(candidates, []);
    expect(map.swaps[0]).toMatchObject({ from: 'Vladlena', to: 'PersonA', count: 9 });
    expect(map.swaps[1]).toMatchObject({ from: 'Rex', to: 'PersonB' });
    expect(map.swaps.some(swap => swap.from === 'Oneoff')).toBe(false);
  });

  it('always includes sender usernames even below the frequency floor', () => {
    const map = proposeSwapMap(new Map(), ['realuser']);
    expect(map.swaps.some(swap => swap.from === 'realuser')).toBe(true);
    expect(map.dropRows).toEqual([]);
  });
});

describe('anonymizeGoldens (the fs seam — is the refuse gate real?)', () => {
  function stubFiles(corpus: CorpusRawRow[], swapMap: SwapMap): void {
    mockReadFileSync.mockImplementation((path: unknown) =>
      String(path).endsWith('corpus-raw.json') ? JSON.stringify(corpus) : JSON.stringify(swapMap)
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    // The refuse path sets a non-zero exit code; don't leak it into the runner.
    process.exitCode = 0;
  });

  it('REFUSES to write when leftovers survive (gate is real, not decorative)', async () => {
    stubFiles([row('m1', 'Lila and Rex')], {
      $comment: '',
      dropRows: [],
      swaps: [
        { from: 'Lila', to: 'PersonA', count: 1 },
        { from: 'Rex', to: 'Lila', count: 1 }, // reintroduces 'Lila' → leftover
      ],
    });

    await anonymizeGoldens({});

    expect(mockWriteFileSync).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it('writes the anonymized corpus on a clean pass (creating the out dir first)', async () => {
    stubFiles([row('m1', 'Lila was here')], {
      $comment: '',
      dropRows: [],
      swaps: [{ from: 'Lila', to: 'PersonA', count: 1 }],
    });

    await anonymizeGoldens({ outFile: 'custom/dir/retrieval-corpus.json' });

    expect(mockMkdirSync).toHaveBeenCalledWith('custom/dir', { recursive: true });
    expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
    const [outPath, payload] = mockWriteFileSync.mock.calls[0] as [string, string];
    expect(outPath).toContain('retrieval-corpus.json');
    const parsed = JSON.parse(payload) as { rows: { content: string }[] };
    expect(parsed.rows[0].content).toBe('PersonA was here');
  });

  it('answers a missing swap map with the promote-step hint, not a stack trace', async () => {
    mockReadFileSync.mockImplementation((path: unknown) => {
      if (String(path).endsWith('corpus-raw.json')) {
        return JSON.stringify([row('m1', 'text')]);
      }
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(anonymizeGoldens({})).resolves.toBeUndefined();

    expect(mockWriteFileSync).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(errorSpy.mock.calls[0][0]).toContain('promote your reviewed map');
    errorSpy.mockRestore();
  });
});

describe('countBelowFloor', () => {
  it('counts from candidate frequencies alone — appended senders cannot skew it negative', () => {
    // The regression case: 4 candidates (2 below floor), 3 non-overlapping
    // senders appended as new swap entries. The old swaps-based subtraction
    // produced 4 - 5 = -1; the direct count says 2.
    const candidates = new Map([
      ['Vladlena', 9],
      ['Rex', 5],
      ['Oneoff1', 1],
      ['Oneoff2', 1],
    ]);
    const map = proposeSwapMap(candidates, ['user_one', 'user_two', 'user_three']);
    expect(map.swaps.length).toBe(5);
    expect(countBelowFloor(candidates)).toBe(2);
  });
});

describe('applySwapMap', () => {
  const baseMap = (swaps: SwapMap['swaps'], dropRows: string[] = []): SwapMap => ({
    $comment: '',
    dropRows,
    swaps,
  });

  it('replaces with word boundaries, case-insensitively, in content and senders', () => {
    const result = applySwapMap(
      [row('m1', 'lila spoke to Lila. Lilac stayed.', ['Lila'])],
      baseMap([{ from: 'Lila', to: 'PersonA', count: 2 }])
    );
    expect(result.rows[0].content).toBe('PersonA spoke to PersonA. Lilac stayed.');
    expect(result.rows[0].senders).toEqual(['PersonA']);
    expect(result.leftovers).toEqual([]);
  });

  it('applies longest-first so multi-word swaps are not split by their prefix', () => {
    const result = applySwapMap(
      [row('m1', 'Lila Winters and Lila')],
      baseMap([
        { from: 'Lila', to: 'PersonA', count: 1 },
        { from: 'Lila Winters', to: 'PersonB', count: 1 },
      ])
    );
    expect(result.rows[0].content).toBe('PersonB and PersonA');
  });

  it('drops rows listed in dropRows', () => {
    const result = applySwapMap(
      [row('keep-me', 'fine'), row('drop-me', 'too private')],
      baseMap([], ['drop-me'])
    );
    expect(result.rows.map(r => r.id)).toEqual(['keep-me']);
  });

  it('inserts a hand-edited `to` containing $ literally (no replacement-pattern semantics)', () => {
    const result = applySwapMap(
      [row('m1', 'ping Lila about it', ['Lila'])],
      baseMap([{ from: 'Lila', to: '$tarBaby $& $1 $$', count: 1 }])
    );
    expect(result.rows[0].content).toBe('ping $tarBaby $& $1 $$ about it');
    expect(result.rows[0].senders).toEqual(['$tarBaby $& $1 $$']);
  });

  it('honors action:"keep" (entity left as-is, not a leftover)', () => {
    const result = applySwapMap(
      [row('m1', 'Minecraft is fine to keep')],
      baseMap([{ from: 'Minecraft', to: 'PersonA', count: 1, action: 'keep' }])
    );
    expect(result.rows[0].content).toContain('Minecraft');
    expect(result.leftovers).toEqual([]);
  });

  it('clean swaps and never-present entities produce no leftovers', () => {
    const result = applySwapMap(
      [row('m1', 'name is Lila'), row('m2', 'unrelated')],
      baseMap([
        { from: 'Rex', to: 'PersonA', count: 1 }, // never present → not a leftover
        { from: 'Lila', to: 'PersonB', count: 1 },
      ])
    );
    expect(result.leftovers).toEqual([]);
    expect(result.rows[0].content).toBe('name is PersonB');
  });

  it('REFUSE PATH: a later swap reintroducing an earlier entity is caught as a leftover', () => {
    // 'Lila' (longer) swaps first; then 'Rex' → 'Lila' reintroduces the
    // already-processed entity into the final state. The scan must run
    // against that FINAL state, not per-swap.
    const result = applySwapMap(
      [row('m1', 'Lila and Rex')],
      baseMap([
        { from: 'Lila', to: 'PersonA', count: 1 },
        { from: 'Rex', to: 'Lila', count: 1 },
      ])
    );
    expect(result.rows[0].content).toBe('PersonA and Lila');
    expect(result.leftovers).toEqual(['Lila']);
  });

  it('REFUSE PATH: a leftover surviving only in senders is caught (usernames are the rawest PII)', () => {
    // Reintroduction confined to the senders field: content stays clean, so a
    // content-only scan would pass this row. Senders must get the same
    // final-state backstop.
    const result = applySwapMap(
      [row('m1', 'clean text', ['PersonC'])],
      baseMap([
        { from: 'PersonC', to: 'PersonD', count: 1 },
        { from: 'PersonD', to: 'PersonC', count: 1 },
      ])
    );
    expect(result.rows[0].senders).toEqual(['PersonC']);
    expect(result.leftovers).toContain('PersonC');
  });
});
