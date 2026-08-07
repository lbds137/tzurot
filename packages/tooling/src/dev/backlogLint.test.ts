import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import {
  checkTaskTriage,
  extractQueueDocRefs,
  parseSectionCaps,
  runBacklogLint,
} from './backlogLint.js';
import type { TrackerTask } from './trackerTasks.js';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  readdirSync: vi.fn(),
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

describe('checkTaskTriage', () => {
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

describe('runBacklogLint', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetAllMocks();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    process.exitCode = undefined;
  });

  afterEach(() => {
    logSpy.mockRestore();
    process.exitCode = undefined;
  });

  function mockFs(
    files: Record<string, string>,
    docFiles: string[],
    trackerFiles: Record<string, string> = { 'task-1 - valid.md': VALID_TASK }
  ): void {
    vi.mocked(existsSync).mockImplementation(p => {
      const path = String(p);
      if (path.endsWith('tracker/docs') || path.endsWith('tracker/tasks')) {
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
      const hit = Object.entries(files).find(([suffix]) => path.endsWith(suffix));
      return hit ? hit[1] : '';
    });
    vi.mocked(readdirSync).mockImplementation(p => {
      const path = String(p);
      const listing = path.endsWith('tracker/tasks') ? Object.keys(trackerFiles) : docFiles;
      return listing as unknown as ReturnType<typeof readdirSync>;
    });
  }

  it('passes clean when caps respected, doc refs resolve, and tasks parse', async () => {
    mockFs(
      {
        'backlog/now.md': '### 🎯 Current Focus (max 3)\n1. a\n2. b\n',
        'backlog/cold/queue.md': '- **Foo** (`doc-1`)\n',
      },
      ['doc-1 - Foo.md']
    );

    await runBacklogLint({ rootDir: '/repo' });

    const out = logSpy.mock.calls.flat().join('\n');
    expect(out).toContain('Backlog layout in sync');
    expect(process.exitCode).not.toBe(1);
  });

  it('flags a cap violation and sets a non-zero exit code', async () => {
    mockFs({ 'backlog/now.md': '### ⚡ Quick Wins (max 2)\n- a\n- b\n- c\n' }, []);

    await runBacklogLint({ rootDir: '/repo' });

    expect(logSpy.mock.calls.flat().join('\n')).toContain('has 3 items (cap 2)');
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

    await runBacklogLint({ rootDir: '/repo' });

    expect(logSpy.mock.calls.flat().join('\n')).toContain('dangling doc reference → doc-1');
    expect(process.exitCode).toBe(1);
  });

  it('passes silently when queue.md is absent (cold/queue.md is optional)', async () => {
    mockFs({ 'backlog/now.md': '### 🎯 Current Focus (max 3)\n1. a\n' }, []);

    await runBacklogLint({ rootDir: '/repo' });

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

    await runBacklogLint({ rootDir: '/repo' });

    const out = logSpy.mock.calls.flat().join('\n');
    expect(out).toContain('Backlog structural problems');
    expect(out).toContain('task-2 - broken.md: no frontmatter block');
    expect(process.exitCode).toBe(1);
  });

  it('flags a missing tracker store (the store is load-bearing post-flip)', async () => {
    vi.mocked(existsSync).mockImplementation(p => String(p).endsWith('backlog/now.md'));
    vi.mocked(readFileSync).mockReturnValue('### 🎯 Current Focus (max 3)\n1. a\n');

    await runBacklogLint({ rootDir: '/repo' });

    expect(logSpy.mock.calls.flat().join('\n')).toContain('tracker/tasks/ not found');
    expect(process.exitCode).toBe(1);
  });
});
