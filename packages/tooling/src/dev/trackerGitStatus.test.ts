import { beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  checkUncommittedTrackerFiles,
  PORCELAIN_ENTRY_SEPARATOR,
  readTrackerGitStatus,
  TRACKER_STATUS_TIMEOUT_MS,
} from './trackerGitStatus.js';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

/**
 * Entries are NUL-TERMINATED in `-z` output, so each fixture ends with one.
 * Built from the exported constant rather than a literal: hardcoding `\0` here
 * would let a separator change leave every fixture on the old delimiter, and
 * this file would stop being the thing that catches the drift.
 */
function entries(...lines: string[]): string {
  return lines.map(l => `${l}${PORCELAIN_ENTRY_SEPARATOR}`).join('');
}

describe('checkUncommittedTrackerFiles', () => {
  it('reports an untracked (??) entry', () => {
    expect(checkUncommittedTrackerFiles(entries('?? tracker/tasks/task-537 - new.md'))).toEqual([
      'tracker/tasks/task-537 - new.md (untracked)',
    ]);
  });

  it('reports a worktree-modified entry ( M)', () => {
    expect(checkUncommittedTrackerFiles(entries(' M tracker/tasks/task-1 - edited.md'))).toEqual([
      'tracker/tasks/task-1 - edited.md (modified, not staged)',
    ]);
  });

  it('does NOT report a staged-only entry (second column is a space)', () => {
    // A  path and M  path are both about to be committed — not a warning.
    expect(
      checkUncommittedTrackerFiles(
        entries('A  tracker/tasks/task-2 - staged-new.md', 'M  tracker/tasks/task-3 - staged.md')
      )
    ).toEqual([]);
  });

  it('produces no warnings for empty porcelain output', () => {
    expect(checkUncommittedTrackerFiles('')).toEqual([]);
  });

  it('labels a worktree-deleted entry as deleted, not modified', () => {
    expect(checkUncommittedTrackerFiles(entries(' D tracker/tasks/task-4 - gone.md'))).toEqual([
      'tracker/tasks/task-4 - gone.md (deleted, not staged)',
    ]);
  });

  // All seven of git's unmerged pairs, not just the UU everyone thinks of.
  // Four (DD, UD, UA, AA) carry a worktree byte that means something else on
  // its own, so a second-column-only lookup calls them plain deletes/adds —
  // which is what this table exists to prevent regressing to.
  it.each(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'])(
    'labels the %s unmerged pair as a merge conflict',
    pair => {
      expect(
        checkUncommittedTrackerFiles(entries(`${pair} tracker/tasks/task-5 - clash.md`))
      ).toEqual(['tracker/tasks/task-5 - clash.md (merge conflict)']);
    }
  );

  it('reports a spaced path verbatim — which every real tracker filename is', () => {
    // Under `-z` git applies no quoting at all, so the path needs no unwrapping.
    // Without it, this arrives as `"tracker/tasks/task-9 - a real name.md"` and
    // every warning this tool prints would carry quotes.
    expect(
      checkUncommittedTrackerFiles(entries('?? tracker/tasks/task-9 - a real name.md'))
    ).toEqual(['tracker/tasks/task-9 - a real name.md (untracked)']);
  });

  it('passes through non-ASCII and raw control bytes untouched', () => {
    // The em dash is the common case in tracker/; the control byte is what the
    // old hand-rolled unquoter could only render as its octal digits.
    expect(checkUncommittedTrackerFiles(entries('?? tracker/tasks/task-7 - em — dash.md'))).toEqual(
      ['tracker/tasks/task-7 - em — dash.md (untracked)']
    );
  });

  it('keeps a filename that itself contains " -> " intact', () => {
    // Rename detection is off (see readTrackerGitStatus), so an arrow in an
    // entry is part of the name, never git's separator. Splitting on it would
    // silently report `execute.md` for this file.
    expect(
      checkUncommittedTrackerFiles(entries('?? tracker/tasks/task-1 - plan -> execute.md'))
    ).toEqual(['tracker/tasks/task-1 - plan -> execute.md (untracked)']);
  });

  it('labels a worktree type change', () => {
    expect(checkUncommittedTrackerFiles(entries(' T tracker/tasks/task-8 - swapped.md'))).toEqual([
      'tracker/tasks/task-8 - swapped.md (type changed, not staged)',
    ]);
  });

  it('falls back to a generic label for an unrecognized worktree status byte', () => {
    expect(checkUncommittedTrackerFiles(entries(' X tracker/tasks/task-6 - odd.md'))).toEqual([
      'tracker/tasks/task-6 - odd.md (uncommitted change)',
    ]);
  });

  it('reports every warning-worthy entry, not just the first', () => {
    // The N-entry half of the contract: per-status behavior is covered above,
    // but nothing else pins that the loop accumulates rather than returning
    // early — while still skipping the staged-only entry between them.
    expect(
      checkUncommittedTrackerFiles(
        entries('?? tracker/tasks/a.md', 'A  tracker/tasks/staged.md', ' M tracker/tasks/b.md')
      )
    ).toEqual(['tracker/tasks/a.md (untracked)', 'tracker/tasks/b.md (modified, not staged)']);
  });

  it('does not split on a newline, which is a legal filename byte under -z', () => {
    // The reason the separator had to move off '\n': a name containing one
    // would otherwise be torn into two bogus entries.
    expect(checkUncommittedTrackerFiles(entries('?? tracker/tasks/two\nline.md'))).toEqual([
      'tracker/tasks/two\nline.md (untracked)',
    ]);
  });
});

describe('readTrackerGitStatus', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns git output verbatim on success', () => {
    vi.mocked(execFileSync).mockReturnValue('?? tracker/tasks/task-7 - new.md\0');
    expect(readTrackerGitStatus('/repo')).toBe('?? tracker/tasks/task-7 - new.md\0');
  });

  it('returns null when the git call fails', () => {
    // The whole point of the seam: a repo-less or broken git must degrade to
    // "no answer", never throw out of `pnpm ops backlog`.
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error('not a git repository');
    });
    expect(readTrackerGitStatus('/repo')).toBeNull();
  });

  it('passes every flag the parser and the contract depend on', () => {
    // -z: otherwise git quotes and escapes any path with a space (every tracker
    // filename) or a non-ASCII byte, and the parser would have to undo it.
    // renames=false: otherwise a staged-rename-then-edited file arrives as one
    // entry holding two paths.
    // untracked-files=all: otherwise a wholly-untracked directory collapses to
    // one `?? dir/` entry instead of naming the files inside it.
    vi.mocked(execFileSync).mockReturnValue('');
    readTrackerGitStatus('/repo');

    const [, args, options] = vi.mocked(execFileSync).mock.calls[0];
    expect(args).toEqual([
      '--no-optional-locks',
      '-c',
      'status.renames=false',
      'status',
      '--porcelain',
      '-z',
      '--untracked-files=all',
      '--',
      'tracker/',
    ]);
    // `cwd` has no type-level enforcement — drop it and git silently reports on
    // whatever directory the process happens to be in, which for a tool that
    // runs from hooks is not necessarily this repo. `timeout` likewise: without
    // it a stalled git blocks `pnpm quality` and the pre-push hook outright
    // instead of degrading to the documented silent skip.
    expect(options).toMatchObject({ cwd: '/repo', timeout: TRACKER_STATUS_TIMEOUT_MS });
  });
});
