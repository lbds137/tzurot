import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Every other test injects `runGit`, so this mock is reached only by the
// default-runner tests at the bottom — exercising the real `execFileSync` seam.
vi.mock('node:child_process', () => ({ execFileSync: vi.fn(() => '') }));

import { execFileSync } from 'node:child_process';
import {
  trackerCommit,
  isBoardPath,
  parsePorcelainZEntries,
  buildCommitMessage,
  TRACKER_COMMIT_TIMEOUT_MS,
  TRACKER_COMMIT_COMMIT_TIMEOUT_MS,
  TRACKER_COMMIT_PUSH_TIMEOUT_MS,
  TRACKER_COMMIT_MAX_BUFFER,
  type RunGit,
} from './tracker-commit.js';

const MAIN_TREE = '/repo/main';
const WORKTREE = '/repo/.claude/worktrees/agent-abc';
const FEATURE_BRANCH = 'worktree-agent-abc';
const SUBJECT = 'docs(backlog): file TASK-1332 and update board';

/** Build a runGit stub from a handler map keyed on `${cwd ?? ''}::${args.join(' ')}`. */
function gitStub(handlers: Record<string, (args: string[], cwd?: string) => string>) {
  return vi.fn((args: string[], cwd?: string) => {
    const key = `${cwd ?? ''}::${args.join(' ')}`;
    if (args[0] === 'commit') {
      const commitHandler = handlers[`${cwd ?? ''}::commit`];
      if (commitHandler !== undefined) {
        return commitHandler(args, cwd);
      }
    }
    const handler = handlers[key];
    if (handler === undefined) {
      throw new Error(`unexpected git call: ${key}`);
    }
    return handler(args, cwd);
  });
}

function formatCalls(runGit: { mock: { calls: [string[], string?][] } }): string[] {
  return runGit.mock.calls.map(([args, cwd]) =>
    args[0] === 'commit' ? `${cwd ?? ''}::commit -m <message>` : `${cwd ?? ''}::${args.join(' ')}`
  );
}

describe('trackerCommit — current checkout holds develop', () => {
  it('stages exactly the board paths (including a path with spaces), leaves src/foo.ts unstaged, commits, and pushes', () => {
    const listing = [`worktree ${MAIN_TREE}`, 'HEAD aaa111', 'branch refs/heads/develop'].join(
      '\n'
    );
    const porcelain = [
      'M  tracker/tasks/task-1332 - Board commit command.md',
      ' M backlog/now.md',
      'M  BACKLOG.md',
      'M  CURRENT.md',
      ' M src/foo.ts',
      '?? docs/other.md',
      '',
    ].join('\0');

    const runGit = gitStub({
      '::rev-parse --show-toplevel': () => `${MAIN_TREE}\n`,
      [`${MAIN_TREE}::worktree list --porcelain`]: () => listing,
      [`${MAIN_TREE}::fetch origin develop`]: () => '',
      [`${MAIN_TREE}::rev-parse --verify --quiet refs/heads/develop`]: () => 'aaa111\n',
      [`${MAIN_TREE}::merge-base --is-ancestor origin/develop develop`]: () => '',
      [`${MAIN_TREE}::rev-list --count origin/develop..develop`]: () => '0\n',
      [`${MAIN_TREE}::status --porcelain -z`]: () => porcelain,
      [`${MAIN_TREE}::add -- tracker/tasks/task-1332 - Board commit command.md backlog/now.md BACKLOG.md CURRENT.md`]:
        () => '',
      [`${MAIN_TREE}::commit`]: () => '',
      [`${MAIN_TREE}::push origin develop`]: () => '',
    });
    const log = vi.fn();

    const result = trackerCommit({ subject: SUBJECT, runGit, log });

    expect(result).toEqual({ ok: true });
    expect(formatCalls(runGit)).toEqual([
      '::rev-parse --show-toplevel',
      `${MAIN_TREE}::worktree list --porcelain`,
      `${MAIN_TREE}::fetch origin develop`,
      `${MAIN_TREE}::rev-parse --verify --quiet refs/heads/develop`,
      `${MAIN_TREE}::merge-base --is-ancestor origin/develop develop`,
      `${MAIN_TREE}::rev-list --count origin/develop..develop`,
      `${MAIN_TREE}::status --porcelain -z`,
      `${MAIN_TREE}::add -- tracker/tasks/task-1332 - Board commit command.md backlog/now.md BACKLOG.md CURRENT.md`,
      `${MAIN_TREE}::commit -m <message>`,
      `${MAIN_TREE}::push origin develop`,
    ]);

    const addCallArgs = runGit.mock.calls[7]?.[0] as string[];
    expect(addCallArgs).toEqual([
      'add',
      '--',
      'tracker/tasks/task-1332 - Board commit command.md',
      'backlog/now.md',
      'BACKLOG.md',
      'CURRENT.md',
    ]);
    expect(addCallArgs).not.toContain('src/foo.ts');
    expect(addCallArgs).not.toContain('-A');

    const commitCallArgs = runGit.mock.calls[8]?.[0] as string[];
    expect(commitCallArgs).toEqual([
      'commit',
      '-m',
      buildCommitMessage(SUBJECT),
      '--',
      ...addCallArgs.slice(2),
    ]);
    expect(commitCallArgs[2]).toContain(SUBJECT);
    expect(commitCallArgs[2]).toContain(
      '🤖 Generated with [Claude Code](https://claude.com/claude-code)'
    );
    expect(commitCallArgs[2]).toContain('Co-Authored-By: Claude <noreply@anthropic.com>');
    expect(log).toHaveBeenCalledOnce();
  });

  it('stages a rename entry by destination and passes both destination and source to commit', () => {
    const listing = [`worktree ${MAIN_TREE}`, 'HEAD aaa111', 'branch refs/heads/develop'].join(
      '\n'
    );
    const porcelain =
      'R  tracker/tasks/task-1332 - New Title.md\0tracker/tasks/task-1332 - Old Title.md\0';

    const runGit = gitStub({
      '::rev-parse --show-toplevel': () => `${MAIN_TREE}\n`,
      [`${MAIN_TREE}::worktree list --porcelain`]: () => listing,
      [`${MAIN_TREE}::fetch origin develop`]: () => '',
      [`${MAIN_TREE}::rev-parse --verify --quiet refs/heads/develop`]: () => 'aaa111\n',
      [`${MAIN_TREE}::merge-base --is-ancestor origin/develop develop`]: () => '',
      [`${MAIN_TREE}::rev-list --count origin/develop..develop`]: () => '0\n',
      [`${MAIN_TREE}::status --porcelain -z`]: () => porcelain,
      [`${MAIN_TREE}::add -- tracker/tasks/task-1332 - New Title.md`]: () => '',
      [`${MAIN_TREE}::commit`]: () => '',
      [`${MAIN_TREE}::push origin develop`]: () => '',
    });

    const result = trackerCommit({ subject: SUBJECT, runGit, log: vi.fn() });

    expect(result).toEqual({ ok: true });
    expect(formatCalls(runGit)).toEqual([
      '::rev-parse --show-toplevel',
      `${MAIN_TREE}::worktree list --porcelain`,
      `${MAIN_TREE}::fetch origin develop`,
      `${MAIN_TREE}::rev-parse --verify --quiet refs/heads/develop`,
      `${MAIN_TREE}::merge-base --is-ancestor origin/develop develop`,
      `${MAIN_TREE}::rev-list --count origin/develop..develop`,
      `${MAIN_TREE}::status --porcelain -z`,
      `${MAIN_TREE}::add -- tracker/tasks/task-1332 - New Title.md`,
      `${MAIN_TREE}::commit -m <message>`,
      `${MAIN_TREE}::push origin develop`,
    ]);
    expect(runGit.mock.calls[7]?.[0]).toEqual([
      'add',
      '--',
      'tracker/tasks/task-1332 - New Title.md',
    ]);
    expect(runGit.mock.calls[8]?.[0]).toEqual([
      'commit',
      '-m',
      buildCommitMessage(SUBJECT),
      '--',
      'tracker/tasks/task-1332 - New Title.md',
      'tracker/tasks/task-1332 - Old Title.md',
    ]);
  });
});

describe('trackerCommit — another checkout holds develop', () => {
  const listing = [
    `worktree ${MAIN_TREE}`,
    'HEAD aaa111',
    'branch refs/heads/develop',
    '',
    `worktree ${WORKTREE}`,
    'HEAD bbb222',
    `branch refs/heads/${FEATURE_BRANCH}`,
  ].join('\n');

  it("carries the other checkout's cwd on every stage, commit, and push call", () => {
    const runGit = gitStub({
      '::rev-parse --show-toplevel': () => `${WORKTREE}\n`,
      [`${WORKTREE}::worktree list --porcelain`]: () => listing,
      [`${MAIN_TREE}::fetch origin develop`]: () => '',
      [`${MAIN_TREE}::rev-parse --verify --quiet refs/heads/develop`]: () => 'aaa111\n',
      [`${MAIN_TREE}::merge-base --is-ancestor origin/develop develop`]: () => '',
      [`${MAIN_TREE}::rev-list --count origin/develop..develop`]: () => '0\n',
      [`${WORKTREE}::status --porcelain -z`]: () => ' M src/feature.ts\0',
      [`${MAIN_TREE}::status --porcelain -z`]: () =>
        'M  tracker/tasks/task-1332 - Title.md\0M  backlog/now.md\0',
      [`${MAIN_TREE}::add -- tracker/tasks/task-1332 - Title.md backlog/now.md`]: () => '',
      [`${MAIN_TREE}::commit`]: () => '',
      [`${MAIN_TREE}::push origin develop`]: () => '',
    });

    const result = trackerCommit({ subject: SUBJECT, runGit, log: vi.fn() });

    expect(result).toEqual({ ok: true });
    expect(formatCalls(runGit)).toEqual([
      '::rev-parse --show-toplevel',
      `${WORKTREE}::worktree list --porcelain`,
      `${MAIN_TREE}::fetch origin develop`,
      `${MAIN_TREE}::rev-parse --verify --quiet refs/heads/develop`,
      `${MAIN_TREE}::merge-base --is-ancestor origin/develop develop`,
      `${MAIN_TREE}::rev-list --count origin/develop..develop`,
      `${WORKTREE}::status --porcelain -z`,
      `${MAIN_TREE}::status --porcelain -z`,
      `${MAIN_TREE}::add -- tracker/tasks/task-1332 - Title.md backlog/now.md`,
      `${MAIN_TREE}::commit -m <message>`,
      `${MAIN_TREE}::push origin develop`,
    ]);
    expect(runGit.mock.calls[8]?.[1]).toBe(MAIN_TREE);
    expect(runGit.mock.calls[9]?.[1]).toBe(MAIN_TREE);
    expect(runGit.mock.calls[10]?.[1]).toBe(MAIN_TREE);
  });

  it('refuses stranded-board-files naming the current checkout board files with no stage, commit, or push call', () => {
    const runGit = gitStub({
      '::rev-parse --show-toplevel': () => `${WORKTREE}\n`,
      [`${WORKTREE}::worktree list --porcelain`]: () => listing,
      [`${MAIN_TREE}::fetch origin develop`]: () => '',
      [`${MAIN_TREE}::rev-parse --verify --quiet refs/heads/develop`]: () => 'aaa111\n',
      [`${MAIN_TREE}::merge-base --is-ancestor origin/develop develop`]: () => '',
      [`${MAIN_TREE}::rev-list --count origin/develop..develop`]: () => '0\n',
      [`${WORKTREE}::status --porcelain -z`]: () =>
        '?? tracker/tasks/task-1332 - Stranded.md\0 M src/feature.ts\0',
    });

    const result = trackerCommit({ subject: SUBJECT, runGit, log: vi.fn() });

    expect(result).toEqual({
      ok: false,
      check: 'stranded-board-files',
      reason:
        'current checkout has dirty board files that would be left behind: tracker/tasks/task-1332 - Stranded.md',
    });
    expect(formatCalls(runGit)).toEqual([
      '::rev-parse --show-toplevel',
      `${WORKTREE}::worktree list --porcelain`,
      `${MAIN_TREE}::fetch origin develop`,
      `${MAIN_TREE}::rev-parse --verify --quiet refs/heads/develop`,
      `${MAIN_TREE}::merge-base --is-ancestor origin/develop develop`,
      `${MAIN_TREE}::rev-list --count origin/develop..develop`,
      `${WORKTREE}::status --porcelain -z`,
    ]);
  });
});

describe('trackerCommit — no checkout holds develop', () => {
  const listing = [
    `worktree ${MAIN_TREE}`,
    'HEAD bbb222',
    `branch refs/heads/${FEATURE_BRANCH}`,
  ].join('\n');

  it('runs switch develop, stage, commit, push, then switch back, in that order', () => {
    const runGit = gitStub({
      '::rev-parse --show-toplevel': () => `${MAIN_TREE}\n`,
      [`${MAIN_TREE}::worktree list --porcelain`]: () => listing,
      [`${MAIN_TREE}::fetch origin develop`]: () => '',
      [`${MAIN_TREE}::rev-parse --verify --quiet refs/heads/develop`]: () => 'aaa111\n',
      [`${MAIN_TREE}::merge-base --is-ancestor origin/develop develop`]: () => '',
      [`${MAIN_TREE}::rev-list --count origin/develop..develop`]: () => '0\n',
      [`${MAIN_TREE}::status --porcelain -z`]: () =>
        'M  tracker/tasks/task-1332 - Title.md\0 M src/foo.ts\0',
      [`${MAIN_TREE}::switch develop`]: () => '',
      [`${MAIN_TREE}::add -- tracker/tasks/task-1332 - Title.md`]: () => '',
      [`${MAIN_TREE}::commit`]: () => '',
      [`${MAIN_TREE}::push origin develop`]: () => '',
      [`${MAIN_TREE}::switch ${FEATURE_BRANCH}`]: () => '',
    });

    const result = trackerCommit({ subject: SUBJECT, runGit, log: vi.fn() });

    expect(result).toEqual({ ok: true });
    expect(formatCalls(runGit)).toEqual([
      '::rev-parse --show-toplevel',
      `${MAIN_TREE}::worktree list --porcelain`,
      `${MAIN_TREE}::fetch origin develop`,
      `${MAIN_TREE}::rev-parse --verify --quiet refs/heads/develop`,
      `${MAIN_TREE}::merge-base --is-ancestor origin/develop develop`,
      `${MAIN_TREE}::rev-list --count origin/develop..develop`,
      `${MAIN_TREE}::status --porcelain -z`,
      `${MAIN_TREE}::switch develop`,
      `${MAIN_TREE}::add -- tracker/tasks/task-1332 - Title.md`,
      `${MAIN_TREE}::commit -m <message>`,
      `${MAIN_TREE}::push origin develop`,
      `${MAIN_TREE}::switch ${FEATURE_BRANCH}`,
    ]);
  });

  it('resets the commit pathspec and switches back when commit fails, refusing commit without pushing', () => {
    const runGit = gitStub({
      '::rev-parse --show-toplevel': () => `${MAIN_TREE}\n`,
      [`${MAIN_TREE}::worktree list --porcelain`]: () => listing,
      [`${MAIN_TREE}::fetch origin develop`]: () => '',
      [`${MAIN_TREE}::rev-parse --verify --quiet refs/heads/develop`]: () => 'aaa111\n',
      [`${MAIN_TREE}::merge-base --is-ancestor origin/develop develop`]: () => '',
      [`${MAIN_TREE}::rev-list --count origin/develop..develop`]: () => '0\n',
      [`${MAIN_TREE}::status --porcelain -z`]: () => 'M  tracker/tasks/task-1332 - Title.md\0',
      [`${MAIN_TREE}::switch develop`]: () => '',
      [`${MAIN_TREE}::add -- tracker/tasks/task-1332 - Title.md`]: () => '',
      [`${MAIN_TREE}::commit`]: () => {
        const error = new Error('Command failed') as Error & { stderr?: string };
        error.stderr = 'husky - pre-commit hook exited with code 1\n';
        throw error;
      },
      [`${MAIN_TREE}::reset -q -- tracker/tasks/task-1332 - Title.md`]: () => '',
      [`${MAIN_TREE}::switch ${FEATURE_BRANCH}`]: () => '',
    });

    const result = trackerCommit({ subject: SUBJECT, runGit, log: vi.fn() });

    expect(result).toMatchObject({ ok: false, check: 'commit' });
    expect(result.ok === false && result.reason).toContain(
      'husky - pre-commit hook exited with code 1'
    );
    expect(result.ok === false && result.reason).toContain('still modified and unstaged');
    expect(formatCalls(runGit)).toEqual([
      '::rev-parse --show-toplevel',
      `${MAIN_TREE}::worktree list --porcelain`,
      `${MAIN_TREE}::fetch origin develop`,
      `${MAIN_TREE}::rev-parse --verify --quiet refs/heads/develop`,
      `${MAIN_TREE}::merge-base --is-ancestor origin/develop develop`,
      `${MAIN_TREE}::rev-list --count origin/develop..develop`,
      `${MAIN_TREE}::status --porcelain -z`,
      `${MAIN_TREE}::switch develop`,
      `${MAIN_TREE}::add -- tracker/tasks/task-1332 - Title.md`,
      `${MAIN_TREE}::commit -m <message>`,
      `${MAIN_TREE}::reset -q -- tracker/tasks/task-1332 - Title.md`,
      `${MAIN_TREE}::switch ${FEATURE_BRANCH}`,
    ]);
  });

  it('reports when git reset also fails after a rejected commit', () => {
    const runGit = gitStub({
      '::rev-parse --show-toplevel': () => `${MAIN_TREE}\n`,
      [`${MAIN_TREE}::worktree list --porcelain`]: () => listing,
      [`${MAIN_TREE}::fetch origin develop`]: () => '',
      [`${MAIN_TREE}::rev-parse --verify --quiet refs/heads/develop`]: () => 'aaa111\n',
      [`${MAIN_TREE}::merge-base --is-ancestor origin/develop develop`]: () => '',
      [`${MAIN_TREE}::rev-list --count origin/develop..develop`]: () => '0\n',
      [`${MAIN_TREE}::status --porcelain -z`]: () => 'M  tracker/tasks/task-1332 - Title.md\0',
      [`${MAIN_TREE}::switch develop`]: () => '',
      [`${MAIN_TREE}::add -- tracker/tasks/task-1332 - Title.md`]: () => '',
      [`${MAIN_TREE}::commit`]: () => {
        throw new Error('commit hook failed');
      },
      [`${MAIN_TREE}::reset -q -- tracker/tasks/task-1332 - Title.md`]: () => {
        throw new Error('unable to write index');
      },
      [`${MAIN_TREE}::switch ${FEATURE_BRANCH}`]: () => '',
    });

    const result = trackerCommit({ subject: SUBJECT, runGit, log: vi.fn() });

    expect(result).toMatchObject({ ok: false, check: 'commit' });
    expect(result.ok === false && result.reason).toContain('git reset also failed');
    expect(result.ok === false && result.reason).toContain('unable to write index');
  });

  it('still switches back when push fails, and refuses push with recovery instructions', () => {
    const runGit = gitStub({
      '::rev-parse --show-toplevel': () => `${MAIN_TREE}\n`,
      [`${MAIN_TREE}::worktree list --porcelain`]: () => listing,
      [`${MAIN_TREE}::fetch origin develop`]: () => '',
      [`${MAIN_TREE}::rev-parse --verify --quiet refs/heads/develop`]: () => 'aaa111\n',
      [`${MAIN_TREE}::merge-base --is-ancestor origin/develop develop`]: () => '',
      [`${MAIN_TREE}::rev-list --count origin/develop..develop`]: () => '0\n',
      [`${MAIN_TREE}::status --porcelain -z`]: () => 'M  tracker/tasks/task-1332 - Title.md\0',
      [`${MAIN_TREE}::switch develop`]: () => '',
      [`${MAIN_TREE}::add -- tracker/tasks/task-1332 - Title.md`]: () => '',
      [`${MAIN_TREE}::commit`]: () => '',
      [`${MAIN_TREE}::push origin develop`]: () => {
        const error = new Error('Command failed') as Error & { stderr?: string };
        error.stderr = 'fatal: unable to access remote\n';
        throw error;
      },
      [`${MAIN_TREE}::switch ${FEATURE_BRANCH}`]: () => '',
    });

    const result = trackerCommit({ subject: SUBJECT, runGit, log: vi.fn() });

    expect(result).toMatchObject({ ok: false, check: 'push' });
    expect(result.ok === false && result.reason).toContain('fatal: unable to access remote');
    expect(result.ok === false && result.reason).toContain('local develop');
    expect(result.ok === false && result.reason).toContain('git switch develop');
    expect(result.ok === false && result.reason).toContain('git pull --rebase');
    expect(result.ok === false && result.reason).toContain('git push');
    expect(formatCalls(runGit)).toEqual([
      '::rev-parse --show-toplevel',
      `${MAIN_TREE}::worktree list --porcelain`,
      `${MAIN_TREE}::fetch origin develop`,
      `${MAIN_TREE}::rev-parse --verify --quiet refs/heads/develop`,
      `${MAIN_TREE}::merge-base --is-ancestor origin/develop develop`,
      `${MAIN_TREE}::rev-list --count origin/develop..develop`,
      `${MAIN_TREE}::status --porcelain -z`,
      `${MAIN_TREE}::switch develop`,
      `${MAIN_TREE}::add -- tracker/tasks/task-1332 - Title.md`,
      `${MAIN_TREE}::commit -m <message>`,
      `${MAIN_TREE}::push origin develop`,
      `${MAIN_TREE}::switch ${FEATURE_BRANCH}`,
    ]);
  });

  it('refuses when switch back fails, naming the recorded branch and pre-commit hook hint', () => {
    const runGit = gitStub({
      '::rev-parse --show-toplevel': () => `${MAIN_TREE}\n`,
      [`${MAIN_TREE}::worktree list --porcelain`]: () => listing,
      [`${MAIN_TREE}::fetch origin develop`]: () => '',
      [`${MAIN_TREE}::rev-parse --verify --quiet refs/heads/develop`]: () => 'aaa111\n',
      [`${MAIN_TREE}::merge-base --is-ancestor origin/develop develop`]: () => '',
      [`${MAIN_TREE}::rev-list --count origin/develop..develop`]: () => '0\n',
      [`${MAIN_TREE}::status --porcelain -z`]: () => 'M  tracker/tasks/task-1332 - Title.md\0',
      [`${MAIN_TREE}::switch develop`]: () => '',
      [`${MAIN_TREE}::add -- tracker/tasks/task-1332 - Title.md`]: () => '',
      [`${MAIN_TREE}::commit`]: () => '',
      [`${MAIN_TREE}::push origin develop`]: () => '',
      [`${MAIN_TREE}::switch ${FEATURE_BRANCH}`]: () => {
        throw new Error('error: Your local changes would be overwritten by checkout');
      },
    });

    const result = trackerCommit({ subject: SUBJECT, runGit, log: vi.fn() });

    expect(result).toMatchObject({ ok: false, check: 'switch-back' });
    expect(result.ok === false && result.reason).toContain(FEATURE_BRANCH);
    expect(result.ok === false && result.reason).toContain(
      'Your local changes would be overwritten by checkout'
    );
    expect(result.ok === false && result.reason).toContain('pre-commit hook');
    expect(formatCalls(runGit)).toEqual([
      '::rev-parse --show-toplevel',
      `${MAIN_TREE}::worktree list --porcelain`,
      `${MAIN_TREE}::fetch origin develop`,
      `${MAIN_TREE}::rev-parse --verify --quiet refs/heads/develop`,
      `${MAIN_TREE}::merge-base --is-ancestor origin/develop develop`,
      `${MAIN_TREE}::rev-list --count origin/develop..develop`,
      `${MAIN_TREE}::status --porcelain -z`,
      `${MAIN_TREE}::switch develop`,
      `${MAIN_TREE}::add -- tracker/tasks/task-1332 - Title.md`,
      `${MAIN_TREE}::commit -m <message>`,
      `${MAIN_TREE}::push origin develop`,
      `${MAIN_TREE}::switch ${FEATURE_BRANCH}`,
    ]);
  });

  it('refuses switch when git switch develop fails on a conflicting dirty file, with no stage or commit', () => {
    const runGit = gitStub({
      '::rev-parse --show-toplevel': () => `${MAIN_TREE}\n`,
      [`${MAIN_TREE}::worktree list --porcelain`]: () => listing,
      [`${MAIN_TREE}::fetch origin develop`]: () => '',
      [`${MAIN_TREE}::rev-parse --verify --quiet refs/heads/develop`]: () => 'aaa111\n',
      [`${MAIN_TREE}::merge-base --is-ancestor origin/develop develop`]: () => '',
      [`${MAIN_TREE}::rev-list --count origin/develop..develop`]: () => '0\n',
      [`${MAIN_TREE}::status --porcelain -z`]: () => 'M  tracker/tasks/task-1332 - Title.md\0',
      [`${MAIN_TREE}::switch develop`]: () => {
        throw new Error('error: Your local changes to the following files would be overwritten');
      },
    });

    const result = trackerCommit({ subject: SUBJECT, runGit, log: vi.fn() });

    expect(result).toMatchObject({ ok: false, check: 'switch' });
    expect(result.ok === false && result.reason).toContain('would be overwritten');
    expect(formatCalls(runGit)).toEqual([
      '::rev-parse --show-toplevel',
      `${MAIN_TREE}::worktree list --porcelain`,
      `${MAIN_TREE}::fetch origin develop`,
      `${MAIN_TREE}::rev-parse --verify --quiet refs/heads/develop`,
      `${MAIN_TREE}::merge-base --is-ancestor origin/develop develop`,
      `${MAIN_TREE}::rev-list --count origin/develop..develop`,
      `${MAIN_TREE}::status --porcelain -z`,
      `${MAIN_TREE}::switch develop`,
    ]);
  });
});

describe('trackerCommit — pre-write check refusals', () => {
  const listing = [`worktree ${MAIN_TREE}`, 'HEAD aaa111', 'branch refs/heads/develop'].join('\n');

  it('refuses an empty subject before any git call', () => {
    const runGit = gitStub({});

    const result = trackerCommit({ subject: '   ', runGit, log: vi.fn() });

    expect(result).toEqual({
      ok: false,
      check: 'subject',
      reason: 'commit subject must not be empty',
    });
    expect(runGit).not.toHaveBeenCalled();
  });

  it('refuses target when no checkout holds develop and current checkout is detached', () => {
    const detachedListing = [`worktree ${MAIN_TREE}`, 'HEAD aaa111', 'detached'].join('\n');
    const runGit = gitStub({
      '::rev-parse --show-toplevel': () => `${MAIN_TREE}\n`,
      [`${MAIN_TREE}::worktree list --porcelain`]: () => detachedListing,
    });

    const result = trackerCommit({ subject: SUBJECT, runGit, log: vi.fn() });

    expect(result).toMatchObject({ ok: false, check: 'target' });
    expect(formatCalls(runGit)).toEqual([
      '::rev-parse --show-toplevel',
      `${MAIN_TREE}::worktree list --porcelain`,
    ]);
  });

  it('refuses fresh when local develop is behind or diverged from origin/develop, with no write', () => {
    const runGit = gitStub({
      '::rev-parse --show-toplevel': () => `${MAIN_TREE}\n`,
      [`${MAIN_TREE}::worktree list --porcelain`]: () => listing,
      [`${MAIN_TREE}::fetch origin develop`]: () => '',
      [`${MAIN_TREE}::rev-parse --verify --quiet refs/heads/develop`]: () => 'aaa111\n',
      [`${MAIN_TREE}::merge-base --is-ancestor origin/develop develop`]: () => {
        throw new Error('Command failed: git merge-base --is-ancestor origin/develop develop');
      },
    });

    const result = trackerCommit({ subject: SUBJECT, runGit, log: vi.fn() });

    expect(result).toMatchObject({ ok: false, check: 'fresh' });
    expect(result.ok === false && result.reason).toContain(
      'local develop is behind or diverged from origin/develop'
    );
    expect(formatCalls(runGit)).toEqual([
      '::rev-parse --show-toplevel',
      `${MAIN_TREE}::worktree list --porcelain`,
      `${MAIN_TREE}::fetch origin develop`,
      `${MAIN_TREE}::rev-parse --verify --quiet refs/heads/develop`,
      `${MAIN_TREE}::merge-base --is-ancestor origin/develop develop`,
    ]);
  });

  it('refuses fresh when git fetch origin develop fails, with no write', () => {
    const runGit = gitStub({
      '::rev-parse --show-toplevel': () => `${MAIN_TREE}\n`,
      [`${MAIN_TREE}::worktree list --porcelain`]: () => listing,
      [`${MAIN_TREE}::fetch origin develop`]: () => {
        throw new Error('fatal: could not read from remote repository');
      },
    });

    const result = trackerCommit({ subject: SUBJECT, runGit, log: vi.fn() });

    expect(result).toMatchObject({ ok: false, check: 'fresh' });
    expect(result.ok === false && result.reason).toContain(
      'fatal: could not read from remote repository'
    );
    expect(formatCalls(runGit)).toEqual([
      '::rev-parse --show-toplevel',
      `${MAIN_TREE}::worktree list --porcelain`,
      `${MAIN_TREE}::fetch origin develop`,
    ]);
  });

  it('refuses nothing-to-commit when no dirty board paths exist, with no write', () => {
    const runGit = gitStub({
      '::rev-parse --show-toplevel': () => `${MAIN_TREE}\n`,
      [`${MAIN_TREE}::worktree list --porcelain`]: () => listing,
      [`${MAIN_TREE}::fetch origin develop`]: () => '',
      [`${MAIN_TREE}::rev-parse --verify --quiet refs/heads/develop`]: () => 'aaa111\n',
      [`${MAIN_TREE}::merge-base --is-ancestor origin/develop develop`]: () => '',
      [`${MAIN_TREE}::rev-list --count origin/develop..develop`]: () => '0\n',
      [`${MAIN_TREE}::status --porcelain -z`]: () => ' M src/foo.ts\0?? docs/guide.md\0',
    });

    const result = trackerCommit({ subject: SUBJECT, runGit, log: vi.fn() });

    expect(result).toEqual({
      ok: false,
      check: 'nothing-to-commit',
      reason: 'no dirty board paths found in the target checkout',
    });
    expect(formatCalls(runGit)).toEqual([
      '::rev-parse --show-toplevel',
      `${MAIN_TREE}::worktree list --porcelain`,
      `${MAIN_TREE}::fetch origin develop`,
      `${MAIN_TREE}::rev-parse --verify --quiet refs/heads/develop`,
      `${MAIN_TREE}::merge-base --is-ancestor origin/develop develop`,
      `${MAIN_TREE}::rev-list --count origin/develop..develop`,
      `${MAIN_TREE}::status --porcelain -z`,
    ]);
  });
});

describe('isBoardPath and parsePorcelainZEntries', () => {
  it('matches tracker/**, backlog/**, BACKLOG.md, and CURRENT.md only', () => {
    expect(isBoardPath('tracker/tasks/task-1 - Foo.md')).toBe(true);
    expect(isBoardPath('backlog/now.md')).toBe(true);
    expect(isBoardPath('backlog/cadence-ledger.json')).toBe(true);
    expect(isBoardPath('BACKLOG.md')).toBe(true);
    expect(isBoardPath('CURRENT.md')).toBe(true);
    expect(isBoardPath('src/foo.ts')).toBe(false);
    expect(isBoardPath('docs/README.md')).toBe(false);
    expect(isBoardPath('tracker-extra/foo.md')).toBe(false);
    expect(isBoardPath('CURRENT.md.bak')).toBe(false);
  });

  it('parses XY status, path, and R/C source path from porcelain -z output', () => {
    const raw = [
      'M  tracker/a.md',
      'R  tracker/new.md',
      'tracker/old.md',
      'C  backlog/copy.md',
      'backlog/orig.md',
      'D  tracker/gone.md',
      '',
    ].join('\0');

    expect(parsePorcelainZEntries(raw)).toEqual([
      { xy: 'M ', path: 'tracker/a.md' },
      { xy: 'R ', path: 'tracker/new.md', fromPath: 'tracker/old.md' },
      { xy: 'C ', path: 'backlog/copy.md', fromPath: 'backlog/orig.md' },
      { xy: 'D ', path: 'tracker/gone.md' },
    ]);
  });
});

describe('default runner (no injected runGit)', () => {
  it('uses 60s timeout for local/fetch calls, 120s for commit, and 600s for push', () => {
    vi.mocked(execFileSync).mockClear();
    const listing = [`worktree ${MAIN_TREE}`, 'HEAD aaa111', 'branch refs/heads/develop'].join(
      '\n'
    );
    vi.mocked(execFileSync).mockImplementation(((_cmd: string, args: readonly string[]) => {
      const joined = args.join(' ');
      if (joined === 'rev-parse --show-toplevel') return `${MAIN_TREE}\n`;
      if (joined === 'worktree list --porcelain') return listing;
      if (joined === 'rev-list --count origin/develop..develop') return '0\n';
      if (joined === 'status --porcelain -z') return 'M  CURRENT.md\0';
      return '';
    }) as unknown as typeof execFileSync);

    const result = trackerCommit({ subject: SUBJECT, log: vi.fn() });
    expect(result).toEqual({ ok: true });

    const calls = vi.mocked(execFileSync).mock.calls;
    expect(calls.length).toBe(10);
    for (const call of calls) {
      expect(call[0]).toBe('git');
      const args = call[1] as string[];
      const expectedTimeout =
        args[0] === 'push'
          ? TRACKER_COMMIT_PUSH_TIMEOUT_MS
          : args[0] === 'commit'
            ? TRACKER_COMMIT_COMMIT_TIMEOUT_MS
            : TRACKER_COMMIT_TIMEOUT_MS;
      expect(call[2]).toMatchObject({
        timeout: expectedTimeout,
        encoding: 'utf-8',
        maxBuffer: TRACKER_COMMIT_MAX_BUFFER,
      });
    }
  });
});

describe('trackerCommit — real git repository', () => {
  let realExecFileSync: typeof execFileSync;
  let tmpRoot: string;
  let originDir: string;
  let cloneDir: string;
  let repoCwd: string;
  let runGit: RunGit;

  function cleanGitEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env.GIT_DIR;
    delete env.GIT_WORK_TREE;
    delete env.GIT_INDEX_FILE;
    delete env.GIT_PREFIX;
    return env;
  }

  function gitIn(cwd: string, args: string[]): string {
    return realExecFileSync('git', args, {
      cwd,
      encoding: 'utf-8',
      stdio: 'pipe',
      env: cleanGitEnv(),
    });
  }

  function originTreeFiles(): string[] {
    return gitIn(originDir, ['ls-tree', '-r', '--name-only', 'refs/heads/develop'])
      .trim()
      .split('\n')
      .filter(line => line.length > 0);
  }

  function originDevelopSha(): string {
    return gitIn(originDir, ['rev-parse', 'refs/heads/develop']).trim();
  }

  beforeEach(async () => {
    const actualChildProcess =
      await vi.importActual<typeof import('node:child_process')>('node:child_process');
    realExecFileSync = actualChildProcess.execFileSync;

    tmpRoot = mkdtempSync(join(tmpdir(), 'tracker-commit-real-'));
    originDir = join(tmpRoot, 'origin.git');
    cloneDir = join(tmpRoot, 'clone');
    mkdirSync(originDir, { recursive: true });

    gitIn(originDir, ['init', '--bare', '--initial-branch=develop']);
    gitIn(tmpRoot, ['clone', originDir, cloneDir]);
    gitIn(cloneDir, ['config', 'user.name', 'Test User']);
    gitIn(cloneDir, ['config', 'user.email', 'test@example.com']);
    gitIn(cloneDir, ['checkout', '-B', 'develop']);

    mkdirSync(join(cloneDir, 'tracker/tasks'), { recursive: true });
    mkdirSync(join(cloneDir, 'src'), { recursive: true });
    writeFileSync(join(cloneDir, 'tracker/tasks/task-1.md'), '# Task 1\n');
    writeFileSync(join(cloneDir, 'tracker/x.md'), '# X\n');
    writeFileSync(join(cloneDir, 'src/index.ts'), 'export const index = 1;\n');

    gitIn(cloneDir, ['add', '.']);
    gitIn(cloneDir, ['commit', '-m', 'chore: seed repository']);
    gitIn(cloneDir, ['push', '-u', 'origin', 'develop']);

    repoCwd = cloneDir;
    runGit = (args: string[], cwd?: string): string => gitIn(cwd ?? repoCwd, args);
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('refuses fresh when develop is ahead with an unrelated local commit, naming 1 commit and leaving origin unchanged', () => {
    const beforeSha = originDevelopSha();
    writeFileSync(join(cloneDir, 'src/index.ts'), 'export const index = 2;\n');
    gitIn(cloneDir, ['add', 'src/index.ts']);
    gitIn(cloneDir, ['commit', '-m', 'feat: unrelated local commit']);

    writeFileSync(join(cloneDir, 'CURRENT.md'), '# Current\n');

    const result = trackerCommit({ subject: SUBJECT, runGit, log: vi.fn() });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.check).toBe('fresh');
      expect(result.reason).toMatch(/\b1\b.*commit/);
    }
    expect(originDevelopSha()).toBe(beforeSha);
  });

  it('refuses fresh with the missing-ref reason when no local develop ref exists', () => {
    const beforeSha = originDevelopSha();
    gitIn(cloneDir, ['switch', '-c', 'feature']);
    gitIn(cloneDir, ['branch', '-D', 'develop']);

    writeFileSync(join(cloneDir, 'CURRENT.md'), '# Current\n');

    const result = trackerCommit({ subject: SUBJECT, runGit, log: vi.fn() });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.check).toBe('fresh');
      expect(result.reason).toContain('refs/heads/develop');
      expect(result.reason).not.toContain('behind or diverged');
    }
    expect(originDevelopSha()).toBe(beforeSha);
  });

  it('commits a staged git rm of a tracked tracker/ file and reports nothing-to-commit on a second run', () => {
    gitIn(cloneDir, ['rm', 'tracker/tasks/task-1.md']);

    const first = trackerCommit({ subject: SUBJECT, runGit, log: vi.fn() });
    expect(first).toEqual({ ok: true });
    expect(originTreeFiles()).not.toContain('tracker/tasks/task-1.md');

    const second = trackerCommit({ subject: SUBJECT, runGit, log: vi.fn() });
    expect(second).toMatchObject({ ok: false, check: 'nothing-to-commit' });
  });

  it('commits an unstaged deletion of a tracked tracker/ file and reports nothing-to-commit on a second run', () => {
    rmSync(join(cloneDir, 'tracker/tasks/task-1.md'));

    const first = trackerCommit({ subject: SUBJECT, runGit, log: vi.fn() });
    expect(first).toEqual({ ok: true });
    expect(originTreeFiles()).not.toContain('tracker/tasks/task-1.md');

    const second = trackerCommit({ subject: SUBJECT, runGit, log: vi.fn() });
    expect(second).toMatchObject({ ok: false, check: 'nothing-to-commit' });
  });

  it('commits a git mv within tracker/ whole so origin has only the destination and nothing stays staged', () => {
    gitIn(cloneDir, ['mv', 'tracker/tasks/task-1.md', 'tracker/tasks/task-1-renamed.md']);

    const result = trackerCommit({ subject: SUBJECT, runGit, log: vi.fn() });
    expect(result).toEqual({ ok: true });

    const files = originTreeFiles();
    expect(files).toContain('tracker/tasks/task-1-renamed.md');
    expect(files).not.toContain('tracker/tasks/task-1.md');
    expect(gitIn(cloneDir, ['diff', '--cached', '--name-only']).trim()).toBe('');
  });

  it('refuses mixed-rename when git mv moves tracker/x.md to src/x.md, leaving origin unchanged', () => {
    const beforeSha = originDevelopSha();
    gitIn(cloneDir, ['mv', 'tracker/x.md', 'src/x.md']);

    const result = trackerCommit({ subject: SUBJECT, runGit, log: vi.fn() });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.check).toBe('mixed-rename');
      expect(result.reason).toContain('tracker/x.md');
      expect(result.reason).toContain('src/x.md');
    }
    expect(originDevelopSha()).toBe(beforeSha);
  });

  it('commits an untracked directory under tracker/ with two files so both reach origin', () => {
    mkdirSync(join(cloneDir, 'tracker/new-dir'), { recursive: true });
    writeFileSync(join(cloneDir, 'tracker/new-dir/one.md'), '# One\n');
    writeFileSync(join(cloneDir, 'tracker/new-dir/two.md'), '# Two\n');

    const result = trackerCommit({ subject: SUBJECT, runGit, log: vi.fn() });
    expect(result).toEqual({ ok: true });

    const files = originTreeFiles();
    expect(files).toContain('tracker/new-dir/one.md');
    expect(files).toContain('tracker/new-dir/two.md');
  });

  it('succeeds when run from a subdirectory (<clone>/src) for both the current case and the switch case', () => {
    repoCwd = join(cloneDir, 'src');

    writeFileSync(join(cloneDir, 'tracker/tasks/from-subdir-current.md'), '# Current subdir\n');
    const currentResult = trackerCommit({ subject: SUBJECT, runGit, log: vi.fn() });
    expect(currentResult).toEqual({ ok: true });
    expect(originTreeFiles()).toContain('tracker/tasks/from-subdir-current.md');

    gitIn(cloneDir, ['switch', '-c', 'feature']);
    writeFileSync(join(cloneDir, 'tracker/tasks/from-subdir-switch.md'), '# Switch subdir\n');
    const switchResult = trackerCommit({ subject: SUBJECT, runGit, log: vi.fn() });
    expect(switchResult).toEqual({ ok: true });
    expect(originTreeFiles()).toContain('tracker/tasks/from-subdir-switch.md');
    expect(gitIn(cloneDir, ['branch', '--show-current']).trim()).toBe('feature');
  });

  it('refuses commit when .git/hooks/commit-msg exits 1, unstages the board paths, and switches back in the switch case', () => {
    const beforeSha = originDevelopSha();
    const hookPath = join(cloneDir, '.git/hooks/commit-msg');
    mkdirSync(join(cloneDir, '.git/hooks'), { recursive: true });
    writeFileSync(hookPath, '#!/bin/sh\nexit 1\n');
    chmodSync(hookPath, 0o755);

    writeFileSync(join(cloneDir, 'tracker/tasks/task-1.md'), '# Modified\n');

    const currentResult = trackerCommit({ subject: SUBJECT, runGit, log: vi.fn() });
    expect(currentResult).toMatchObject({ ok: false, check: 'commit' });
    expect(gitIn(cloneDir, ['diff', '--cached', '--name-only']).trim()).toBe('');
    expect(originDevelopSha()).toBe(beforeSha);

    gitIn(cloneDir, ['switch', '-c', 'feature']);
    const switchResult = trackerCommit({ subject: SUBJECT, runGit, log: vi.fn() });
    expect(switchResult).toMatchObject({ ok: false, check: 'commit' });
    expect(gitIn(cloneDir, ['diff', '--cached', '--name-only']).trim()).toBe('');
    expect(gitIn(cloneDir, ['branch', '--show-current']).trim()).toBe('feature');
    expect(originDevelopSha()).toBe(beforeSha);
  });

  it('keeps a file someone else staged (src/staged.ts) out of the commit and still staged', () => {
    writeFileSync(join(cloneDir, 'src/staged.ts'), 'export const staged = true;\n');
    gitIn(cloneDir, ['add', 'src/staged.ts']);
    writeFileSync(join(cloneDir, 'CURRENT.md'), '# Current update\n');

    const result = trackerCommit({ subject: SUBJECT, runGit, log: vi.fn() });
    expect(result).toEqual({ ok: true });

    const files = originTreeFiles();
    expect(files).toContain('CURRENT.md');
    expect(files).not.toContain('src/staged.ts');
    expect(gitIn(cloneDir, ['diff', '--cached', '--name-only']).trim()).toBe('src/staged.ts');
  });
});
