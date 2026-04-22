import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execFileSync } from 'node:child_process';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

const mockedExec = vi.mocked(execFileSync);

// Import AFTER mock so the module binding captures the vi.mock version.
import { discoverPrevTag, tagTimestamp, listMergedPrsSince } from './github-prs.js';

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
        { number: 870, title: 'feat(api): X', mergedAt: '2026-04-22T12:00:00Z' },
        { number: 869, title: 'feat(ai): Y', mergedAt: '2026-04-22T11:00:00Z' },
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
        'number,title,mergedAt',
      ],
      expect.objectContaining({ encoding: 'utf-8' })
    );

    // Sorted chronologically — the earlier mergedAt comes first even though
    // it was second in the raw response.
    expect(prs.map(p => p.number)).toEqual([869, 870]);
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
