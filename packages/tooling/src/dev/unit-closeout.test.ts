import { describe, it, expect, vi } from 'vitest';

// Every other test injects `runGit`/`runPnpm`, so this mock is reached only
// by the default-path test below — the one case exercising real `execFileSync`.
vi.mock('node:child_process', () => ({ execFileSync: vi.fn(() => '') }));

import { execFileSync } from 'node:child_process';
import {
  unitCloseout,
  normalizeTaskId,
  UNIT_CLOSEOUT_TIMEOUT_MS,
  UNIT_CLOSEOUT_MAX_BUFFER,
} from './unit-closeout.js';
import { parseTaskFile, type TrackerLoadResult, type TrackerTask } from './trackerTasks.js';

const FOLDED_TASK_TITLE =
  'Mechanize the worktree transfer and the unit close-out as ops commands (doc-99 lever 1)';

function taskLoadResult(overrides: Partial<TrackerTask> = {}): TrackerLoadResult {
  const task: TrackerTask = {
    id: 'TASK-934',
    title: FOLDED_TASK_TITLE,
    status: 'To Do',
    createdDate: '2026-09-01',
    labels: [],
    priority: '',
    body: '\n## Description\n',
    file: 'tracker/tasks/task-934 - Title.md',
    ...overrides,
  };
  return { tasks: [task], problems: [] };
}

function gitStub(handlers: Record<string, (args: string[]) => string>) {
  return vi.fn((args: string[]) => {
    // `commit -m <message>` carries a variable, multi-line message — matched
    // by shape rather than by an exact joined-args key.
    if (args[0] === 'commit') return '';
    const handler = handlers[args.join(' ')];
    if (handler === undefined) throw new Error(`unexpected git ${args.join(' ')}`);
    return handler(args);
  });
}

/** The sha `happyOptions` resolves by default; tests that check the abbreviated form pass their own. */
const DEFAULT_SHA = 'abc';

function happyOptions(overrides: Partial<Record<string, string>> = {}, sha = DEFAULT_SHA) {
  const handlers: Record<string, string> = {
    'branch --show-current': 'develop\n',
    'status --porcelain': '',
    'pull --ff-only origin develop': 'Already up to date.\n',
    [`rev-parse --verify ${sha}^{commit}`]: `${sha}\n`,
    [`merge-base --is-ancestor ${sha} HEAD`]: '',
    'status --porcelain -z': 'M  tracker/tasks/task-934 - Title.md\0',
    'add -A -- tracker/tasks': '',
    'push origin develop': '',
  };
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) handlers[key] = value;
  }
  const runGit = gitStub(
    Object.fromEntries(Object.entries(handlers).map(([k, v]) => [k, () => v]))
  );
  const runPnpm = vi.fn(() => '');
  const log = vi.fn();
  const now = () => new Date(2026, 8, 11); // September 11, 2026 (local)
  const loadTasks = vi.fn(() => taskLoadResult());
  return { runGit, runPnpm, log, now, loadTasks, sha };
}

describe('unitCloseout happy path', () => {
  it('runs the exact call sequence, builds the commit, and prints the lines', () => {
    const sha = '6bbfaeaa1faa683b91a6249095aa3ebe96bed0b7';
    const { runGit, runPnpm, log, now, loadTasks } = happyOptions({}, sha);

    const result = unitCloseout({
      taskId: 'TASK-934',
      pr: 2400,
      sha,
      runGit,
      runPnpm,
      log,
      now,
      loadTasks,
    });

    expect(result.ok).toBe(true);
    expect(runPnpm).toHaveBeenCalledWith(['tracker', 'task', 'edit', '934', '-s', 'Done']);

    const gitCalls = runGit.mock.calls.map(([args]) => args.join(' '));
    expect(gitCalls).toEqual([
      'branch --show-current',
      'status --porcelain',
      'pull --ff-only origin develop',
      `rev-parse --verify ${sha}^{commit}`,
      `merge-base --is-ancestor ${sha} HEAD`,
      'status --porcelain -z',
      'add -A -- tracker/tasks',
      expect.stringMatching(/^commit -m /),
      'push origin develop',
    ]);

    // The title is resolved BEFORE the tracker task is edited to Done, so a
    // task-title refusal never leaves a local modification behind.
    const loadTasksOrder = loadTasks.mock.invocationCallOrder[0];
    const runPnpmOrder = runPnpm.mock.invocationCallOrder[0];
    expect(loadTasksOrder).toBeDefined();
    expect(runPnpmOrder).toBeDefined();
    expect(loadTasksOrder as number).toBeLessThan(runPnpmOrder as number);

    const commitCall = runGit.mock.calls[7]?.[0] as string[];
    expect(commitCall[0]).toBe('commit');
    expect(commitCall[1]).toBe('-m');
    const message = commitCall[2] ?? '';
    const header = message.split('\n')[0] ?? '';
    expect(header.length).toBeLessThan(100);
    expect(header[0]).toBe(header[0]?.toLowerCase());
    expect(header.startsWith('TASK-')).toBe(false);
    expect(header).toBe('docs(backlog): close task 934, merged as #2400');
    expect(message).toContain(
      'Mechanize the worktree transfer and the unit close-out as ops commands (doc-99 lever 1)'
    );
    expect(message).toContain('Merged as #2400 (6bbfaea).');
    expect(message).toContain('Co-Authored-By: Claude <noreply@anthropic.com>');

    expect(log).toHaveBeenCalledWith('~~**TASK-934**~~ DONE 2026-09-11 as #2400');
    expect(log).toHaveBeenCalledWith(
      '#2400 (TASK-934: Mechanize the worktree transfer and the unit close-out as ops commands (doc-99 lever 1))'
    );
    expect(log).toHaveBeenCalledWith('Reminder: CURRENT.md may want a line noting this closeout.');
  });

  it('normalizes a bare numeric id the same way', () => {
    const sha = 'abcdef0123456789';
    const { runGit, runPnpm, log, now, loadTasks } = happyOptions({}, sha);
    const result = unitCloseout({
      taskId: '934',
      pr: 1,
      sha,
      runGit,
      runPnpm,
      log,
      now,
      loadTasks,
    });
    expect(result.ok).toBe(true);
    expect(runPnpm).toHaveBeenCalledWith(['tracker', 'task', 'edit', '934', '-s', 'Done']);
  });
});

describe('unitCloseout refusals', () => {
  it('refuses off develop', () => {
    const { runGit, runPnpm, log, now, loadTasks, sha } = happyOptions({
      'branch --show-current': 'feat/thing\n',
    });
    const result = unitCloseout({
      taskId: '934',
      pr: 1,
      sha,
      runGit,
      runPnpm,
      log,
      now,
      loadTasks,
    });
    expect(result).toEqual({
      ok: false,
      check: 'on-develop-clean',
      reason: 'not on develop (current branch: "feat/thing")',
    });
    expect(runPnpm).not.toHaveBeenCalled();
  });

  it('refuses on a dirty tree', () => {
    const { runGit, runPnpm, log, now, loadTasks, sha } = happyOptions({
      'status --porcelain': ' M dirty.ts\n',
    });
    const result = unitCloseout({
      taskId: '934',
      pr: 1,
      sha,
      runGit,
      runPnpm,
      log,
      now,
      loadTasks,
    });
    expect(result).toEqual({
      ok: false,
      check: 'on-develop-clean',
      reason: 'the working tree has uncommitted changes',
    });
    expect(runPnpm).not.toHaveBeenCalled();
  });

  it('turns a thrown git error inside on-develop-clean into that check refusal', () => {
    const runGit = vi.fn((args: string[]) => {
      if (args.join(' ') === 'branch --show-current') {
        throw new Error('fatal: not a git repository');
      }
      throw new Error(`unexpected git ${args.join(' ')}`);
    });
    const runPnpm = vi.fn(() => '');
    const result = unitCloseout({
      taskId: '934',
      pr: 1,
      sha: DEFAULT_SHA,
      runGit,
      runPnpm,
      log: vi.fn(),
      now: () => new Date(2026, 8, 11),
      loadTasks: vi.fn(() => taskLoadResult()),
    });
    expect(result).toMatchObject({ ok: false, check: 'on-develop-clean' });
    expect(result.ok === false && result.reason).toContain('fatal: not a git repository');
    expect(runPnpm).not.toHaveBeenCalled();
  });

  it('refuses when git pull --ff-only fails and never calls the tracker CLI', () => {
    const { runGit: baseRunGit, log, now, loadTasks, sha } = happyOptions();
    const runGit = vi.fn((args: string[]) => {
      if (args.join(' ') === 'pull --ff-only origin develop') {
        const error = new Error('Command failed') as Error & { stderr?: string };
        error.stderr = 'fatal: Not possible to fast-forward, aborting.\n';
        throw error;
      }
      return (baseRunGit as unknown as (args: string[]) => string)(args);
    });
    const runPnpm = vi.fn(() => '');
    const result = unitCloseout({
      taskId: '934',
      pr: 1,
      sha,
      runGit,
      runPnpm,
      log,
      now,
      loadTasks,
    });
    expect(result).toMatchObject({ check: 'fresh' });
    expect(result.ok === false && result.reason).toContain(
      'Not possible to fast-forward, aborting.'
    );
    expect(runPnpm).not.toHaveBeenCalled();
  });

  it('refuses with sha when --sha does not resolve, before the tracker CLI runs', () => {
    const { runGit: baseRunGit, log, now, loadTasks } = happyOptions();
    const runGit = vi.fn((args: string[]) => {
      if (args.join(' ') === 'rev-parse --verify deadbeef^{commit}') {
        throw new Error('fatal: Needed a single revision');
      }
      return (baseRunGit as unknown as (args: string[]) => string)(args);
    });
    const runPnpm = vi.fn(() => '');
    const result = unitCloseout({
      taskId: '934',
      pr: 1,
      sha: 'deadbeef',
      runGit,
      runPnpm,
      log,
      now,
      loadTasks,
    });
    expect(result).toEqual({
      ok: false,
      check: 'sha',
      reason: '--sha deadbeef does not resolve to a commit',
    });
    expect(runPnpm).not.toHaveBeenCalled();
    const gitCalls = runGit.mock.calls.map(([args]) => args.join(' '));
    expect(gitCalls.some(c => c.startsWith('merge-base'))).toBe(false);
    expect(gitCalls.some(c => c.startsWith('status --porcelain -z'))).toBe(false);
  });

  it('refuses with sha when the resolved sha is not an ancestor of develop, before the tracker CLI runs', () => {
    const sha = '6bbfaeaa1faa683b91a6249095aa3ebe96bed0b7';
    const { runGit: baseRunGit, log, now, loadTasks } = happyOptions({}, sha);
    const runGit = vi.fn((args: string[]) => {
      if (args.join(' ') === `merge-base --is-ancestor ${sha} HEAD`) {
        throw new Error('fatal: Not a valid commit name HEAD');
      }
      return (baseRunGit as unknown as (args: string[]) => string)(args);
    });
    const runPnpm = vi.fn(() => '');
    const result = unitCloseout({
      taskId: '934',
      pr: 1,
      sha,
      runGit,
      runPnpm,
      log,
      now,
      loadTasks,
    });
    expect(result).toEqual({
      ok: false,
      check: 'sha',
      reason: `--sha ${sha} resolves to 6bbfaea but that commit is not on develop`,
    });
    expect(runPnpm).not.toHaveBeenCalled();
    const gitCalls = runGit.mock.calls.map(([args]) => args.join(' '));
    expect(gitCalls.some(c => c.startsWith('status --porcelain -z'))).toBe(false);
  });

  it('refuses when the tracker CLI exits non-zero', () => {
    const { runGit, log, now, loadTasks, sha } = happyOptions();
    const runPnpm = vi.fn(() => {
      const error = new Error('Command failed') as Error & { stderr?: string };
      error.stderr = 'error: task not found: 934\n';
      throw error;
    });
    const result = unitCloseout({
      taskId: '934',
      pr: 1,
      sha,
      runGit,
      runPnpm,
      log,
      now,
      loadTasks,
    });
    expect(result).toMatchObject({ check: 'task-edit' });
    expect(result.ok === false && result.reason).toContain('task not found: 934');
  });

  it('refuses when zero tracker files changed', () => {
    const { runGit, runPnpm, log, now, loadTasks, sha } = happyOptions({
      'status --porcelain -z': '',
    });
    const result = unitCloseout({
      taskId: '934',
      pr: 1,
      sha,
      runGit,
      runPnpm,
      log,
      now,
      loadTasks,
    });
    expect(result).toEqual({
      ok: false,
      check: 'tracker-file-count',
      reason: 'expected exactly one changed file under tracker/tasks, saw 0: ',
    });
  });

  it('refuses when two tracker files changed', () => {
    const { runGit, runPnpm, log, now, loadTasks, sha } = happyOptions({
      'status --porcelain -z':
        'M  tracker/tasks/task-934 - Title.md\0M  tracker/tasks/task-1 - Other.md\0',
    });
    const result = unitCloseout({
      taskId: '934',
      pr: 1,
      sha,
      runGit,
      runPnpm,
      log,
      now,
      loadTasks,
    });
    expect(result).toEqual({
      ok: false,
      check: 'tracker-file-count',
      reason:
        'expected exactly one changed file under tracker/tasks, saw 2: ' +
        'tracker/tasks/task-934 - Title.md, tracker/tasks/task-1 - Other.md',
    });
  });

  it('refuses when the one changed file is outside tracker/tasks/, naming the path', () => {
    const { runGit, runPnpm, log, now, loadTasks, sha } = happyOptions({
      'status --porcelain -z': '?? backlog/now.md\0',
    });
    const result = unitCloseout({
      taskId: '934',
      pr: 1,
      sha,
      runGit,
      runPnpm,
      log,
      now,
      loadTasks,
    });
    expect(result).toEqual({
      ok: false,
      check: 'tracker-file-count',
      reason: 'expected exactly one changed file under tracker/tasks, saw 1: backlog/now.md',
    });
    const gitCalls = runGit.mock.calls.map(([args]) => args.join(' '));
    expect(gitCalls.some(c => c.startsWith('add'))).toBe(false);
    expect(gitCalls.some(c => c.startsWith('commit'))).toBe(false);
  });

  it('counts a rename entry as ONE changed path and still commits', () => {
    const sha = '6bbfaeaa1faa683b91a6249095aa3ebe96bed0b7';
    const { runGit, runPnpm, log, now, loadTasks } = happyOptions(
      {
        'status --porcelain -z': 'R  tracker/tasks/new - Title.md\0tracker/tasks/old - Title.md\0',
      },
      sha
    );
    const result = unitCloseout({
      taskId: '934',
      pr: 1,
      sha,
      runGit,
      runPnpm,
      log,
      now,
      loadTasks,
    });
    expect(result.ok).toBe(true);
    const gitCalls = runGit.mock.calls.map(([args]) => args.join(' '));
    expect(gitCalls.some(c => c.startsWith('commit'))).toBe(true);
  });

  it('turns a thrown git error inside tracker-file-count into that check refusal', () => {
    const { runGit: baseRunGit, runPnpm, log, now, loadTasks, sha } = happyOptions();
    const runGit = vi.fn((args: string[]) => {
      if (args.join(' ') === 'status --porcelain -z') {
        throw new Error('fatal: index file corrupt');
      }
      return (baseRunGit as unknown as (args: string[]) => string)(args);
    });
    const result = unitCloseout({
      taskId: '934',
      pr: 1,
      sha,
      runGit,
      runPnpm,
      log,
      now,
      loadTasks,
    });
    expect(result).toMatchObject({ ok: false, check: 'tracker-file-count' });
    expect(result.ok === false && result.reason).toContain('fatal: index file corrupt');
    expect(runPnpm).toHaveBeenCalled();
  });

  it('refuses with commit when the commit hook rejects, and never pushes', () => {
    const { runGit: baseRunGit, runPnpm, log, now, loadTasks, sha } = happyOptions();
    const runGit = vi.fn((args: string[]) => {
      if (args[0] === 'commit') {
        const error = new Error('Command failed') as Error & { stderr?: string };
        error.stderr = 'husky - pre-commit hook exited with code 1\n';
        throw error;
      }
      return (baseRunGit as unknown as (args: string[]) => string)(args);
    });
    const result = unitCloseout({
      taskId: '934',
      pr: 1,
      sha,
      runGit,
      runPnpm,
      log,
      now,
      loadTasks,
    });
    expect(result).toMatchObject({ check: 'commit' });
    expect(result.ok === false && result.reason).toContain(
      'husky - pre-commit hook exited with code 1'
    );
    expect(result.ok === false && result.reason).toContain(
      'the tracker file is modified locally and not committed'
    );
    const gitCalls = runGit.mock.calls.map(([args]) => args.join(' '));
    expect(gitCalls.some(c => c.startsWith('push'))).toBe(false);
  });

  it('refuses with push when the push fails, after the commit landed locally', () => {
    const { runGit: baseRunGit, runPnpm, log, now, loadTasks, sha } = happyOptions();
    const runGit = vi.fn((args: string[]) => {
      if (args[0] === 'push') {
        const error = new Error('Command failed') as Error & { stderr?: string };
        error.stderr = 'fatal: unable to access remote\n';
        throw error;
      }
      return (baseRunGit as unknown as (args: string[]) => string)(args);
    });
    const result = unitCloseout({
      taskId: '934',
      pr: 1,
      sha,
      runGit,
      runPnpm,
      log,
      now,
      loadTasks,
    });
    expect(result).toMatchObject({ check: 'push' });
    expect(result.ok === false && result.reason).toContain('fatal: unable to access remote');
    expect(result.ok === false && result.reason).toContain('local develop');
    const gitCalls = runGit.mock.calls.map(([args]) => args.join(' '));
    expect(gitCalls.some(c => c.startsWith('commit'))).toBe(true);
  });

  it('refuses on an unrecognized task id shape', () => {
    const { runGit, runPnpm, log, now, loadTasks, sha } = happyOptions();
    const result = unitCloseout({
      taskId: 'not-an-id',
      pr: 1,
      sha,
      runGit,
      runPnpm,
      log,
      now,
      loadTasks,
    });
    expect(result).toMatchObject({ check: 'task-id-format' });
    expect(runGit).not.toHaveBeenCalled();
  });
});

describe('normalizeTaskId', () => {
  it('accepts TASK-934, task-934, and 934', () => {
    expect(normalizeTaskId('TASK-934')).toBe('934');
    expect(normalizeTaskId('task-934')).toBe('934');
    expect(normalizeTaskId('934')).toBe('934');
  });

  it('rejects a non-numeric shape', () => {
    expect(normalizeTaskId('TASK-abc')).toBeNull();
  });
});

describe('task-title refusal', () => {
  it('refuses with task-title when the task is missing from the store, before any tracker mutation', () => {
    const { runGit, runPnpm, log, now, sha } = happyOptions();
    const loadTasks = vi.fn((): TrackerLoadResult => ({ tasks: [], problems: [] }));
    const result = unitCloseout({
      taskId: '934',
      pr: 1,
      sha,
      runGit,
      runPnpm,
      log,
      now,
      loadTasks,
    });
    expect(result).toMatchObject({ check: 'task-title' });
    expect(result.ok === false && result.reason).toContain(
      'no tracker task found with id TASK-934'
    );
    expect(runPnpm).not.toHaveBeenCalled();
    const gitCalls = runGit.mock.calls.map(([args]) => args.join(' '));
    expect(gitCalls.some(c => c.startsWith('add'))).toBe(false);
    expect(gitCalls.some(c => c.startsWith('commit'))).toBe(false);
    expect(gitCalls.some(c => c.startsWith('push'))).toBe(false);
  });

  it('refuses with task-title when loadTasks throws, instead of propagating the exception', () => {
    const { runGit, runPnpm, log, now, sha } = happyOptions();
    const loadTasks = vi.fn((): TrackerLoadResult => {
      throw new Error('tracker/tasks/ not found');
    });
    const result = unitCloseout({
      taskId: '934',
      pr: 1,
      sha,
      runGit,
      runPnpm,
      log,
      now,
      loadTasks,
    });
    expect(result).toMatchObject({ check: 'task-title' });
    expect(result.ok === false && result.reason).toContain('tracker/tasks/ not found');
    expect(runPnpm).not.toHaveBeenCalled();
    const gitCalls = runGit.mock.calls.map(([args]) => args.join(' '));
    expect(gitCalls.some(c => c.startsWith('commit'))).toBe(false);
    expect(gitCalls.some(c => c.startsWith('push'))).toBe(false);
  });

  it('refuses with task-title when the tracker store reports a structural problem for this task, before any tracker mutation', () => {
    const { runGit, runPnpm, log, now, sha } = happyOptions();
    const problemText = 'tracker/tasks/task-934 - Title.md: frontmatter did not parse (task-934 )';
    const loadTasks = vi.fn((): TrackerLoadResult => ({ tasks: [], problems: [problemText] }));
    const result = unitCloseout({
      taskId: '934',
      pr: 1,
      sha,
      runGit,
      runPnpm,
      log,
      now,
      loadTasks,
    });
    expect(result).toMatchObject({ check: 'task-title' });
    expect(result.ok === false && result.reason).toContain(problemText);
    expect(runPnpm).not.toHaveBeenCalled();
    const gitCalls = runGit.mock.calls.map(([args]) => args.join(' '));
    expect(gitCalls.some(c => c.startsWith('add'))).toBe(false);
    expect(gitCalls.some(c => c.startsWith('commit'))).toBe(false);
    expect(gitCalls.some(c => c.startsWith('push'))).toBe(false);
  });

  it('uses a title parsed by the real tracker parser from a double-quoted scalar, verbatim and unquoted', () => {
    const content = `---
id: TASK-42
title: "Fix the flaky retry test"
status: To Do
created_date: '2026-09-01 10:00'
---
`;
    const parsed = parseTaskFile(content, 'tracker/tasks/task-42 - Fix the flaky retry test.md');
    expect(parsed.ok).toBe(true);
    const title = parsed.ok ? parsed.task.title : '';
    expect(title).toBe('Fix the flaky retry test');

    const sha = 'abc1234';
    const { runGit, runPnpm, log, now } = happyOptions(
      {
        'status --porcelain -z': 'M  tracker/tasks/task-42 - Fix the flaky retry test.md\0',
      },
      sha
    );
    const loadTasks = vi.fn((): TrackerLoadResult =>
      taskLoadResult({ id: 'TASK-42', title, file: parsed.ok ? parsed.task.file : '' })
    );
    const result = unitCloseout({
      taskId: '42',
      pr: 5,
      sha,
      runGit,
      runPnpm,
      log,
      now,
      loadTasks,
    });
    expect(result.ok).toBe(true);
    const commitCall = runGit.mock.calls.find(([args]) => args[0] === 'commit')?.[0] as string[];
    const message = commitCall[2] ?? '';
    expect(message).toContain(title);
    expect(message).not.toContain('"');
  });
});

describe('default runners (no injected runGit/runPnpm)', () => {
  it('uses execFileSync with array args and the module timeout', () => {
    vi.mocked(execFileSync).mockClear();
    vi.mocked(execFileSync).mockImplementation(((cmd: string, args: string[]) => {
      if (cmd === 'git' && args[0] === 'branch') return 'feat/other\n'; // refuses before pnpm/pull
      return '';
    }) as unknown as typeof execFileSync);

    unitCloseout({ taskId: '934', pr: 1, sha: 'abc' });

    const calls = vi.mocked(execFileSync).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(Array.isArray(call[1])).toBe(true);
      expect(call[2]).toMatchObject({
        timeout: UNIT_CLOSEOUT_TIMEOUT_MS,
        encoding: 'utf-8',
        maxBuffer: UNIT_CLOSEOUT_MAX_BUFFER,
      });
    }
  });
});
