import { beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { countByArea, newestTasks, oldestTasks, runBacklogDigest } from './backlogDigest.js';
import type { TrackerTask } from './trackerTasks.js';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  readdirSync: vi.fn(),
}));

function task(
  id: string,
  createdDate: string,
  labels: string[] = [],
  status = 'To Do'
): TrackerTask {
  return {
    id,
    title: `Task ${id}`,
    status,
    createdDate,
    labels,
    body: '',
    file: `tracker/tasks/${id}.md`,
  };
}

describe('countByArea', () => {
  it('counts per area label, sorted by count then name, and tallies unlabeled', () => {
    const tasks = [
      task('TASK-1', '2026-01-01', ['area:db']),
      task('TASK-2', '2026-01-02', ['area:db', 'area:redis']),
      task('TASK-3', '2026-01-03', ['area:redis']),
      task('TASK-4', '2026-01-04', ['priority:high']),
    ];
    expect(countByArea(tasks)).toEqual({
      areas: [
        ['db', 2],
        ['redis', 2],
      ],
      unlabeled: 1,
    });
  });
});

describe('oldestTasks / newestTasks', () => {
  const tasks = [
    task('TASK-2', '2026-03-01'),
    task('TASK-1', '2026-01-01'),
    task('TASK-3', '2026-02-01'),
  ];

  it('oldestTasks sorts ascending by filing date', () => {
    expect(oldestTasks(tasks, 2).map(t => t.id)).toEqual(['TASK-1', 'TASK-3']);
  });

  it('newestTasks sorts descending by filing date', () => {
    expect(newestTasks(tasks, 2).map(t => t.id)).toEqual(['TASK-2', 'TASK-3']);
  });
});

describe('runBacklogDigest', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetAllMocks();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  function fileFor(t: {
    id: string;
    date: string;
    labels?: string[];
    status?: string;
  }): [string, string] {
    const labelLines =
      t.labels === undefined || t.labels.length === 0
        ? ['labels: []']
        : ['labels:', ...t.labels.map(l => `  - '${l}'`)];
    return [
      `${t.id.toLowerCase()}.md`,
      [
        '---',
        `id: ${t.id}`,
        `title: 'Task ${t.id}'`,
        `status: ${t.status ?? 'To Do'}`,
        `created_date: '${t.date} 00:00'`,
        ...labelLines,
        '---',
        '',
        'Body.',
      ].join('\n'),
    ];
  }

  function mockStore(specs: Parameters<typeof fileFor>[0][]): void {
    const byName = new Map(specs.map(fileFor));
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readdirSync).mockReturnValue([...byName.keys()] as unknown as ReturnType<
      typeof readdirSync
    >);
    vi.mocked(readFileSync).mockImplementation(path => {
      const name = String(path).split('/').at(-1) as string;
      return byName.get(name) ?? '';
    });
  }

  it('prints the open count, area counts, oldest and newest surfaces', async () => {
    mockStore([
      { id: 'TASK-1', date: '2026-01-01', labels: ['area:db'] },
      { id: 'TASK-2', date: '2026-06-01' },
      { id: 'TASK-3', date: '2026-03-01', labels: ['area:db'], status: 'In Progress' },
    ]);

    await runBacklogDigest({ rootDir: '/repo' });

    const out = logSpy.mock.calls.flat().join('\n');
    expect(out).toContain('3 open tasks (1 in progress)');
    expect(out).toContain('- db: 2');
    expect(out).toContain('- (no area label yet): 1');
    // Oldest surface leads with the oldest filing date
    expect(out).toContain('- 2026-01-01  TASK-1');
    expect(out).toContain('Newest 10 filed');
  });

  it('excludes Done tasks from every surface', async () => {
    mockStore([
      { id: 'TASK-1', date: '2026-01-01' },
      { id: 'TASK-2', date: '2026-02-01', status: 'Done' },
    ]);

    await runBacklogDigest({ rootDir: '/repo' });

    const out = logSpy.mock.calls.flat().join('\n');
    expect(out).toContain('1 open tasks');
    expect(out).not.toContain('TASK-2');
  });

  it('surfaces store problems without failing (the lint owns gating)', async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    process.exitCode = undefined;

    await runBacklogDigest({ rootDir: '/repo' });

    const out = logSpy.mock.calls.flat().join('\n');
    expect(out).toContain('tracker/tasks/ not found');
    expect(process.exitCode).toBeUndefined();
  });
});
