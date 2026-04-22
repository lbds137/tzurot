import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

const mockedExec = vi.mocked(execFileSync);

// Import AFTER mock so the module binding captures the vi.mock version.
import { discoverPrevTag, tagTimestamp, listMergedPrsSince } from './github-prs.js';

describe('discoverPrevTag', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.clearAllMocks());

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
    expect(() => discoverPrevTag()).toThrow(/Could not discover a previous tag/);
    expect(() => discoverPrevTag()).toThrow(/--from <tag>/);
  });
});

describe('tagTimestamp', () => {
  beforeEach(() => vi.clearAllMocks());

  it('invokes `git log -1 --format=%aI <tag>` and trims the result', () => {
    mockedExec.mockReturnValueOnce('2026-04-22T10:00:00-04:00\n');
    expect(tagTimestamp('v3.0.0-beta.103')).toBe('2026-04-22T10:00:00-04:00');
    expect(mockedExec).toHaveBeenCalledWith(
      'git',
      ['log', '-1', '--format=%aI', 'v3.0.0-beta.103'],
      expect.objectContaining({ encoding: 'utf-8' })
    );
  });

  it('throws a user-facing error when the tag does not exist', () => {
    mockedExec.mockImplementationOnce(() => {
      throw new Error("fatal: bad revision 'v99.99.99'");
    });
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

  it('throws a user-facing error when gh is missing / unauthenticated', () => {
    mockedExec.mockImplementationOnce(() => {
      throw new Error('command not found: gh');
    });
    expect(() => listMergedPrsSince('2026-04-21T00:00:00Z')).toThrow(/gh auth status/);
  });
});
