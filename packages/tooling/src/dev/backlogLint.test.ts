import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import {
  ALLOW_ORIGIN_ID_COLLISION_ENV,
  checkArchiveIdConflicts,
  checkDuplicateTaskIds,
  checkOriginIdCollisions,
  checkTaskTriage,
  extractQueueDocRefs,
  parseSectionCaps,
  runBacklogLint,
  type OriginTaskListing,
} from './backlogLint.js';
import type { TrackerTask } from './trackerTasks.js';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  readdirSync: vi.fn(),
}));

// The runBacklogLint suite's beforeEach sets a clean-tree default (''); tests
// that exercise the warning path override it with their own porcelain output.
vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

describe('parseSectionCaps', () => {
  it('counts top-level items per capped section and ignores uncapped headings', () => {
    const md = [
      '### 🚨 Production Issues',
      '- one prod bug',
      '### 🎯 Current Focus (max 3)',
      '1. epic item',
      '2. another',
      '### ⚡ Quick Wins (max 5)',
      '- a',
      '- b',
      '- c',
    ].join('\n');

    const caps = parseSectionCaps(md);
    // Production Issues has no (max N) → not tracked
    expect(caps.map(c => c.section)).toEqual(['🎯 Current Focus (max 3)', '⚡ Quick Wins (max 5)']);
    expect(caps[0]).toMatchObject({ cap: 3, count: 2 });
    expect(caps[1]).toMatchObject({ cap: 5, count: 3 });
  });

  it('does not count indented sub-bullets or prose lines', () => {
    const md = [
      '### 📥 Untriaged (max 10)',
      '_intro prose, not an item_',
      '- real item',
      '  - indented sub-bullet (not counted)',
    ].join('\n');
    const [cap] = parseSectionCaps(md);
    expect(cap).toMatchObject({ cap: 10, count: 1 });
  });
});

describe('extractQueueDocRefs', () => {
  it('pulls every backticked doc-N reference out of queue markdown', () => {
    const md = [
      '- **Foo** (`doc-1`) — summary',
      '- **Baz** (`doc-27`) — summary',
      '- **PR-2n** → see [../active-epic.md](../active-epic.md)',
      'prose mentioning doc-99 without backticks is not a reference',
    ].join('\n');
    expect(extractQueueDocRefs(md)).toEqual(['doc-1', 'doc-27']);
  });
});

// Fully triaged: the lint gates on area + size + state + priority, so a fixture
// standing in for "a healthy store" has to carry all four.
const VALID_TASK = [
  '---',
  'id: TASK-1',
  "title: 'A valid task'",
  'status: To Do',
  "created_date: '2026-05-16 00:00'",
  'labels:',
  "  - 'area:db'",
  "  - 'size:S'",
  "  - 'state:ready'",
  'priority: medium',
  '---',
  '',
  'Body.',
].join('\n');

function task(overrides: Partial<TrackerTask> = {}): TrackerTask {
  return {
    id: 'TASK-1',
    title: 'A task',
    status: 'To Do',
    createdDate: '2026-05-16',
    labels: ['area:db', 'size:S', 'state:ready'],
    priority: 'medium',
    body: '',
    file: 'tracker/tasks/task-1 - a-task.md',
    ...overrides,
  };
}

describe('checkDuplicateTaskIds', () => {
  it('passes a tree where every id appears once', () => {
    expect(
      checkDuplicateTaskIds([
        task(),
        task({ id: 'TASK-2', file: 'tracker/tasks/task-2 - other.md' }),
      ])
    ).toEqual([]);
  });

  it('flags two files carrying the same id, naming both', () => {
    // The post-merge union shape: each file parses cleanly on its own branch,
    // and only the merged tree has the ambiguity.
    const [problem] = checkDuplicateTaskIds([
      task({ id: 'TASK-451', file: 'tracker/tasks/task-451 - one.md' }),
      task({ id: 'TASK-451', file: 'tracker/tasks/task-451 - two.md' }),
    ]);

    expect(problem).toContain('duplicate task id TASK-451');
    expect(problem).toContain('task-451 - one.md');
    expect(problem).toContain('task-451 - two.md');
  });
});

describe('checkOriginIdCollisions', () => {
  const resolvable = (files: string[]): OriginTaskListing => ({ resolvable: true, files });

  it('flags a NEW local file reusing an id origin already has under another name', () => {
    const problems = checkOriginIdCollisions(
      [task({ id: 'TASK-451', file: 'tracker/tasks/task-451 - filed-here.md' })],
      resolvable(['tracker/tasks/task-451 - filed-on-develop.md'])
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('id TASK-451 is already used on origin/develop');
    expect(problems[0]).toContain('task-451 - filed-on-develop.md');
  });

  it('passes a file that already exists on origin under the same path', () => {
    expect(
      checkOriginIdCollisions(
        [task({ id: 'TASK-451', file: 'tracker/tasks/task-451 - same.md' })],
        resolvable(['tracker/tasks/task-451 - same.md'])
      )
    ).toEqual([]);
  });

  it('passes a new file whose id origin does not carry', () => {
    expect(
      checkOriginIdCollisions(
        [task({ id: 'TASK-452', file: 'tracker/tasks/task-452 - new.md' })],
        resolvable(['tracker/tasks/task-451 - old.md'])
      )
    ).toEqual([]);
  });

  it('skips entirely when origin/develop is not resolvable', () => {
    // Fail-open: a CI shallow clone legitimately lacks the ref, and the
    // in-tree duplicate check still covers the merged case.
    expect(
      checkOriginIdCollisions(
        [task({ id: 'TASK-451', file: 'tracker/tasks/task-451 - filed-here.md' })],
        { resolvable: false, files: [] }
      )
    ).toEqual([]);
  });

  it('matches a title-less origin filename (task-N.md, no separator) by its id', () => {
    // fileIdToken strips the .md so `task-451.md` yields `task-451`, not
    // `task-451.md` — otherwise a real collision against a title-less origin
    // file would silently go undetected.
    const problems = checkOriginIdCollisions(
      [task({ id: 'TASK-451', file: 'tracker/tasks/task-451 - filed-here.md' })],
      resolvable(['tracker/tasks/task-451.md'])
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('task-451.md');
  });

  it('names every origin file when origin/develop itself carries a duplicate id', () => {
    // A pre-existing upstream dup is invisible to checkDuplicateTaskIds (local
    // tree only); the message must not understate it to a single file.
    const problems = checkOriginIdCollisions(
      [task({ id: 'TASK-451', file: 'tracker/tasks/task-451 - filed-here.md' })],
      resolvable([
        'tracker/tasks/task-451 - one-on-develop.md',
        'tracker/tasks/task-451 - two-on-develop.md',
      ])
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('one-on-develop.md');
    expect(problems[0]).toContain('two-on-develop.md');
  });
});

describe('checkTaskTriage', () => {
  it('passes a fully triaged open task', () => {
    expect(checkTaskTriage([task()])).toEqual([]);
  });

  it('flags an open task with no size label', () => {
    const [problem] = checkTaskTriage([task({ labels: ['area:db', 'state:ready'] })]);
    expect(problem).toBe(
      'tracker/tasks/task-1 - a-task.md: open task has no size label (size:S | size:M | size:L)'
    );
  });

  it('flags an open task carrying more than one size label', () => {
    const [problem] = checkTaskTriage([
      task({ labels: ['area:db', 'size:S', 'size:L', 'state:ready'] }),
    ]);
    expect(problem).toBe(
      'tracker/tasks/task-1 - a-task.md: open task has 2 size labels — exactly one is required'
    );
  });

  it('flags an open task with no area label', () => {
    const [problem] = checkTaskTriage([task({ labels: ['size:M', 'state:ready'] })]);
    expect(problem).toBe(
      'tracker/tasks/task-1 - a-task.md: open task has no area label (area:<package-or-domain>)'
    );
  });

  it('flags an open task whose priority is absent or off the allowed set', () => {
    expect(checkTaskTriage([task({ priority: '' })])).toEqual([
      "tracker/tasks/task-1 - a-task.md: open task has priority '' — must be high | medium | low",
    ]);
    expect(checkTaskTriage([task({ priority: 'urgent' })])).toEqual([
      "tracker/tasks/task-1 - a-task.md: open task has priority 'urgent' — must be high | medium | low",
    ]);
  });

  it('exempts Done tasks entirely — finished work awaiting archive', () => {
    expect(checkTaskTriage([task({ status: 'Done', labels: [], priority: '' })])).toEqual([]);
  });

  it('flags an open task with no state label', () => {
    const [problem] = checkTaskTriage([task({ labels: ['area:db', 'size:S'] })]);
    expect(problem).toBe(
      'tracker/tasks/task-1 - a-task.md: open task has no state label ' +
        '(state:ready | state:observable | state:dependent | state:owner | state:unreachable)'
    );
  });

  it('flags an open task carrying more than one state label', () => {
    const [problem] = checkTaskTriage([
      task({ labels: ['area:db', 'size:S', 'state:ready', 'state:owner'] }),
    ]);
    expect(problem).toBe(
      'tracker/tasks/task-1 - a-task.md: open task has 2 state labels — exactly one is required'
    );
  });

  it('accepts every state in the vocabulary', () => {
    for (const state of ['ready', 'observable', 'dependent', 'owner', 'unreachable']) {
      expect(
        checkTaskTriage([task({ labels: ['area:db', 'size:S', `state:${state}`] })]),
        `state:${state} should be accepted`
      ).toEqual([]);
    }
  });

  it('names an out-of-vocabulary state and does NOT also call it missing', () => {
    // Presence is measured on the `state:` PREFIX, validity on the vocabulary.
    // Measuring presence on the vocabulary reports 'state:blocked' as "no state
    // label" — sending the reader to add a label already sitting there, and
    // (alongside the unknown message) claiming it is absent and present at once.
    const problems = checkTaskTriage([task({ labels: ['area:db', 'size:S', 'state:blocked'] })]);
    expect(problems).toEqual([
      "tracker/tasks/task-1 - a-task.md: open task has unknown state label 'state:blocked' — " +
        'must be one of state:ready | state:observable | state:dependent | state:owner | state:unreachable',
    ]);
  });

  it('names an out-of-vocabulary size the same way — the axes share one rule', () => {
    // `size:XL` had the identical defect before the axes were unified: it failed
    // the size pattern, so a label that was present reported as absent.
    const problems = checkTaskTriage([task({ labels: ['area:db', 'size:XL', 'state:ready'] })]);
    expect(problems).toEqual([
      "tracker/tasks/task-1 - a-task.md: open task has unknown size label 'size:XL' — " +
        'must be one of size:S | size:M | size:L',
    ]);
  });

  it('still flags a duplicate valid label when an unknown one sits beside it', () => {
    const problems = checkTaskTriage([
      task({ labels: ['area:db', 'size:S', 'state:ready', 'state:owner', 'state:blocked'] }),
    ]);
    expect(problems.join('\n')).toContain("unknown state label 'state:blocked'");
    expect(problems.join('\n')).toContain('has 2 state labels — exactly one is required');
    expect(problems.join('\n')).not.toContain('no state label');
  });

  it('reports every problem on a single task, not just the first', () => {
    const problems = checkTaskTriage([task({ labels: [], priority: '' })]);
    expect(problems).toHaveLength(4);
    expect(problems.join('\n')).toContain('no size label');
    expect(problems.join('\n')).toContain('no state label');
    expect(problems.join('\n')).toContain('no area label');
    expect(problems.join('\n')).toContain('must be high | medium | low');
  });
});

describe('checkArchiveIdConflicts', () => {
  it('passes when the two directories are disjoint', () => {
    expect(checkArchiveIdConflicts(['task-10 - live.md'], ['task-9 - archived.md'])).toEqual([]);
  });

  it('flags a task present in both directories, naming the id and both paths', () => {
    const [problem] = checkArchiveIdConflicts(
      ['task-544 - Some-task.md'],
      ['task-544 - Some-task.md']
    );
    expect(problem).toContain('task-544 is BOTH live and archived');
    expect(problem).toContain('tracker/tasks/task-544 - Some-task.md');
    expect(problem).toContain('tracker/archive/tasks/task-544 - Some-task.md');
  });

  it('catches the overlap when the two copies were renamed apart', () => {
    // Comparing full filenames would miss this: the archive move and a later
    // title edit leave the same id under two different names, and the live copy
    // still answers every open-pool query.
    const [problem] = checkArchiveIdConflicts(
      ['task-544 - Renamed-after-the-move.md'],
      ['task-544 - Original-title.md']
    );
    expect(problem).toContain('task-544 is BOTH live and archived');
  });

  it('reports every overlapping id, not just the first', () => {
    const problems = checkArchiveIdConflicts(
      ['task-1 - a.md', 'task-2 - b.md', 'task-3 - c.md'],
      ['task-1 - a.md', 'task-3 - c.md']
    );
    expect(problems).toHaveLength(2);
    expect(problems.join('\n')).toContain('task-1 is BOTH');
    expect(problems.join('\n')).toContain('task-3 is BOTH');
    expect(problems.join('\n')).not.toContain('task-2');
  });

  it('is empty when the archive is empty — the ordinary state', () => {
    expect(checkArchiveIdConflicts(['task-1 - a.md'], [])).toEqual([]);
  });

  it('flags two files sharing an id INSIDE the archive, naming every copy', () => {
    // Same failure shape one directory over: each file looks correct alone, and
    // a last-writer-wins map would compare one and report neither.
    const problems = checkArchiveIdConflicts([], ['task-7 - original.md', 'task-7 - a-copy.md']);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('task-7 appears 2 times');
    expect(problems[0]).toContain('task-7 - original.md');
    expect(problems[0]).toContain('task-7 - a-copy.md');
  });

  it('names every archived copy when a live file collides with duplicated ones', () => {
    const [, liveProblem] = checkArchiveIdConflicts(
      ['task-7 - live.md'],
      ['task-7 - one.md', 'task-7 - two.md']
    );
    // FULL paths, asserted with their directory prefix — a bare-filename
    // assertion passes whether or not the second copy is prefixed, which is
    // exactly how the missing prefix survived into review.
    expect(liveProblem).toContain('tracker/archive/tasks/task-7 - one.md');
    expect(liveProblem).toContain('tracker/archive/tasks/task-7 - two.md');
    expect(liveProblem).toContain('tracker/tasks/task-7 - live.md');
  });
});

describe('runBacklogLint', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  /**
   * A resolvable origin/develop with no task files on it. Injected so the suite
   * never shells out to git: the default path reads the real repo, which would
   * make these results depend on whatever the checkout's origin happens to
   * carry. The id-collision cases below inject their own listings.
   */
  const NO_ORIGIN_FILES: OriginTaskListing = { resolvable: true, files: [] };

  beforeEach(() => {
    vi.resetAllMocks();
    // Clean tracker tree unless a test says otherwise — `resetAllMocks` drops
    // the implementation, so this has to be re-set every time.
    vi.mocked(execFileSync).mockReturnValue('');
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    process.exitCode = undefined;
  });

  afterEach(() => {
    logSpy.mockRestore();
    process.exitCode = undefined;
  });

  /**
   * Directory listings for the recursive `backlog/` walk, keyed by
   * repo-relative directory. Empty by default, which makes `existsSync` report
   * `backlog/` as absent so the walk skips it — that is what keeps every test
   * predating the backlog scan unaffected.
   */
  type DirTree = Record<string, Array<{ name: string; dir?: boolean }>>;

  function mockFs(
    files: Record<string, string>,
    docFiles: string[],
    trackerFiles: Record<string, string> = { 'task-1 - valid.md': VALID_TASK },
    docContents: Record<string, string> = {},
    backlogTree: DirTree = {}
  ): void {
    vi.mocked(existsSync).mockImplementation(p => {
      const path = String(p);
      if (path.endsWith('tracker/docs') || path.endsWith('tracker/tasks')) {
        return true;
      }
      if (Object.keys(backlogTree).some(d => path.endsWith(d))) {
        return true;
      }
      return Object.keys(files).some(suffix => path.endsWith(suffix));
    });
    vi.mocked(readFileSync).mockImplementation(p => {
      const path = String(p);
      const tracker = Object.entries(trackerFiles).find(([name]) => path.endsWith(name));
      if (tracker) {
        return tracker[1];
      }
      const doc = Object.entries(docContents).find(([name]) => path.endsWith(name));
      if (doc) {
        return doc[1];
      }
      const hit = Object.entries(files).find(([suffix]) => path.endsWith(suffix));
      return hit ? hit[1] : '';
    });
    vi.mocked(readdirSync).mockImplementation(((p: unknown, options?: unknown) => {
      const path = String(p);
      const treeKey = Object.keys(backlogTree).find(d => path.endsWith(d));
      const entries: Array<{ name: string; dir?: boolean }> =
        treeKey !== undefined
          ? backlogTree[treeKey]
          : (path.endsWith('tracker/tasks') ? Object.keys(trackerFiles) : docFiles).map(name => ({
              name,
            }));
      const wantsFileTypes =
        typeof options === 'object' &&
        options !== null &&
        (options as { withFileTypes?: boolean }).withFileTypes === true;
      if (wantsFileTypes) {
        return entries.map(e => ({
          name: e.name,
          isDirectory: () => e.dir === true,
        })) as unknown as ReturnType<typeof readdirSync>;
      }
      return entries.map(e => e.name) as unknown as ReturnType<typeof readdirSync>;
    }) as unknown as typeof readdirSync);
  }

  it('passes clean when caps respected, doc refs resolve, and tasks parse', async () => {
    mockFs(
      {
        'backlog/now.md': '### 🎯 Current Focus (max 3)\n1. a\n2. b\n',
        'backlog/cold/queue.md': '- **Foo** (`doc-1`)\n',
      },
      ['doc-1 - Foo.md']
    );

    await runBacklogLint({ rootDir: '/repo', origin: NO_ORIGIN_FILES });

    const out = logSpy.mock.calls.flat().join('\n');
    expect(out).toContain('Backlog layout in sync');
    expect(process.exitCode).not.toBe(1);
  });

  it('warns on an uncommitted tracker file but does not set a non-zero exit code', async () => {
    mockFs(
      {
        'backlog/now.md': '### 🎯 Current Focus (max 3)\n1. a\n2. b\n',
        'backlog/cold/queue.md': '- **Foo** (`doc-1`)\n',
      },
      ['doc-1 - Foo.md']
    );
    // NUL-terminated: readTrackerGitStatus passes `-z` (see trackerGitStatus.ts).
    vi.mocked(execFileSync).mockReturnValue('?? tracker/tasks/task-537 - new.md\0');

    await runBacklogLint({ rootDir: '/repo', origin: NO_ORIGIN_FILES });

    const out = logSpy.mock.calls.flat().join('\n');
    expect(out).toContain('Backlog layout in sync');
    expect(out).toContain('Uncommitted tracker files');
    expect(out).toContain('tracker/tasks/task-537 - new.md (untracked)');
    expect(process.exitCode).not.toBe(1);
  });

  it('prints nothing extra and stays exit-neutral when the git read fails', async () => {
    // The documented contract at the seam that matters — the CLI's own output,
    // not readTrackerGitStatus in isolation. In CI the tracker tree is clean
    // and an unresolvable git call is uninteresting, so silence is correct.
    mockFs(
      {
        'backlog/now.md': '### 🎯 Current Focus (max 3)\n1. a\n2. b\n',
        'backlog/cold/queue.md': '- **Foo** (`doc-1`)\n',
      },
      ['doc-1 - Foo.md']
    );
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error('not a git repository');
    });

    await runBacklogLint({ rootDir: '/repo', origin: NO_ORIGIN_FILES });

    const out = logSpy.mock.calls.flat().join('\n');
    expect(out).toContain('Backlog layout in sync');
    expect(out).not.toContain('Uncommitted tracker files');
    expect(process.exitCode).not.toBe(1);
  });

  it('flags a cap violation and sets a non-zero exit code', async () => {
    mockFs({ 'backlog/now.md': '### ⚡ Quick Wins (max 2)\n- a\n- b\n- c\n' }, []);

    await runBacklogLint({ rootDir: '/repo', origin: NO_ORIGIN_FILES });

    expect(logSpy.mock.calls.flat().join('\n')).toContain('has 3 items (cap 2)');
    expect(process.exitCode).toBe(1);
  });

  it('prints the advisory warning alongside a real structural problem', async () => {
    // The two blocks are independent — gating problems set the exit code, the
    // warning never does — but every other test exercises one branch with the
    // other quiet. This pins that a failing run still names the uncommitted
    // file rather than the warning being swallowed by the problem report.
    mockFs({ 'backlog/now.md': '### ⚡ Quick Wins (max 2)\n- a\n- b\n- c\n' }, []);
    vi.mocked(execFileSync).mockReturnValue('?? tracker/tasks/task-537 - new.md\0');

    await runBacklogLint({ rootDir: '/repo', origin: NO_ORIGIN_FILES });

    const out = logSpy.mock.calls.flat().join('\n');
    expect(out).toContain('has 3 items (cap 2)');
    expect(out).toContain('tracker/tasks/task-537 - new.md (untracked)');
    expect(process.exitCode).toBe(1);
  });

  it('flags a dangling doc reference and sets a non-zero exit code', async () => {
    // doc-1 must not resolve via the doc-14 filename prefix — the id match is
    // space-delimited exact, not startsWith.
    mockFs(
      {
        'backlog/now.md': '### 🎯 Current Focus (max 3)\n1. a\n',
        'backlog/cold/queue.md': '- **Gone** (`doc-1`)\n',
      },
      ['doc-14 - Other.md']
    );

    await runBacklogLint({ rootDir: '/repo', origin: NO_ORIGIN_FILES });

    const out = logSpy.mock.calls.flat().join('\n');
    expect(out).toContain('dangling doc reference → doc-1');
    // Repo-relative, the same convention checkDocIdRefs uses. A bare `queue.md:`
    // prefix reads as a different kind of location than its sibling's full path,
    // for a finding about the same convention.
    expect(out).toContain('backlog/cold/queue.md: dangling doc reference → doc-1');
    expect(process.exitCode).toBe(1);
  });

  it('passes silently when queue.md is absent (cold/queue.md is optional)', async () => {
    mockFs({ 'backlog/now.md': '### 🎯 Current Focus (max 3)\n1. a\n' }, []);

    await runBacklogLint({ rootDir: '/repo', origin: NO_ORIGIN_FILES });

    expect(logSpy.mock.calls.flat().join('\n')).toContain('Backlog layout in sync');
    expect(process.exitCode).not.toBe(1);
  });

  it('flags an unparseable tracker task and sets a non-zero exit code', async () => {
    // Pins the WIRING of the gate, not just the parser: a broken task file
    // must reach `problems` and flip the exit code end-to-end — a task that
    // can't parse silently vanishes from the digest and every query.
    mockFs({ 'backlog/now.md': '### 🎯 Current Focus (max 3)\n1. a\n' }, [], {
      'task-1 - valid.md': VALID_TASK,
      'task-2 - broken.md': 'no frontmatter here, just prose',
    });

    await runBacklogLint({ rootDir: '/repo', origin: NO_ORIGIN_FILES });

    const out = logSpy.mock.calls.flat().join('\n');
    expect(out).toContain('Backlog structural problems');
    expect(out).toContain('task-2 - broken.md: no frontmatter block');
    expect(process.exitCode).toBe(1);
  });

  it('flags a missing tracker store (the store is load-bearing post-flip)', async () => {
    vi.mocked(existsSync).mockImplementation(p => String(p).endsWith('backlog/now.md'));
    vi.mocked(readFileSync).mockReturnValue('### 🎯 Current Focus (max 3)\n1. a\n');

    await runBacklogLint({ rootDir: '/repo', origin: NO_ORIGIN_FILES });

    expect(logSpy.mock.calls.flat().join('\n')).toContain('tracker/tasks/ not found');
    expect(process.exitCode).toBe(1);
  });

  it('flags two working-tree tasks sharing an id and sets a non-zero exit code', async () => {
    // Same id, different file and title — what two branches each filing a task
    // produce once they merge.
    const duplicate = VALID_TASK.replace("title: 'A valid task'", "title: 'The other one'");
    mockFs({ 'backlog/now.md': '### 🎯 Current Focus (max 3)\n1. a\n' }, [], {
      'task-1 - valid.md': VALID_TASK,
      'task-1 - other.md': duplicate,
    });

    await runBacklogLint({ rootDir: '/repo', origin: NO_ORIGIN_FILES });

    const out = logSpy.mock.calls.flat().join('\n');
    expect(out).toContain('duplicate task id TASK-1');
    expect(process.exitCode).toBe(1);
  });

  it('flags a new local task reusing an id origin/develop already carries', async () => {
    mockFs({ 'backlog/now.md': '### 🎯 Current Focus (max 3)\n1. a\n' }, [], {
      'task-1 - valid.md': VALID_TASK,
    });

    await runBacklogLint({
      rootDir: '/repo',
      origin: { resolvable: true, files: ['tracker/tasks/task-1 - filed-on-develop.md'] },
    });

    const out = logSpy.mock.calls.flat().join('\n');
    expect(out).toContain('id TASK-1 is already used on origin/develop');
    expect(process.exitCode).toBe(1);
  });

  it('gates when a task is live and archived at once', async () => {
    // Wiring, not logic: the pure check has its own suite. What this pins is
    // that the archive directory is actually read and its findings reach the
    // exit code — the whole failure was a state nothing looked at.
    // The backlogTree entry alone makes the archive directory exist AND supplies
    // its listing — a `files` entry for the same path would be dead weight.
    mockFs(
      { 'backlog/now.md': '### 🎯 Current Focus (max 3)\n1. a\n' },
      [],
      { 'task-1 - valid.md': VALID_TASK },
      {},
      { 'tracker/archive/tasks': [{ name: 'task-1 - valid.md' }] }
    );

    await runBacklogLint({ rootDir: '/repo', origin: NO_ORIGIN_FILES });

    const out = logSpy.mock.calls.flat().join('\n');
    expect(out).toContain('task-1 is BOTH live and archived');
    expect(process.exitCode).toBe(1);
  });

  it('stays clean when the archive directory does not exist at all', async () => {
    // The ordinary shape for any checkout without an archive: absent must read
    // as "nothing archived", never as a crash or a finding.
    mockFs({ 'backlog/now.md': '### 🎯 Current Focus (max 3)\n1. a\n' }, [], {
      'task-1 - valid.md': VALID_TASK,
    });

    await runBacklogLint({ rootDir: '/repo', origin: NO_ORIGIN_FILES });

    const out = logSpy.mock.calls.flat().join('\n');
    expect(out).toContain('Backlog layout in sync');
    expect(process.exitCode).not.toBe(1);
  });

  it('notes the skip and stays clean when origin/develop is unresolvable', async () => {
    mockFs({ 'backlog/now.md': '### 🎯 Current Focus (max 3)\n1. a\n' }, [], {
      'task-1 - valid.md': VALID_TASK,
    });

    await runBacklogLint({ rootDir: '/repo', origin: { resolvable: false, files: [] } });

    const out = logSpy.mock.calls.flat().join('\n');
    expect(out).toContain('origin/develop not resolvable');
    expect(out).toContain('Backlog layout in sync');
    expect(process.exitCode).not.toBe(1);
  });

  it('bypasses the origin-collision check (only) when the env var is set', async () => {
    // The rename escape hatch: the same colliding setup as above must NOT block
    // once the bypass is set, so a legitimate rename branch is not deadlocked.
    mockFs({ 'backlog/now.md': '### 🎯 Current Focus (max 3)\n1. a\n' }, [], {
      'task-1 - valid.md': VALID_TASK,
    });
    process.env[ALLOW_ORIGIN_ID_COLLISION_ENV] = '1';
    try {
      await runBacklogLint({
        rootDir: '/repo',
        origin: { resolvable: true, files: ['tracker/tasks/task-1 - filed-on-develop.md'] },
      });
    } finally {
      delete process.env[ALLOW_ORIGIN_ID_COLLISION_ENV];
    }

    const out = logSpy.mock.calls.flat().join('\n');
    expect(out).toContain(`${ALLOW_ORIGIN_ID_COLLISION_ENV}=1`);
    expect(out).not.toContain('already used on origin/develop');
    expect(process.exitCode).not.toBe(1);
  });

  describe('relative link checking', () => {
    it('passes when a tracker/docs relative link resolves on disk', async () => {
      mockFs(
        {
          'backlog/now.md': '### 🎯 Current Focus (max 3)\n1. a\n',
          'docs/existing.md': '',
        },
        ['doc-1 - Foo.md'],
        undefined,
        { 'doc-1 - Foo.md': '[text](../../docs/existing.md)' }
      );

      await runBacklogLint({ rootDir: '/repo', origin: NO_ORIGIN_FILES });

      expect(logSpy.mock.calls.flat().join('\n')).toContain('Backlog layout in sync');
      expect(process.exitCode).not.toBe(1);
    });

    it('flags a tracker/docs relative link that does not resolve, naming file and target', async () => {
      mockFs(
        { 'backlog/now.md': '### 🎯 Current Focus (max 3)\n1. a\n' },
        ['doc-1 - Foo.md'],
        undefined,
        { 'doc-1 - Foo.md': '[text](../../docs/missing.md)' }
      );

      await runBacklogLint({ rootDir: '/repo', origin: NO_ORIGIN_FILES });

      const out = logSpy.mock.calls.flat().join('\n');
      expect(out).toContain(
        'tracker/docs/doc-1 - Foo.md: dangling relative link → ../../docs/missing.md'
      );
      expect(out).toContain('resolved: docs/missing.md');
      expect(process.exitCode).toBe(1);
    });

    it('strips a trailing #fragment before resolving — passes when the file exists', async () => {
      mockFs(
        {
          'backlog/now.md': '### 🎯 Current Focus (max 3)\n1. a\n',
          'docs/existing.md': '',
        },
        ['doc-1 - Foo.md'],
        undefined,
        { 'doc-1 - Foo.md': '[text](../../docs/existing.md#section)' }
      );

      await runBacklogLint({ rootDir: '/repo', origin: NO_ORIGIN_FILES });

      expect(logSpy.mock.calls.flat().join('\n')).toContain('Backlog layout in sync');
      expect(process.exitCode).not.toBe(1);
    });

    it('flags a #fragment link whose underlying file is missing', async () => {
      mockFs(
        { 'backlog/now.md': '### 🎯 Current Focus (max 3)\n1. a\n' },
        ['doc-1 - Foo.md'],
        undefined,
        { 'doc-1 - Foo.md': '[text](../../docs/missing.md#section)' }
      );

      await runBacklogLint({ rootDir: '/repo', origin: NO_ORIGIN_FILES });

      const out = logSpy.mock.calls.flat().join('\n');
      expect(out).toContain('dangling relative link → ../../docs/missing.md');
      expect(process.exitCode).toBe(1);
    });

    // Every real filename under tracker/ has spaces, so this is the shape the
    // gate meets the moment anyone pastes a GitHub copy-link.
    it('resolves a percent-encoded link to a file whose name contains spaces', async () => {
      mockFs(
        {
          'backlog/now.md': '### 🎯 Current Focus (max 3)\n1. a\n',
          'docs/doc-20 - Theme.md': '',
        },
        ['doc-1 - Foo.md'],
        undefined,
        { 'doc-1 - Foo.md': '[text](../../docs/doc-20%20-%20Theme.md)' }
      );

      await runBacklogLint({ rootDir: '/repo', origin: NO_ORIGIN_FILES });

      expect(logSpy.mock.calls.flat().join('\n')).toContain('Backlog layout in sync');
      expect(process.exitCode).not.toBe(1);
    });

    // The seam the unit tests can't reach: that the DECODED target is what
    // reaches existsSync and what the message names. A report echoing the raw
    // `%20` string would be the pre-fix behavior wearing the post-fix label.
    it('reports a dangling encoded link against the decoded path, not the raw one', async () => {
      mockFs(
        { 'backlog/now.md': '### 🎯 Current Focus (max 3)\n1. a\n' },
        ['doc-1 - Foo.md'],
        undefined,
        { 'doc-1 - Foo.md': '[text](../../docs/doc-20%20-%20Missing.md)' }
      );

      await runBacklogLint({ rootDir: '/repo', origin: NO_ORIGIN_FILES });

      const out = logSpy.mock.calls.flat().join('\n');
      expect(out).toContain('dangling relative link → ../../docs/doc-20 - Missing.md');
      expect(out).not.toContain('%20');
      expect(process.exitCode).toBe(1);
    });

    it('resolves the angle-bracket form of the same spaced filename', async () => {
      mockFs(
        {
          'backlog/now.md': '### 🎯 Current Focus (max 3)\n1. a\n',
          'docs/doc-20 - Theme.md': '',
        },
        ['doc-1 - Foo.md'],
        undefined,
        { 'doc-1 - Foo.md': '[text](<../../docs/doc-20 - Theme.md>)' }
      );

      await runBacklogLint({ rootDir: '/repo', origin: NO_ORIGIN_FILES });

      expect(logSpy.mock.calls.flat().join('\n')).toContain('Backlog layout in sync');
      expect(process.exitCode).not.toBe(1);
    });

    // The file EXISTS, so the dangling check has nothing to say — and that is
    // exactly the trap: unwrapped spaces mean GitHub renders plain text, not a
    // link, and without this class the gate calls it healthy.
    it('flags a bare-spaced target as non-rendering even though the file exists', async () => {
      mockFs(
        {
          'backlog/now.md': '### 🎯 Current Focus (max 3)\n1. a\n',
          'docs/doc-20 - Theme.md': '',
        },
        ['doc-1 - Foo.md'],
        undefined,
        { 'doc-1 - Foo.md': '[text](../../docs/doc-20 - Theme.md)' }
      );

      await runBacklogLint({ rootDir: '/repo', origin: NO_ORIGIN_FILES });

      const out = logSpy.mock.calls.flat().join('\n');
      expect(out).toContain('will not render → ../../docs/doc-20 - Theme.md');
      expect(out).not.toContain('dangling relative link');
      expect(process.exitCode).toBe(1);
    });

    it('never reports absolute URLs, mailto, or bare anchors', async () => {
      mockFs(
        { 'backlog/now.md': '### 🎯 Current Focus (max 3)\n1. a\n' },
        ['doc-1 - Foo.md'],
        undefined,
        {
          'doc-1 - Foo.md': [
            '[a](https://example.com/foo.md)',
            '[b](mailto:someone@example.com)',
            '[c](#section)',
          ].join('\n'),
        }
      );

      await runBacklogLint({ rootDir: '/repo', origin: NO_ORIGIN_FILES });

      const out = logSpy.mock.calls.flat().join('\n');
      expect(out).not.toContain('dangling relative link');
      expect(process.exitCode).not.toBe(1);
    });

    it('checks a ../ link inside tracker/tasks/ too — both directories are scanned', async () => {
      const taskWithLink = VALID_TASK.replace(
        'Body.',
        'See [x](../../docs/missing-from-task.md) for detail.'
      );
      mockFs({ 'backlog/now.md': '### 🎯 Current Focus (max 3)\n1. a\n' }, [], {
        'task-1 - valid.md': taskWithLink,
      });

      await runBacklogLint({ rootDir: '/repo', origin: NO_ORIGIN_FILES });

      const out = logSpy.mock.calls.flat().join('\n');
      expect(out).toContain(
        'tracker/tasks/task-1 - valid.md: dangling relative link → ../../docs/missing-from-task.md'
      );
      expect(process.exitCode).toBe(1);
    });

    it('resolves a sibling ./foo.md form against the same directory', async () => {
      mockFs(
        {
          'backlog/now.md': '### 🎯 Current Focus (max 3)\n1. a\n',
          'tracker/docs/sibling.md': '',
        },
        ['doc-1 - Foo.md'],
        undefined,
        { 'doc-1 - Foo.md': '[text](./sibling.md)' }
      );

      await runBacklogLint({ rootDir: '/repo', origin: NO_ORIGIN_FILES });

      expect(logSpy.mock.calls.flat().join('\n')).toContain('Backlog layout in sync');
      expect(process.exitCode).not.toBe(1);
    });

    it('scans backlog/ too, recursing into backlog/cold/', async () => {
      mockFs(
        {
          'backlog/now.md': '### 🎯 Current Focus (max 3)\n1. a\n',
          'backlog/cold/epic-log.md': '[gone](../missing-target.md)',
        },
        ['doc-1 - Foo.md'],
        undefined,
        {},
        { backlog: [{ name: 'cold', dir: true }], 'backlog/cold': [{ name: 'epic-log.md' }] }
      );

      await runBacklogLint({ rootDir: '/repo', origin: NO_ORIGIN_FILES });

      // Resolved against the FILE's directory (backlog/cold/../) rather than
      // the scan root — the depth distinction the recursion introduces.
      const out = logSpy.mock.calls.flat().join('\n');
      expect(out).toContain(
        'backlog/cold/epic-log.md: dangling relative link → ../missing-target.md'
      );
      expect(out).toContain('resolved: backlog/missing-target.md');
      expect(process.exitCode).toBe(1);
    });

    it('flags a dangling `doc-N` reference in a scanned body, not just in queue.md', async () => {
      // The cross-reference convention that replaces fragile file links: a
      // renumber or delete used to leave these dangling everywhere except
      // queue.md, which is the same rot the relative-link check exists to close.
      mockFs(
        { 'backlog/now.md': '### 🎯 Current Focus (max 3)\n1. a\n' },
        ['doc-1 - Foo.md'],
        undefined,
        { 'doc-1 - Foo.md': 'Parked behind `doc-99`.' }
      );

      await runBacklogLint({ rootDir: '/repo', origin: NO_ORIGIN_FILES });

      const out = logSpy.mock.calls.flat().join('\n');
      expect(out).toContain('dangling doc reference → doc-99');
      expect(out).toContain('tracker/docs/doc-1 - Foo.md');
      expect(process.exitCode).toBe(1);
    });

    it('accepts a `doc-N` reference that resolves', async () => {
      mockFs(
        { 'backlog/now.md': '### 🎯 Current Focus (max 3)\n1. a\n' },
        ['doc-1 - Foo.md'],
        undefined,
        { 'doc-1 - Foo.md': 'See `doc-1` for the theme.' }
      );

      await runBacklogLint({ rootDir: '/repo', origin: NO_ORIGIN_FILES });

      expect(logSpy.mock.calls.flat().join('\n')).toContain('Backlog layout in sync');
      expect(process.exitCode).not.toBe(1);
    });

    it('does NOT scan tracker/archive/ — frozen content must not gate a PR', async () => {
      // The exclusion is a stated design decision in the module docstring, so
      // it gets pinned: this fixture is fully servable (the dir lists, the file
      // reads, the link is dead), and stays unreported only because
      // tracker/archive is absent from RELATIVE_LINK_SCAN_DIRS.
      mockFs(
        {
          'backlog/now.md': '### 🎯 Current Focus (max 3)\n1. a\n',
          'tracker/archive/old.md': '[gone](../nowhere.md)',
        },
        ['doc-1 - Foo.md'],
        undefined,
        {},
        { 'tracker/archive': [{ name: 'old.md' }] }
      );

      await runBacklogLint({ rootDir: '/repo', origin: NO_ORIGIN_FILES });

      expect(logSpy.mock.calls.flat().join('\n')).not.toContain('tracker/archive');
      expect(process.exitCode).not.toBe(1);
    });

    it('passes when a backlog/ relative link resolves', async () => {
      mockFs(
        {
          'backlog/now.md': '### 🎯 Current Focus (max 3)\n1. a\n[ref](../docs/real.md)\n',
          'docs/real.md': '',
        },
        ['doc-1 - Foo.md'],
        undefined,
        {},
        { backlog: [{ name: 'now.md' }] }
      );

      await runBacklogLint({ rootDir: '/repo', origin: NO_ORIGIN_FILES });

      expect(logSpy.mock.calls.flat().join('\n')).toContain('Backlog layout in sync');
      expect(process.exitCode).not.toBe(1);
    });
  });
});

// The only git/OS seam left in this module — the other one moved to
// trackerGitStatus.ts with its own colocated tests. It is also the
// higher-stakes of the two: a parse bug here fails toward a false positive that
// sets process.exitCode = 1, tripping everyone's quality gate — so the
// shell-out is mocked and its parse/trim/filter exercised directly, the way
// ci-gate.test.ts covers fetchRuns' execFileSync.
describe('readOriginTaskFiles', () => {
  // Reset BEFORE each test, not only after: this file's hoisted
  // `vi.mock('node:child_process')` already bound the static import to a shared
  // `vi.fn()`, so without a reset the FIRST test's doMock would not apply and
  // the call would hit that stub (returning undefined) instead of the per-test
  // ls-tree fixture.
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.doUnmock('node:child_process');
    vi.resetModules();
  });

  it('parses ls-tree output into repo-relative .md paths, dropping blanks and non-md', async () => {
    vi.doMock('node:child_process', () => ({
      execFileSync: (_cmd: string, args: string[]) =>
        args[0] === 'rev-parse'
          ? ''
          : 'tracker/tasks/task-1 - a.md\ntracker/tasks/task-2 - b.md\n\ntracker/tasks/README.txt\n',
    }));
    const { readOriginTaskFiles } = await import('./backlogLint.js');

    expect(readOriginTaskFiles('/repo')).toEqual({
      resolvable: true,
      files: ['tracker/tasks/task-1 - a.md', 'tracker/tasks/task-2 - b.md'],
    });
  });

  it('reports unresolvable (fail-open) when rev-parse cannot verify origin/develop', async () => {
    vi.doMock('node:child_process', () => ({
      execFileSync: (_cmd: string, args: string[]) => {
        if (args[0] === 'rev-parse') throw new Error('unknown revision or path');
        return '';
      },
    }));
    const { readOriginTaskFiles } = await import('./backlogLint.js');

    expect(readOriginTaskFiles('/repo')).toEqual({ resolvable: false, files: [] });
  });

  it('reports unresolvable when ls-tree fails even though rev-parse succeeded', async () => {
    vi.doMock('node:child_process', () => ({
      execFileSync: (_cmd: string, args: string[]) => {
        if (args[0] === 'rev-parse') return '';
        throw new Error('ls-tree failed');
      },
    }));
    const { readOriginTaskFiles } = await import('./backlogLint.js');

    expect(readOriginTaskFiles('/repo')).toEqual({ resolvable: false, files: [] });
  });

  it('bounds both git calls with ORIGIN_TASKS_TIMEOUT_MS', async () => {
    const calls: { args: string[]; options: unknown }[] = [];
    vi.doMock('node:child_process', () => ({
      execFileSync: (_cmd: string, args: string[], options: unknown) => {
        calls.push({ args, options });
        return '';
      },
    }));
    const { readOriginTaskFiles, ORIGIN_TASKS_TIMEOUT_MS } = await import('./backlogLint.js');

    readOriginTaskFiles('/repo');

    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.options).toMatchObject({ timeout: ORIGIN_TASKS_TIMEOUT_MS });
    }
  });
});
