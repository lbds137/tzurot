import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./github-prs.js', () => ({
  discoverPrevTag: vi.fn(),
  tagTimestamp: vi.fn(),
  listMergedPrsSince: vi.fn(),
}));

import { findDuplicates, extractPrRefs, classifyRefs, verifyNotes } from './verify-notes.js';
import { discoverPrevTag, tagTimestamp, listMergedPrsSince } from './github-prs.js';

const mockedDiscoverPrevTag = vi.mocked(discoverPrevTag);
const mockedTagTimestamp = vi.mocked(tagTimestamp);
const mockedListMergedPrsSince = vi.mocked(listMergedPrsSince);

/**
 * Mock process.stdin as an async iterable that yields the given input chunks.
 * Restore is handled by the afterEach in the describe block below.
 */
function mockStdin(chunks: string[]): void {
  const iterable = {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        next() {
          if (i < chunks.length) {
            return Promise.resolve({ value: chunks[i++], done: false });
          }
          return Promise.resolve({ value: undefined, done: true });
        },
      };
    },
  };
  Object.defineProperty(process, 'stdin', {
    configurable: true,
    get: () =>
      Object.assign(iterable, {
        setEncoding: vi.fn(),
      }),
  });
}

describe('verifyNotes (orchestrator)', () => {
  let stderr: string;
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  const originalStdin = process.stdin;

  beforeEach(() => {
    vi.clearAllMocks();
    stderr = '';
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(chunk => {
      stderr += String(chunk);
      return true;
    });
    // Mock process.exit to throw a sentinel we can assert on, so the test
    // flow doesn't actually terminate the test runner.
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(code => {
      throw new Error(`PROCESS_EXIT:${code ?? ''}`);
    });
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    exitSpy.mockRestore();
    // Restore stdin so later tests don't see the mock.
    Object.defineProperty(process, 'stdin', {
      configurable: true,
      value: originalStdin,
      writable: true,
    });
  });

  it('returns cleanly (no exit call) when notes match merged PRs exactly', async () => {
    mockStdin(['### Features\n- **ai:** X (#869)\n- **bot:** Y (#870)\n']);
    mockedDiscoverPrevTag.mockReturnValueOnce('v3.0.0-beta.103');
    mockedTagTimestamp.mockReturnValueOnce('2026-04-22T10:00:00Z');
    mockedListMergedPrsSince.mockReturnValueOnce([
      { number: 869, title: 'feat(ai): X', mergedAt: '2026-04-22T11:00:00Z' },
      { number: 870, title: 'fix(bot): Y', mergedAt: '2026-04-22T12:00:00Z' },
    ]);

    await verifyNotes({});

    expect(exitSpy).not.toHaveBeenCalled();
    expect(stderr).toContain('✅');
    expect(stderr).toContain('all 2 merged PRs');
  });

  it('reports missing PRs and exits 1 when notes are incomplete', async () => {
    mockStdin(['### Features\n- **ai:** X (#869)\n']); // note: PR 870 missing
    mockedDiscoverPrevTag.mockReturnValueOnce('v3.0.0-beta.103');
    mockedTagTimestamp.mockReturnValueOnce('2026-04-22T10:00:00Z');
    mockedListMergedPrsSince.mockReturnValueOnce([
      { number: 869, title: 'feat(ai): X', mergedAt: '2026-04-22T11:00:00Z' },
      { number: 870, title: 'fix(bot): Y', mergedAt: '2026-04-22T12:00:00Z' },
    ]);

    await expect(verifyNotes({})).rejects.toThrow('PROCESS_EXIT:1');
    expect(stderr).toContain('Missing');
    expect(stderr).toContain('#870');
    expect(stderr).toContain('fix(bot): Y'); // title surfaced in missing list
  });

  it('exits 1 with a clear error when stdin is empty', async () => {
    mockStdin(['']);

    await expect(verifyNotes({})).rejects.toThrow('PROCESS_EXIT:1');
    expect(stderr).toContain('no input on stdin');
    // Should NOT reach the shell-out helpers when input is empty.
    expect(mockedDiscoverPrevTag).not.toHaveBeenCalled();
    expect(mockedListMergedPrsSince).not.toHaveBeenCalled();
  });
});

describe('extractPrRefs', () => {
  it('extracts refs from canonical `(#N)` line items', () => {
    const notes = [
      '### Features',
      '- **ai-worker:** thing (#869)',
      '- **api-gateway:** hardening (#870)',
    ].join('\n');
    expect(extractPrRefs(notes)).toEqual([869, 870]);
  });

  it('returns an empty array when the notes have no PR refs', () => {
    expect(extractPrRefs('# Release notes\n\nNothing to see.')).toEqual([]);
  });

  it('ignores bare `#N` references in prose (parens-only match)', () => {
    // Tight regex is the fix for the prior "known limitation" — prose refs
    // like "fixes #45 in upstream" no longer surface as spurious `extra`
    // entries. Only paren-wrapped `(#N)` counts as a PR ref.
    const notes = 'See issue #42 upstream. Referencing #43 in passing. This PR is (#869).';
    expect(extractPrRefs(notes)).toEqual([869]);
  });

  it('also matches `(#N)` mid-sentence (documented behavior, not line-end-anchored)', () => {
    // The regex is paren-anchored but not line-end-anchored — a hand-edited
    // draft that weaves a ref into prose will count it too. Pinning this
    // behavior so future readers don't assume line-end exclusivity.
    const notes = 'This supersedes (#869) and adds (#870) for the cookie migration.';
    expect(extractPrRefs(notes)).toEqual([869, 870]);
  });

  it('captures duplicates when the same `(#N)` appears more than once', () => {
    const notes = 'Mentioned in (#869) and also in (#869).';
    expect(extractPrRefs(notes)).toEqual([869, 869]);
  });
});

describe('classifyRefs', () => {
  it('reports all three categories when each is non-empty', () => {
    const result = classifyRefs([868, 870, 870, 999], new Set([868, 869, 870]));
    expect(result.missing).toEqual([869]);
    expect(result.extra).toEqual([999]);
    expect(result.duplicates).toEqual([870]);
  });

  it('returns empty arrays when notes match merged set exactly', () => {
    const result = classifyRefs([868, 869, 870], new Set([868, 869, 870]));
    expect(result.missing).toEqual([]);
    expect(result.extra).toEqual([]);
    expect(result.duplicates).toEqual([]);
  });

  it('flags every merged PR as missing when notes are empty', () => {
    const result = classifyRefs([], new Set([868, 869]));
    expect(result.missing).toEqual([868, 869]);
    expect(result.extra).toEqual([]);
    expect(result.duplicates).toEqual([]);
  });

  it('flags every ref as extra when merged set is empty', () => {
    const result = classifyRefs([1, 2, 3], new Set());
    expect(result.missing).toEqual([]);
    expect(result.extra).toEqual([1, 2, 3]);
    expect(result.duplicates).toEqual([]);
  });
});

describe('findDuplicates', () => {
  it('returns an empty array when all refs are unique', () => {
    expect(findDuplicates([868, 869, 870])).toEqual([]);
  });

  it('returns the numbers that appear more than once, sorted ascending', () => {
    expect(findDuplicates([870, 869, 870, 868, 870, 869])).toEqual([869, 870]);
  });

  it('reports a number once regardless of how many times it repeats', () => {
    // 870 appears 4 times but is reported once in the result.
    expect(findDuplicates([870, 870, 870, 870])).toEqual([870]);
  });

  it('handles an empty input', () => {
    expect(findDuplicates([])).toEqual([]);
  });

  it('returns the sort in ascending order even when duplicates arrive in reverse', () => {
    expect(findDuplicates([999, 999, 1, 1])).toEqual([1, 999]);
  });
});
