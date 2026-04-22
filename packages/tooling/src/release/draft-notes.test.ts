import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./github-prs.js', () => ({
  discoverPrevTag: vi.fn(),
  tagTimestamp: vi.fn(),
  listMergedPrsSince: vi.fn(),
}));

import { draftNotes } from './draft-notes.js';
import { discoverPrevTag, tagTimestamp, listMergedPrsSince } from './github-prs.js';

const mockedDiscoverPrevTag = vi.mocked(discoverPrevTag);
const mockedTagTimestamp = vi.mocked(tagTimestamp);
const mockedListMergedPrsSince = vi.mocked(listMergedPrsSince);

describe('draftNotes', () => {
  let stdout: string;
  let stderr: string;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    stdout = '';
    stderr = '';
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(chunk => {
      stdout += String(chunk);
      return true;
    });
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(chunk => {
      stderr += String(chunk);
      return true;
    });
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it('auto-discovers the previous tag when --from is not provided', () => {
    mockedDiscoverPrevTag.mockReturnValueOnce('v3.0.0-beta.103');
    mockedTagTimestamp.mockReturnValueOnce('2026-04-22T10:00:00Z');
    mockedListMergedPrsSince.mockReturnValueOnce([
      { number: 869, title: 'feat(ai): X', mergedAt: '2026-04-22T11:00:00Z' },
    ]);

    draftNotes({});

    expect(mockedDiscoverPrevTag).toHaveBeenCalledOnce();
    expect(mockedTagTimestamp).toHaveBeenCalledWith('v3.0.0-beta.103');
    expect(stdout).toContain('### Features');
    expect(stdout).toContain('(#869)');
  });

  it('uses --from tag verbatim without calling discoverPrevTag', () => {
    mockedTagTimestamp.mockReturnValueOnce('2026-04-20T00:00:00Z');
    mockedListMergedPrsSince.mockReturnValueOnce([
      { number: 868, title: 'refactor(x): Y', mergedAt: '2026-04-21T12:00:00Z' },
    ]);

    draftNotes({ from: 'v3.0.0-beta.101' });

    expect(mockedDiscoverPrevTag).not.toHaveBeenCalled();
    expect(mockedTagTimestamp).toHaveBeenCalledWith('v3.0.0-beta.101');
    expect(stdout).toContain('(#868)');
  });

  it('writes a stderr-only message and no markdown when no PRs are in range', () => {
    mockedDiscoverPrevTag.mockReturnValueOnce('v3.0.0-beta.103');
    mockedTagTimestamp.mockReturnValueOnce('2026-04-22T10:00:00Z');
    mockedListMergedPrsSince.mockReturnValueOnce([]);

    draftNotes({});

    expect(stdout).toBe('');
    expect(stderr).toContain('No PRs merged');
    expect(stderr).toContain('v3.0.0-beta.103');
  });

  it('writes the markdown skeleton to stdout and the summary to stderr', () => {
    mockedDiscoverPrevTag.mockReturnValueOnce('v3.0.0-beta.103');
    mockedTagTimestamp.mockReturnValueOnce('2026-04-22T10:00:00Z');
    mockedListMergedPrsSince.mockReturnValueOnce([
      { number: 869, title: 'feat(ai): X', mergedAt: '2026-04-22T11:00:00Z' },
      { number: 870, title: 'fix(bot): Y', mergedAt: '2026-04-22T12:00:00Z' },
    ]);

    draftNotes({});

    // Markdown body goes to stdout so `> notes.md` captures only the draft.
    expect(stdout).toContain('### Features');
    expect(stdout).toContain('### Bug Fixes');
    expect(stdout).toContain('**Full Changelog**');
    // Summary line goes to stderr so it appears interactively without
    // contaminating a redirected stdout.
    expect(stderr).toContain('Drafted notes for 2 PRs');
    expect(stdout).not.toContain('Drafted notes for');
  });

  it('includes an unparseable-count hint in the summary when present', () => {
    mockedDiscoverPrevTag.mockReturnValueOnce('v3.0.0-beta.103');
    mockedTagTimestamp.mockReturnValueOnce('2026-04-22T10:00:00Z');
    mockedListMergedPrsSince.mockReturnValueOnce([
      { number: 869, title: 'feat(ai): X', mergedAt: '2026-04-22T11:00:00Z' },
      { number: 900, title: 'WIP something random', mergedAt: '2026-04-22T12:00:00Z' },
    ]);

    draftNotes({});

    expect(stderr).toContain('Drafted notes for 2 PRs');
    expect(stderr).toContain('1 unparseable');
    expect(stdout).toContain('### Unparseable');
  });
});
