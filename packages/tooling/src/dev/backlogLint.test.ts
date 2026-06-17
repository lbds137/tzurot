import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import {
  extractThemeLinks,
  oldestFollowUps,
  parseFollowUpRows,
  parseRowDate,
  parseSectionCaps,
  runBacklogLint,
  type FollowUpRow,
} from './backlogLint.js';

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

describe('extractThemeLinks', () => {
  it('pulls every themes/<slug>.md target out of queue markdown', () => {
    const md = [
      '- [Foo](themes/foo-bar.md) — summary',
      '- [Baz](themes/baz.md) — summary',
      '- **PR-2n** → see [../active-epic.md](../active-epic.md)',
    ].join('\n');
    expect(extractThemeLinks(md)).toEqual(['foo-bar.md', 'baz.md']);
  });
});

describe('parseRowDate', () => {
  it('returns the latest date mentioned in a row', () => {
    expect(parseRowDate('Surfaced 2026-05-01. Deferred 2026-05-19.')).toBe('2026-05-19');
  });
  it('returns null when no date is present', () => {
    expect(parseRowDate('| Some item | no dates here |')).toBeNull();
  });
});

describe('parseFollowUpRows', () => {
  it('extracts title + date from data rows, skipping header and separator', () => {
    const md = [
      '| Item | Why |',
      '| --- | --- |',
      '| `Fix the thing` | because reasons. Surfaced 2026-04-01. |',
      '| Another | no date |',
    ].join('\n');
    const rows = parseFollowUpRows(md);
    expect(rows).toEqual<FollowUpRow[]>([
      { title: 'Fix the thing', date: '2026-04-01' },
      { title: 'Another', date: null },
    ]);
  });
});

describe('oldestFollowUps', () => {
  it('sorts oldest-first, treating undated rows as oldest, and caps to n', () => {
    const rows: FollowUpRow[] = [
      { title: 'newest', date: '2026-06-01' },
      { title: 'undated', date: null },
      { title: 'middle', date: '2026-04-01' },
    ];
    expect(oldestFollowUps(rows, 2).map(r => r.title)).toEqual(['undated', 'middle']);
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

  function mockFs(files: Record<string, string>, themeFiles: string[]): void {
    vi.mocked(existsSync).mockImplementation(p => {
      const path = String(p);
      if (path.endsWith('backlog/cold/themes')) {
        return true;
      }
      return Object.keys(files).some(suffix => path.endsWith(suffix));
    });
    vi.mocked(readFileSync).mockImplementation(p => {
      const path = String(p);
      const hit = Object.entries(files).find(([suffix]) => path.endsWith(suffix));
      return hit ? hit[1] : '';
    });
    vi.mocked(readdirSync).mockReturnValue(themeFiles as unknown as ReturnType<typeof readdirSync>);
  }

  it('passes clean when caps respected and theme links resolve', async () => {
    mockFs(
      {
        'backlog/now.md': '### 🎯 Current Focus (max 3)\n1. a\n2. b\n',
        'backlog/cold/queue.md': '- [Foo](themes/foo.md)\n',
        'backlog/cold/follow-ups.md':
          '| Item | Why |\n| --- | --- |\n| x | Surfaced 2026-04-01. |\n',
      },
      ['foo.md']
    );

    await runBacklogLint({ rootDir: '/repo' });

    const out = logSpy.mock.calls.flat().join('\n');
    expect(out).toContain('Backlog layout in sync');
    expect(out).toContain('Oldest follow-ups');
    expect(process.exitCode).not.toBe(1);
  });

  it('flags a cap violation and sets a non-zero exit code', async () => {
    mockFs({ 'backlog/now.md': '### ⚡ Quick Wins (max 2)\n- a\n- b\n- c\n' }, []);

    await runBacklogLint({ rootDir: '/repo' });

    expect(logSpy.mock.calls.flat().join('\n')).toContain('has 3 items (cap 2)');
    expect(process.exitCode).toBe(1);
  });

  it('flags a dangling theme link and sets a non-zero exit code', async () => {
    mockFs(
      {
        'backlog/now.md': '### 🎯 Current Focus (max 3)\n1. a\n',
        'backlog/cold/queue.md': '- [Gone](themes/missing.md)\n',
      },
      ['foo.md']
    );

    await runBacklogLint({ rootDir: '/repo' });

    expect(logSpy.mock.calls.flat().join('\n')).toContain(
      'dangling theme link → themes/missing.md'
    );
    expect(process.exitCode).toBe(1);
  });

  it('passes silently when queue.md is absent (cold/queue.md is optional)', async () => {
    mockFs({ 'backlog/now.md': '### 🎯 Current Focus (max 3)\n1. a\n' }, []);

    await runBacklogLint({ rootDir: '/repo' });

    expect(logSpy.mock.calls.flat().join('\n')).toContain('Backlog layout in sync');
    expect(process.exitCode).not.toBe(1);
  });

  it('handles a follow-ups.md with no data rows (no oldest section, no crash)', async () => {
    mockFs(
      {
        'backlog/now.md': '### 🎯 Current Focus (max 3)\n1. a\n',
        'backlog/cold/follow-ups.md': '| Item | Why |\n| --- | --- |\n',
      },
      []
    );

    await runBacklogLint({ rootDir: '/repo' });

    const out = logSpy.mock.calls.flat().join('\n');
    expect(out).toContain('Backlog layout in sync');
    expect(out).not.toContain('Oldest follow-ups');
    expect(process.exitCode).not.toBe(1);
  });
});
