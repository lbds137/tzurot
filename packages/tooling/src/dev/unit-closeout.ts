/**
 * Unit Close-out
 *
 * Mechanizes the tracker bookkeeping at the end of an implementation unit:
 * close the tracker task, commit and push the ONE resulting tracker file to
 * develop, then print the `now.md`/`CURRENT.md` lines a human still has to
 * place by judgment (title placement and phrasing are not mechanical).
 *
 * Checks run in a FIXED order, and the FIRST failure refuses before any
 * write happens — nothing is committed or pushed on a partial run. The
 * commit and push steps are guarded separately: a commit failure refuses
 * with the tracker file still modified locally, and a push failure refuses
 * with the close-out commit landed on local develop but not on origin.
 */

import { execFileSync } from 'node:child_process';

import { execErrorOutput } from '../utils/execErrorOutput.js';
import { loadTrackerTasks, type TrackerLoadResult } from './trackerTasks.js';

/** Bound on each git/pnpm shell-out this command makes; every call is local. */
export const UNIT_CLOSEOUT_TIMEOUT_MS = 60_000;

/** Node's `execFileSync` default `maxBuffer` (1 MiB) is smaller than an ordinary multi-file `--binary` patch. */
export const UNIT_CLOSEOUT_MAX_BUFFER = 64 * 1024 * 1024;

type RunGit = (args: string[], cwd?: string) => string;
type RunPnpm = (args: string[]) => string;

function defaultRunGit(args: string[], cwd?: string): string {
  return execFileSync('git', args, {
    encoding: 'utf-8',
    timeout: UNIT_CLOSEOUT_TIMEOUT_MS,
    maxBuffer: UNIT_CLOSEOUT_MAX_BUFFER,
    cwd,
  });
}

function defaultRunPnpm(args: string[]): string {
  return execFileSync('pnpm', args, {
    encoding: 'utf-8',
    timeout: UNIT_CLOSEOUT_TIMEOUT_MS,
    maxBuffer: UNIT_CLOSEOUT_MAX_BUFFER,
  });
}

function defaultLog(line: string): void {
  console.log(line);
}

export interface CloseoutOptions {
  /** `934` or `TASK-934`, case-insensitive on the prefix. */
  taskId: string;
  pr: number;
  sha: string;
  runGit?: RunGit;
  runPnpm?: RunPnpm;
  log?: (line: string) => void;
  /** Loads the tracker task store. Injectable for tests; defaults to `loadTrackerTasks`. */
  loadTasks?: (rootDir: string) => TrackerLoadResult;
  /** Clock, injectable so the printed date is deterministic in tests. */
  now?: () => Date;
}

export type CloseoutCheckName =
  | 'task-id-format'
  | 'on-develop-clean'
  | 'fresh'
  | 'sha'
  | 'task-title'
  | 'task-edit'
  | 'tracker-file-count'
  | 'commit'
  | 'push';

export type CloseoutResult =
  { ok: true; lines: string[] } | { ok: false; check: CloseoutCheckName; reason: string };

function refuse(check: CloseoutCheckName, reason: string): CloseoutResult {
  return { ok: false, check, reason };
}

/** Normalize `934` / `TASK-934` / `task-934` to the bare digit string. @internal Exported for testing */
export function normalizeTaskId(raw: string): string | null {
  const match = /^(?:TASK-)?(\d+)$/i.exec(raw.trim());
  return match === null ? null : match[1];
}

/**
 * Look up the tracker task's title via the shared store parser. Runs BEFORE
 * the tracker task is edited to Done, so a load failure, a structural
 * problem for this task, or a missing id refuses with NO tracker file yet
 * modified — unlike the `task-edit`/`commit`/`push` refusals downstream,
 * which each leave a local modification behind.
 */
const TASK_TITLE_CHECK: CloseoutCheckName = 'task-title';

function resolveTaskTitle(
  loadTasks: (rootDir: string) => TrackerLoadResult,
  bareId: string
): { title: string } | CloseoutResult {
  const id = `TASK-${bareId}`;

  let loaded: TrackerLoadResult;
  try {
    loaded = loadTasks(process.cwd());
  } catch (error) {
    return refuse(TASK_TITLE_CHECK, `failed to load tracker tasks: ${execErrorOutput(error)}`);
  }

  const relevantProblems = loaded.problems.filter(problem => problem.includes(`task-${bareId} `));
  if (relevantProblems.length > 0) {
    return refuse(TASK_TITLE_CHECK, relevantProblems.join('; '));
  }

  const task = loaded.tasks.find(t => t.id === id);
  if (task === undefined) {
    return refuse(TASK_TITLE_CHECK, `no tracker task found with id ${id}`);
  }

  return { title: task.title };
}

function formatLocalDate(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function buildCommitMessage(bareId: string, pr: number, title: string, sha7: string): string {
  return [
    `docs(backlog): close task ${bareId}, merged as #${pr}`,
    '',
    title,
    '',
    `Merged as #${pr} (${sha7}).`,
    '',
    '🤖 Generated with [Claude Code](https://claude.com/claude-code)',
    '',
    'Co-Authored-By: Claude <noreply@anthropic.com>',
  ].join('\n');
}

function printCloseoutLines(
  log: (line: string) => void,
  bareId: string,
  pr: number,
  title: string,
  date: Date
): string[] {
  const lines = [
    `~~**TASK-${bareId}**~~ DONE ${formatLocalDate(date)} as #${pr}`,
    `#${pr} (TASK-${bareId}: ${title})`,
    'Reminder: CURRENT.md may want a line noting this closeout.',
  ];
  for (const line of lines) {
    log(line);
  }
  return lines;
}

/**
 * Parse `git status --porcelain -z` output into the list of changed paths.
 * NUL-separated tokens carry no quoting (unlike the non-`-z` form), and a
 * rename/copy entry (status `R`/`C`) is followed by its source path as a
 * separate token, which is consumed and discarded rather than counted.
 * @internal Exported for testing
 */
export function parsePorcelainZPaths(status: string): string[] {
  const tokens = status.split('\0').filter(token => token.length > 0);
  const paths: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const entry = tokens[i] ?? '';
    paths.push(entry.slice(3));
    if (entry.startsWith('R') || entry.startsWith('C')) {
      // A rename/copy entry is followed by its source path as a separate
      // NUL-terminated token; consume it so it isn't double-counted.
      i += 1;
    }
  }
  return paths;
}

const ON_DEVELOP_CLEAN_CHECK: CloseoutCheckName = 'on-develop-clean';

function checkOnDevelopClean(runGit: RunGit): CloseoutResult | null {
  const branch = runGit(['branch', '--show-current']).trim();
  if (branch !== 'develop') {
    return refuse(ON_DEVELOP_CLEAN_CHECK, `not on develop (current branch: "${branch}")`);
  }
  const status = runGit(['status', '--porcelain']);
  if (status.trim().length > 0) {
    return refuse(ON_DEVELOP_CLEAN_CHECK, 'the working tree has uncommitted changes');
  }
  return null;
}

/**
 * Run the full close-out pipeline: normalize the id, verify develop is
 * clean and fresh, close the tracker task, commit and push the single
 * resulting file, then print the lines that still need human placement.
 */
export function unitCloseout(opts: CloseoutOptions): CloseoutResult {
  const runGit = opts.runGit ?? defaultRunGit;
  const runPnpm = opts.runPnpm ?? defaultRunPnpm;
  const log = opts.log ?? defaultLog;
  const loadTasks = opts.loadTasks ?? loadTrackerTasks;
  const now = opts.now ?? ((): Date => new Date());

  const bareId = normalizeTaskId(opts.taskId);
  if (bareId === null) {
    return refuse('task-id-format', `invalid task id: "${opts.taskId}"`);
  }

  let developCheck: CloseoutResult | null;
  try {
    developCheck = checkOnDevelopClean(runGit);
  } catch (error) {
    return refuse(
      ON_DEVELOP_CLEAN_CHECK,
      `${ON_DEVELOP_CLEAN_CHECK}: git command failed: ${execErrorOutput(error)}`
    );
  }
  if (developCheck !== null) {
    return developCheck;
  }

  try {
    runGit(['pull', '--ff-only', 'origin', 'develop']);
  } catch (error) {
    return refuse('fresh', `git pull --ff-only failed: ${execErrorOutput(error)}`);
  }

  let resolvedSha: string;
  try {
    resolvedSha = runGit(['rev-parse', '--verify', `${opts.sha}^{commit}`]).trim();
  } catch {
    return refuse('sha', `--sha ${opts.sha} does not resolve to a commit`);
  }

  try {
    runGit(['merge-base', '--is-ancestor', resolvedSha, 'HEAD']);
  } catch {
    return refuse(
      'sha',
      `--sha ${opts.sha} resolves to ${resolvedSha.slice(0, 7)} but that commit is not on develop`
    );
  }

  const titleResult = resolveTaskTitle(loadTasks, bareId);
  if (!('title' in titleResult)) {
    return titleResult;
  }
  const { title } = titleResult;

  try {
    runPnpm(['tracker', 'task', 'edit', bareId, '-s', 'Done']);
  } catch (error) {
    return refuse('task-edit', `tracker CLI failed: ${execErrorOutput(error)}`);
  }

  let paths: string[];
  try {
    paths = parsePorcelainZPaths(runGit(['status', '--porcelain', '-z']));
  } catch (error) {
    return refuse(
      'tracker-file-count',
      `tracker-file-count: git command failed: ${execErrorOutput(error)}`
    );
  }
  const outsideTracker = paths.filter(p => !p.startsWith('tracker/tasks/'));
  if (paths.length !== 1 || outsideTracker.length > 0) {
    return refuse(
      'tracker-file-count',
      `expected exactly one changed file under tracker/tasks, saw ${paths.length}: ${paths.join(', ')}`
    );
  }

  const message = buildCommitMessage(bareId, opts.pr, title, resolvedSha.slice(0, 7));

  try {
    runGit(['add', '-A', '--', 'tracker/tasks']);
    runGit(['commit', '-m', message]);
  } catch (error) {
    return refuse(
      'commit',
      `git commit failed: ${execErrorOutput(error)}; the tracker file is modified locally and not committed`
    );
  }

  try {
    runGit(['push', 'origin', 'develop']);
  } catch (error) {
    return refuse(
      'push',
      `git push failed: ${execErrorOutput(error)}; the close-out commit is on local develop and NOT on origin — push it by hand or pull --ff-only and retry`
    );
  }

  const lines = printCloseoutLines(log, bareId, opts.pr, title, now());
  return { ok: true, lines };
}
