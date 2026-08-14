import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execFileSync } from 'node:child_process';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

const mockedExec = vi.mocked(execFileSync);

// Import AFTER mock so the module binding captures the vi.mock version.
import {
  discoverPrevTag,
  tagTimestamp,
  listMergedPrsSince,
  countRangeChangedFiles,
} from './github-prs.js';

describe('discoverPrevTag', () => {
  beforeEach(() => vi.clearAllMocks());

  it('invokes `git describe --tags --abbrev=0` and trims the result', () => {
    mockedExec.mockReturnValueOnce('v3.0.0-beta.103\n');
    expect(discoverPrevTag()).toBe('v3.0.0-beta.103');
    expect(mockedExec).toHaveBeenCalledWith(
      'git',
      ['describe', '--tags', '--abbrev=0'],
      expect.objectContaining({ encoding: 'utf-8' })
    );
  });

  it('throws a user-facing error when `git describe` fails (no tags exist)', () => {
    mockedExec.mockImplementationOnce(() => {
      throw new Error('fatal: No names found, cannot describe anything.');
    });
    // Single assertion so `mockImplementationOnce` isn't consumed twice —
    // the `/s` flag lets `.` span the newline between clauses.
    expect(() => discoverPrevTag()).toThrow(/Could not discover a previous tag.*--from <tag>/s);
  });
});

describe('tagTimestamp', () => {
  beforeEach(() => vi.clearAllMocks());

  it('invokes `git for-each-ref` with creatordate and trims the result', () => {
    // creatordate handles both annotated (tagger date) and lightweight
    // (committer date) tags, avoiding the author-date bug where PRs merged
    // between commit-authored-time and tag-creation-time get missed.
    mockedExec.mockReturnValueOnce('2026-04-22T10:00:00-04:00\n');
    expect(tagTimestamp('v3.0.0-beta.103')).toBe('2026-04-22T10:00:00-04:00');
    expect(mockedExec).toHaveBeenCalledWith(
      'git',
      ['for-each-ref', '--format=%(creatordate:iso-strict)', 'refs/tags/v3.0.0-beta.103'],
      expect.objectContaining({ encoding: 'utf-8' })
    );
  });

  it('throws a user-facing error when git exits non-zero (rare)', () => {
    // Defensive path — in practice for-each-ref exits 0 even on missing
    // tags, but guard against environmental failures (missing binary, etc.).
    mockedExec.mockImplementationOnce(() => {
      throw new Error('git: command not found');
    });
    expect(() => tagTimestamp('v99.99.99')).toThrow(
      /Could not resolve timestamp for tag 'v99.99.99'/
    );
  });

  it('throws a user-facing error when the tag does not exist (empty stdout)', () => {
    // This is what the real `git for-each-ref refs/tags/<missing>` does:
    // exits 0, prints nothing. Without the empty-string guard, the caller
    // would get `""` back and feed it into `gh pr list --search merged:>`
    // which corrupts the downstream query.
    mockedExec.mockReturnValueOnce('\n');
    expect(() => tagTimestamp('v99.99.99')).toThrow(
      /Could not resolve timestamp for tag 'v99.99.99'/
    );
  });
});

describe('listMergedPrsSince', () => {
  beforeEach(() => vi.clearAllMocks());

  it('invokes `gh pr list` with the expected search + json flags', () => {
    mockedExec.mockReturnValueOnce(
      JSON.stringify([
        {
          number: 870,
          title: 'feat(api): X',
          mergedAt: '2026-04-22T12:00:00Z',
          files: [{ path: 'services/api-gateway/src/index.ts', additions: 1, deletions: 0 }],
        },
        { number: 869, title: 'feat(ai): Y', mergedAt: '2026-04-22T11:00:00Z', files: [] },
      ])
    );

    const prs = listMergedPrsSince('2026-04-21T00:00:00Z');

    expect(mockedExec).toHaveBeenCalledWith(
      'gh',
      [
        'pr',
        'list',
        '--state',
        'merged',
        '--base',
        'develop',
        '--search',
        'merged:>2026-04-21T00:00:00Z',
        '--limit',
        '200',
        '--json',
        'number,title,mergedAt,files',
      ],
      expect.objectContaining({ encoding: 'utf-8' })
    );

    // Sorted chronologically — the earlier mergedAt comes first even though
    // it was second in the raw response.
    expect(prs.map(p => p.number)).toEqual([869, 870]);

    // `files` is flattened from `{path, additions, deletions}` objects to
    // bare path strings — the shape `release:range` classification consumes.
    expect(prs.find(p => p.number === 870)?.files).toEqual(['services/api-gateway/src/index.ts']);
  });

  it('returns an empty array when gh returns no PRs', () => {
    mockedExec.mockReturnValueOnce('[]');
    expect(listMergedPrsSince('2026-04-22T00:00:00Z')).toEqual([]);
  });

  it('uses a custom base branch when the `base` arg is provided', () => {
    // Default is `develop`; overriding to e.g. `main` should reach the
    // underlying gh invocation as the `--base` value.
    mockedExec.mockReturnValueOnce('[]');
    listMergedPrsSince('2026-04-21T00:00:00Z', 'main');
    expect(mockedExec).toHaveBeenCalledWith(
      'gh',
      expect.arrayContaining(['--base', 'main']),
      expect.anything()
    );
  });

  it('throws a user-facing error when gh is missing / unauthenticated', () => {
    mockedExec.mockImplementationOnce(() => {
      throw new Error('command not found: gh');
    });
    expect(() => listMergedPrsSince('2026-04-21T00:00:00Z')).toThrow(/gh auth status/);
  });

  it('throws a user-facing error when gh returns non-JSON (parse failure)', () => {
    // gh can exit 0 while writing a plaintext error to stdout — the JSON.parse
    // failure must surface a useful message, not a raw SyntaxError.
    mockedExec.mockReturnValueOnce('error: graphql request failed\n');
    expect(() => listMergedPrsSince('2026-04-21T00:00:00Z')).toThrow(
      /Failed to parse.*output as JSON/
    );
  });

  it('truncates overly long non-JSON responses in the parse error', () => {
    const longResponse = 'x'.repeat(500);
    mockedExec.mockReturnValueOnce(longResponse);
    expect(() => listMergedPrsSince('2026-04-21T00:00:00Z')).toThrow(/…$/);
  });

  it('throws a user-facing error when gh returns valid JSON that is not an array', () => {
    // Transient GraphQL failures can produce `{"errors": [...]}` — valid
    // JSON but not the array shape we need. The `as MergedPr[]` cast
    // would otherwise let this through and `.sort()` would throw an
    // unhelpful TypeError downstream.
    mockedExec.mockReturnValueOnce('{"errors": [{"message": "GraphQL error"}]}');
    expect(() => listMergedPrsSince('2026-04-21T00:00:00Z')).toThrow(
      /Expected a JSON array.*got object/
    );
  });
});

describe('normalizeGhPr — absent files key', () => {
  beforeEach(() => vi.clearAllMocks());

  it('survives a gh response that omits files entirely, leaving files undefined', () => {
    // Distinct from `files: []`: an omitted key exercises the `raw.files?.map`
    // optional chain, and `undefined` is what makes classifyPr fail toward
    // runtime. A `[]` fixture cannot reach that branch.
    mockedExec.mockReturnValueOnce(
      JSON.stringify([{ number: 1, title: 'feat: x', mergedAt: '2026-04-22T12:00:00Z' }])
    );
    const [pr] = listMergedPrsSince('2026-04-22T10:00:00Z', 'develop');
    expect(pr.files).toBeUndefined();
  });
});

describe('countRangeChangedFiles', () => {
  beforeEach(() => vi.clearAllMocks());

  it('counts the files in the two-dot range diff', () => {
    mockedExec.mockReturnValueOnce('').mockReturnValueOnce('a.ts\nb.ts\nc.ts\n');
    expect(countRangeChangedFiles('v3.0.0-beta.103', 'develop')).toBe(3);
    // Fetch first, then diff origin/<base> — NOT the local branch. A stale
    // local ref would resolve and under-report instead of degrading.
    expect(mockedExec).toHaveBeenNthCalledWith(
      1,
      'git',
      ['fetch', 'origin'],
      expect.objectContaining({ stdio: expect.anything() })
    );
    expect(mockedExec).toHaveBeenNthCalledWith(
      2,
      'git',
      ['diff', '--name-only', 'v3.0.0-beta.103..origin/develop'],
      expect.objectContaining({ encoding: 'utf-8' })
    );
  });

  it('returns 0 for an empty diff rather than 1', () => {
    // The whole point of the trimmed === '' guard: ''.split('\n') is [''],
    // length 1, so a range with no changes would report one file. Deleting
    // that ternary must fail here.
    mockedExec.mockReturnValueOnce('').mockReturnValueOnce('\n');
    expect(countRangeChangedFiles('v3.0.0-beta.103', 'develop')).toBe(0);
  });

  it('counts a single-file diff as 1, not 0 — the guard must not over-reach', () => {
    mockedExec.mockReturnValueOnce('').mockReturnValueOnce('only.ts\n');
    expect(countRangeChangedFiles('v3.0.0-beta.103', 'develop')).toBe(1);
  });

  it('never diffs the bare local branch — a stale local ref under-reports silently', () => {
    // The failure this guards: `fromTag..develop` resolves against a stale
    // local checkout, so git SUCCEEDS and returns a too-low count. Every
    // other failure mode here degrades to undefined and says so; this one
    // would read as a comfortable pass. Asserting the absence of the local
    // form is the only way to catch a revert to it.
    mockedExec.mockReturnValueOnce('').mockReturnValueOnce('a.ts\n');
    countRangeChangedFiles('v3.0.0-beta.103', 'develop');
    const diffArgs = mockedExec.mock.calls
      .map(call => call[1])
      .filter((args): args is string[] => Array.isArray(args) && args[0] === 'diff');
    expect(diffArgs).toHaveLength(1);
    expect(diffArgs[0]).not.toContain('v3.0.0-beta.103..develop');
    expect(diffArgs[0]).toContain('v3.0.0-beta.103..origin/develop');
  });

  it('returns undefined when the fetch itself fails, rather than diffing a stale ref', () => {
    mockedExec.mockImplementationOnce(() => {
      throw new Error('fatal: unable to access remote');
    });
    expect(countRangeChangedFiles('v3.0.0-beta.103', 'develop')).toBeUndefined();
  });

  it('returns undefined rather than throwing when git cannot answer', () => {
    // Missing tag, shallow clone, absent local base ref. The ship inventory
    // must still print; failing a release report over an advisory metric
    // would be the wrong trade.
    mockedExec.mockImplementationOnce(() => {
      throw new Error("fatal: bad revision 'v9.9.9..develop'");
    });
    expect(countRangeChangedFiles('v9.9.9', 'develop')).toBeUndefined();
  });
});
