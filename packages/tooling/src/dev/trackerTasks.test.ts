import { beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { loadTrackerTasks, openTasks, parseTaskFile, type TrackerTask } from './trackerTasks.js';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  readdirSync: vi.fn(),
}));

beforeEach(() => {
  vi.resetAllMocks();
});

function frontmatter(lines: string[], body = 'Body text.'): string {
  return ['---', ...lines, '---', '', body].join('\n');
}

describe('parseTaskFile', () => {
  it('parses a single-quoted title with doubled-quote escapes', () => {
    const result = parseTaskFile(
      frontmatter([
        'id: TASK-100',
        "title: 'DiscordChannelFetcher''s follow-up'",
        'status: To Do',
        "created_date: '2026-05-16 00:00'",
        'labels: []',
      ]),
      'tracker/tasks/t.md'
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.task.title).toBe("DiscordChannelFetcher's follow-up");
      expect(result.task.id).toBe('TASK-100');
      expect(result.task.createdDate).toBe('2026-05-16');
      expect(result.task.body).toContain('Body text.');
    }
  });

  it('parses a double-quoted title (the store has both quoting styles)', () => {
    const result = parseTaskFile(
      frontmatter([
        'id: TASK-131',
        'title: "Monitor default-timeout (2500ms) routes that aren\'t obviously fast"',
        'status: To Do',
        "created_date: '2026-06-01 00:00'",
      ]),
      'tracker/tasks/t.md'
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.task.title).toContain("aren't obviously fast");
    }
  });

  it('parses block-style label lists and keeps only strings', () => {
    const result = parseTaskFile(
      frontmatter([
        'id: TASK-1',
        "title: 'Labeled'",
        'status: To Do',
        "created_date: '2026-06-01 00:00'",
        'labels:',
        "  - 'area:db'",
        "  - 'area:redis'",
      ]),
      'tracker/tasks/t.md'
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.task.labels).toEqual(['area:db', 'area:redis']);
    }
  });

  it('parses the priority field, defaulting to empty string when absent', () => {
    const withPriority = parseTaskFile(
      frontmatter([
        'id: TASK-2',
        "title: 'Prioritized'",
        'status: To Do',
        "created_date: '2026-06-01 00:00'",
        'priority: high',
      ]),
      'tracker/tasks/t.md'
    );
    expect(withPriority.ok).toBe(true);
    if (withPriority.ok) {
      expect(withPriority.task.priority).toBe('high');
    }

    const without = parseTaskFile(
      frontmatter([
        'id: TASK-3',
        "title: 'Unprioritized'",
        'status: To Do',
        "created_date: '2026-06-01 00:00'",
      ]),
      'tracker/tasks/t.md'
    );
    expect(without.ok).toBe(true);
    if (without.ok) {
      expect(without.task.priority).toBe('');
    }
  });

  it('rejects a file with no frontmatter block', () => {
    const result = parseTaskFile('just prose, no frontmatter', 'tracker/tasks/broken.md');
    expect(result).toEqual({ ok: false, problem: 'tracker/tasks/broken.md: no frontmatter block' });
  });

  it('rejects frontmatter that is not valid YAML', () => {
    const result = parseTaskFile(
      frontmatter(['id: TASK-1', 'title: "unclosed']),
      'tracker/tasks/bad.md'
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problem).toContain('not valid YAML');
    }
  });

  it('rejects frontmatter missing id or title', () => {
    const result = parseTaskFile(
      frontmatter(['status: To Do', "created_date: '2026-06-01 00:00'"]),
      'tracker/tasks/anon.md'
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problem).toContain('missing id or title');
    }
  });

  it('rejects frontmatter missing a parseable created_date (the aging anchor)', () => {
    const result = parseTaskFile(
      frontmatter(['id: TASK-1', "title: 'Dateless'", 'status: To Do']),
      'tracker/tasks/dateless.md'
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problem).toContain('created_date');
    }
  });
});

describe('loadTrackerTasks', () => {
  it('reports a missing store directory as a problem', () => {
    vi.mocked(existsSync).mockReturnValue(false);
    expect(loadTrackerTasks('/repo')).toEqual({
      tasks: [],
      problems: ['tracker/tasks/ not found'],
    });
  });

  it('loads parseable tasks and reports broken ones per-file', () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readdirSync).mockReturnValue([
      'task-1 - ok.md',
      'task-2 - broken.md',
      'notes.txt',
    ] as unknown as ReturnType<typeof readdirSync>);
    vi.mocked(readFileSync).mockImplementation(path => {
      if (String(path).endsWith('task-1 - ok.md')) {
        return frontmatter([
          'id: TASK-1',
          "title: 'Fine'",
          'status: To Do',
          "created_date: '2026-06-01 00:00'",
        ]);
      }
      return 'broken';
    });

    const { tasks, problems } = loadTrackerTasks('/repo');
    expect(tasks.map(t => t.id)).toEqual(['TASK-1']);
    expect(problems).toEqual(['tracker/tasks/task-2 - broken.md: no frontmatter block']);
    // notes.txt is not a task file and must not be read at all
    expect(
      vi.mocked(readFileSync).mock.calls.every(([p]) => !String(p).endsWith('notes.txt'))
    ).toBe(true);
  });
});

describe('openTasks', () => {
  it('filters out Done tasks case-insensitively', () => {
    const make = (id: string, status: string): TrackerTask => ({
      id,
      title: id,
      status,
      createdDate: '2026-06-01',
      labels: [],
      priority: 'medium',
      body: '',
      file: `tracker/tasks/${id}.md`,
    });
    const open = openTasks([
      make('TASK-1', 'To Do'),
      make('TASK-2', 'Done'),
      make('TASK-3', 'In Progress'),
    ]);
    expect(open.map(t => t.id)).toEqual(['TASK-1', 'TASK-3']);
  });
});
