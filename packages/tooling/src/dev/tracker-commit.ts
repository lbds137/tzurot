/**
 * Tracker Commit
 *
 * Lands dirty tracker and board files (`tracker/**`, `backlog/**`,
 * `BACKLOG.md`, `CURRENT.md`) on `develop` and pushes them to `origin` from
 * any checkout — whether `develop` is checked out in the current working tree,
 * in a sibling worktree, or in no worktree at all.
 *
 * Checks run in a FIXED order, and the FIRST failure refuses before any write
 * happens — no branch switch, staging, commit, or push runs on a failed
 * check. The commit, push, and (when no worktree held `develop`) branch
 * switch-back steps are guarded separately so each failure reports the exact
 * local state left behind:
 * - a `switch` failure refuses before staging or committing, with the working
 *   tree still on the starting branch;
 * - a `commit` failure resets the commit pathspec (and switches back when
 *   needed) and refuses with the board files still modified and unstaged;
 * - a `push` failure (after switching back when needed) refuses with the
 *   board commit landed on local `develop` and not yet on `origin/develop`;
 * - a `switch-back` failure refuses naming the recorded branch so the
 *   operator knows the checkout remained on `develop`.
 */

import { execFileSync } from 'node:child_process';

import { execErrorOutput } from '../utils/execErrorOutput.js';

/** Bound on local and fetch git shell-outs other than `commit` and `push`. */
export const TRACKER_COMMIT_TIMEOUT_MS = 60_000;

/** Bound on `git commit`, which runs the pre-commit and commit-msg hooks. */
export const TRACKER_COMMIT_COMMIT_TIMEOUT_MS = 120_000;

/** Bound on `git push`, which runs the pre-push hook. */
export const TRACKER_COMMIT_PUSH_TIMEOUT_MS = 600_000;

/** Node's `execFileSync` default `maxBuffer` (1 MiB) is smaller than an ordinary multi-file output. */
export const TRACKER_COMMIT_MAX_BUFFER = 64 * 1024 * 1024;

/**
 * Board roots matching `.claude/hooks/board-commit-branch-gate.sh` for
 * `tracker/**`, `backlog/**`, `BACKLOG.md`, and `CURRENT.md`.
 */
const BOARD_PATH_RE = /^(?:\.\/)?(?:(?:tracker|backlog)(?:\/|$)|(?:BACKLOG|CURRENT)\.md$)/;

const DEVELOP_REF = 'refs/heads/develop';

export type RunGit = (args: string[], cwd?: string) => string;

function timeoutForGitArgs(args: string[]): number {
  if (args[0] === 'push') {
    return TRACKER_COMMIT_PUSH_TIMEOUT_MS;
  }
  if (args[0] === 'commit') {
    return TRACKER_COMMIT_COMMIT_TIMEOUT_MS;
  }
  return TRACKER_COMMIT_TIMEOUT_MS;
}

function defaultRunGit(args: string[], cwd?: string): string {
  return execFileSync('git', args, {
    encoding: 'utf-8',
    timeout: timeoutForGitArgs(args),
    maxBuffer: TRACKER_COMMIT_MAX_BUFFER,
    cwd,
  });
}

function defaultLog(line: string): void {
  console.log(line);
}

export interface TrackerCommitOptions {
  subject: string;
  runGit?: RunGit;
  log?: (line: string) => void;
}

export type TrackerCommitCheckName =
  | 'subject'
  | 'target'
  | 'fresh'
  | 'stranded-board-files'
  | 'mixed-rename'
  | 'nothing-to-commit'
  | 'switch'
  | 'commit'
  | 'push'
  | 'switch-back';

export type TrackerCommitResult =
  { ok: true } | { ok: false; check: TrackerCommitCheckName; reason: string };

function refuse(check: TrackerCommitCheckName, reason: string): TrackerCommitResult {
  return { ok: false, check, reason };
}

/**
 * True when `filePath` is in the board allowlist (`tracker/**`, `backlog/**`,
 * `BACKLOG.md`, `CURRENT.md`).
 * @internal Exported for testing
 */
export function isBoardPath(filePath: string): boolean {
  return BOARD_PATH_RE.test(filePath);
}

/**
 * Parsed entry from `git status --porcelain -z`.
 * @internal Exported for testing
 */
export interface PorcelainZEntry {
  xy: string;
  path: string;
  fromPath?: string;
}

/**
 * Parse `git status --porcelain -z` output into entries with XY status, path,
 * and (for `R` or `C` entries) the source path from the following NUL token.
 * @internal Exported for testing
 */
export function parsePorcelainZEntries(status: string): PorcelainZEntry[] {
  const tokens = status.split('\0').filter(token => token.length > 0);
  const entries: PorcelainZEntry[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] ?? '';
    const xy = token.slice(0, 2);
    const path = token.slice(3);
    if (xy.includes('R') || xy.includes('C')) {
      const fromPath = tokens[i + 1];
      i += 1;
      entries.push(fromPath !== undefined ? { xy, path, fromPath } : { xy, path });
    } else {
      entries.push({ xy, path });
    }
  }
  return entries;
}

/** @internal Exported for testing */
export function buildCommitMessage(subject: string): string {
  return [
    subject,
    '',
    '🤖 Generated with [Claude Code](https://claude.com/claude-code)',
    '',
    'Co-Authored-By: Claude <noreply@anthropic.com>',
  ].join('\n');
}

interface WorktreeEntry {
  path: string;
  branchRef?: string;
}

function parseWorktreeListing(listing: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = [];
  const blocks = listing
    .split('\n\n')
    .map(block => block.split('\n').filter(line => line.length > 0));
  for (const block of blocks) {
    const worktreeLine = block.find(line => line.startsWith('worktree '));
    if (worktreeLine === undefined) continue;
    const branchLine = block.find(line => line.startsWith('branch '));
    entries.push({
      path: worktreeLine.slice('worktree '.length),
      branchRef: branchLine?.slice('branch '.length),
    });
  }
  return entries;
}

type ResolvedTarget =
  | { kind: 'current'; currentRoot: string; targetCwd: string; recordedBranch: undefined }
  | { kind: 'other'; currentRoot: string; targetCwd: string; recordedBranch: undefined }
  | { kind: 'switch'; currentRoot: string; targetCwd: string; recordedBranch: string };

function resolveTarget(runGit: RunGit): ResolvedTarget | TrackerCommitResult {
  let currentRoot: string;
  let listing: string;
  try {
    currentRoot = runGit(['rev-parse', '--show-toplevel']).trim();
    listing = runGit(['worktree', 'list', '--porcelain'], currentRoot);
  } catch (error) {
    return refuse('target', `target: git command failed: ${execErrorOutput(error)}`);
  }

  const entries = parseWorktreeListing(listing);
  const currentEntry = entries.find(entry => entry.path === currentRoot);
  if (currentEntry === undefined) {
    return refuse('target', `current checkout ${currentRoot} was not found in git worktree list`);
  }

  const developEntry = entries.find(entry => entry.branchRef === DEVELOP_REF);
  if (developEntry !== undefined) {
    if (developEntry.path === currentRoot) {
      return { kind: 'current', currentRoot, targetCwd: currentRoot, recordedBranch: undefined };
    }
    return {
      kind: 'other',
      currentRoot,
      targetCwd: developEntry.path,
      recordedBranch: undefined,
    };
  }

  const branchPrefix = 'refs/heads/';
  const recordedBranch =
    currentEntry.branchRef?.startsWith(branchPrefix) === true
      ? currentEntry.branchRef.slice(branchPrefix.length)
      : '';
  if (recordedBranch.length === 0) {
    return refuse(
      'target',
      'no checkout holds develop and the current checkout is on a detached HEAD'
    );
  }

  return { kind: 'switch', currentRoot, targetCwd: currentRoot, recordedBranch };
}

function checkFresh(runGit: RunGit, targetCwd: string): TrackerCommitResult | null {
  try {
    runGit(['fetch', 'origin', 'develop'], targetCwd);
  } catch (error) {
    return refuse('fresh', `git fetch origin develop failed: ${execErrorOutput(error)}`);
  }

  try {
    runGit(['rev-parse', '--verify', '--quiet', DEVELOP_REF], targetCwd);
  } catch {
    return refuse(
      'fresh',
      'local develop ref (refs/heads/develop) does not exist; create or check out develop first'
    );
  }

  try {
    runGit(['merge-base', '--is-ancestor', 'origin/develop', 'develop'], targetCwd);
  } catch (error) {
    return refuse(
      'fresh',
      `local develop is behind or diverged from origin/develop: ${execErrorOutput(error)}`
    );
  }

  let aheadRaw: string;
  try {
    aheadRaw = runGit(['rev-list', '--count', 'origin/develop..develop'], targetCwd);
  } catch (error) {
    return refuse(
      'fresh',
      `git rev-list --count origin/develop..develop failed: ${execErrorOutput(error)}`
    );
  }

  const aheadCount = Number.parseInt(aheadRaw.trim(), 10);
  if (aheadCount > 0) {
    const noun = aheadCount === 1 ? 'commit' : 'commits';
    return refuse(
      'fresh',
      `local develop is ahead of origin/develop by ${aheadCount} ${noun} not yet pushed; push or move them first, since this command pushes develop whole`
    );
  }

  return null;
}

function isBoardEntry(entry: PorcelainZEntry): boolean {
  return isBoardPath(entry.path) || (entry.fromPath !== undefined && isBoardPath(entry.fromPath));
}

function readDirtyBoardEntries(runGit: RunGit, cwd: string): PorcelainZEntry[] {
  const status = runGit(['status', '--porcelain', '-z'], cwd);
  return parsePorcelainZEntries(status).filter(isBoardEntry);
}

interface BoardWritePlan {
  boardPaths: string[];
  addPaths: string[];
  commitPaths: string[];
}

function buildBoardWritePlan(entries: PorcelainZEntry[]): BoardWritePlan {
  const boardPaths = entries.map(entry => entry.path);
  const addPaths = entries.filter(entry => !entry.xy.startsWith('D')).map(entry => entry.path);
  const renameSources = entries.flatMap(entry =>
    entry.fromPath !== undefined ? [entry.fromPath] : []
  );
  return {
    boardPaths,
    addPaths,
    commitPaths: [...boardPaths, ...renameSources],
  };
}

function stageAndCommit(
  runGit: RunGit,
  targetCwd: string,
  plan: BoardWritePlan,
  subject: string
): TrackerCommitResult | null {
  const { addPaths, commitPaths } = plan;
  const message = buildCommitMessage(subject);

  try {
    if (addPaths.length > 0) {
      runGit(['add', '--', ...addPaths], targetCwd);
    }
    // The pathspec keeps a file someone else already staged out of this commit.
    runGit(['commit', '-m', message, '--', ...commitPaths], targetCwd);
    return null;
  } catch (error) {
    let resetNote = 'the board files are still modified and unstaged';
    try {
      runGit(['reset', '-q', '--', ...commitPaths], targetCwd);
    } catch (resetError) {
      resetNote = `git reset also failed (${execErrorOutput(resetError)}); the board files are still modified and may remain staged`;
    }
    return refuse('commit', `git commit failed: ${execErrorOutput(error)}; ${resetNote}`);
  }
}

function executeWriteSequence(
  runGit: RunGit,
  target: ResolvedTarget,
  plan: BoardWritePlan,
  subject: string
): TrackerCommitResult | null {
  const { targetCwd, recordedBranch } = target;

  if (recordedBranch !== undefined) {
    try {
      runGit(['switch', 'develop'], targetCwd);
    } catch (error) {
      return refuse('switch', `git switch develop failed: ${execErrorOutput(error)}`);
    }
  }

  let actionRefusal = stageAndCommit(runGit, targetCwd, plan, subject);

  if (actionRefusal === null) {
    try {
      runGit(['push', 'origin', 'develop'], targetCwd);
    } catch (error) {
      actionRefusal = refuse(
        'push',
        `git push failed: ${execErrorOutput(error)}; the commit is on local develop and not on origin — to recover, go to the checkout holding develop or \`git switch develop\`, run \`git pull --rebase\`, then \`git push\``
      );
    }
  }

  if (recordedBranch !== undefined) {
    try {
      runGit(['switch', recordedBranch], targetCwd);
    } catch (error) {
      const switchReason = `git switch ${recordedBranch} failed: ${execErrorOutput(error)}; the checkout is still on develop instead of ${recordedBranch} (files left dirty may be what a pre-commit hook changed)`;
      if (actionRefusal !== null && !actionRefusal.ok) {
        return refuse(actionRefusal.check, `${actionRefusal.reason}; ${switchReason}`);
      }
      return refuse('switch-back', switchReason);
    }
  }

  return actionRefusal;
}

/**
 * Commit and push dirty board paths to `develop` from any checkout.
 */
export function trackerCommit(opts: TrackerCommitOptions): TrackerCommitResult {
  const runGit = opts.runGit ?? defaultRunGit;
  const log = opts.log ?? defaultLog;

  const subject = opts.subject.trim();
  if (subject.length === 0) {
    return refuse('subject', 'commit subject must not be empty');
  }

  const target = resolveTarget(runGit);
  if ('ok' in target) {
    return target;
  }

  const freshRefusal = checkFresh(runGit, target.targetCwd);
  if (freshRefusal !== null) {
    return freshRefusal;
  }

  if (target.kind === 'other') {
    let stranded: PorcelainZEntry[];
    try {
      stranded = readDirtyBoardEntries(runGit, target.currentRoot);
    } catch (error) {
      return refuse(
        'stranded-board-files',
        `stranded-board-files: git command failed: ${execErrorOutput(error)}`
      );
    }
    if (stranded.length > 0) {
      return refuse(
        'stranded-board-files',
        `current checkout has dirty board files that would be left behind: ${stranded.map(entry => entry.path).join(', ')}`
      );
    }
  }

  let boardEntries: PorcelainZEntry[];
  try {
    boardEntries = readDirtyBoardEntries(runGit, target.targetCwd);
  } catch (error) {
    return refuse(
      'nothing-to-commit',
      `nothing-to-commit: git command failed: ${execErrorOutput(error)}`
    );
  }

  const mixedRename = boardEntries.find(
    entry => entry.fromPath !== undefined && isBoardPath(entry.path) !== isBoardPath(entry.fromPath)
  );
  if (mixedRename !== undefined) {
    return refuse(
      'mixed-rename',
      `rename crosses board and non-board paths: ${String(mixedRename.fromPath)} -> ${mixedRename.path}`
    );
  }

  if (boardEntries.length === 0) {
    return refuse('nothing-to-commit', 'no dirty board paths found in the target checkout');
  }

  const plan = buildBoardWritePlan(boardEntries);
  const writeRefusal = executeWriteSequence(runGit, target, plan, subject);
  if (writeRefusal !== null) {
    return writeRefusal;
  }

  log(
    `committed and pushed ${plan.boardPaths.length} board file(s) to develop: ${plan.boardPaths.join(', ')}`
  );
  return { ok: true };
}
