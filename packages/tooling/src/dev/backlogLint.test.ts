import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import {
  extractThemeLinks,
  findMalformedFollowUpRows,
  oldestFollowUps,
  parseFollowUpRows,
  parseRowDate,
  parseSectionCaps,
  runBacklogLint,
  undatedFollowUps,
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
  it('prefers the Surfaced stamp so later annotations do not reset the age', () => {
    expect(parseRowDate('Surfaced 2026-05-01. Deferred 2026-05-19.')).toBe('2026-05-01');
  });
  it('falls back to the earliest date when no Surfaced stamp is present', () => {
    expect(parseRowDate('Deferred 2026-05-19; re-scoped 2026-07-02.')).toBe('2026-05-19');
  });
  it('ignores a bare "Surfaced by PR #N" that carries no date', () => {
    expect(
      parseRowDate('Surfaced by PR #1260. Surfaced 2026-06-18 (dated from git history).')
    ).toBe('2026-06-18');
  });
  it('matches a lowercase stamp ("Originally surfaced …")', () => {
    expect(parseRowDate('Originally surfaced 2026-04-29; deferred 2026-05-01.')).toBe('2026-04-29');
  });
  it('does NOT match inside "resurfaced" — a re-surfacing date is not the filing date', () => {
    expect(parseRowDate('Filed 2026-03-01, resurfaced 2026-07-01.')).toBe('2026-03-01');
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
  it('sorts oldest-first over DATED rows only, and caps to n', () => {
    const rows: FollowUpRow[] = [
      { title: 'newest', date: '2026-06-01' },
      { title: 'undated', date: null },
      { title: 'middle', date: '2026-04-01' },
    ];
    expect(oldestFollowUps(rows, 2).map(r => r.title)).toEqual(['middle', 'newest']);
  });

  it('does not let undated rows starve the escalation when they exceed the slots', () => {
    // The exact production failure: 27 undated rows against 5 display slots
    // meant the genuinely-old dated rows never surfaced.
    const rows: FollowUpRow[] = [
      ...Array.from({ length: 27 }, (_, i) => ({ title: `undated-${i}`, date: null })),
      { title: 'ancient', date: '2026-01-26' },
      { title: 'old', date: '2026-02-15' },
    ];
    expect(oldestFollowUps(rows, 5).map(r => r.title)).toEqual(['ancient', 'old']);
  });
});

describe('findMalformedFollowUpRows', () => {
  it('flags two rows merged onto one line (the hidden-item class)', () => {
    const md = ['| Item | Why |', '| --- | --- |', '| first | reason || second | reason |'].join(
      '\n'
    );
    const problems = findMalformedFollowUpRows(md);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('6 cell delimiters');
    expect(problems[0]).toContain('follow-ups.md:3');
  });

  it('flags an extra column (GFM silently drops the trailing Why cell)', () => {
    const md = ['| Item | Why |', '| --- | --- |', '| title | detail | why |'].join('\n');
    expect(findMalformedFollowUpRows(md)).toHaveLength(1);
  });

  it('flags an unescaped pipe inside an inline code span', () => {
    const md = ['| Item | Why |', '| --- | --- |', '| uses `(a|an|any)` here | why |'].join('\n');
    expect(findMalformedFollowUpRows(md)).toHaveLength(1);
  });

  it('accepts escaped pipes inside row prose', () => {
    const md = ['| Item | Why |', '| --- | --- |', '| `isPublic \\|\\| ownerId` | fine |'].join(
      '\n'
    );
    expect(findMalformedFollowUpRows(md)).toEqual([]);
  });

  it('counts the delimiter after a literal backslash (escaped-backslash ordering)', () => {
    // A cell ending in a literal backslash (`\\`) immediately before the REAL
    // delimiter. Stripping `\|` first would consume the second backslash plus
    // the delimiter as one "escaped pipe", undercount to 2, and wrongly flag a
    // well-formed row. Fails against the pre-fix single-replace implementation.
    const wellFormed = ['| Item | Why |', '| --- | --- |', '| path foo\\\\| why |'].join('\n');
    expect(findMalformedFollowUpRows(wellFormed)).toEqual([]);

    // The same escape shape must still not mask a genuine extra column.
    const malformed = ['| Item | Why |', '| --- | --- |', '| path foo\\\\| b | c |'].join('\n');
    expect(findMalformedFollowUpRows(malformed)).toHaveLength(1);
  });

  it('accepts a well-formed table and ignores the separator row', () => {
    const md = ['| Item | Why |', '| --- | --- |', '| a | b |', '| c | d |'].join('\n');
    expect(findMalformedFollowUpRows(md)).toEqual([]);
  });
});

describe('undatedFollowUps', () => {
  it('returns only the rows with no aging anchor', () => {
    const rows: FollowUpRow[] = [
      { title: 'dated', date: '2026-06-01' },
      { title: 'undated-a', date: null },
      { title: 'undated-b', date: null },
    ];
    expect(undatedFollowUps(rows).map(r => r.title)).toEqual(['undated-a', 'undated-b']);
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

  it('flags a malformed follow-up row and sets a non-zero exit code', async () => {
    // Pins the WIRING of the new CI gate, not just the pure checker: a merged
    // row must reach `problems` and flip the exit code end-to-end.
    mockFs(
      {
        'backlog/now.md': '### 🎯 Current Focus (max 3)\n1. a\n',
        'backlog/cold/follow-ups.md':
          '| Item | Why |\n| --- | --- |\n| first | why || second | why |\n',
      },
      []
    );

    await runBacklogLint({ rootDir: '/repo' });

    const out = logSpy.mock.calls.flat().join('\n');
    expect(out).toContain('Backlog structural problems');
    expect(out).toContain('cell delimiters');
    expect(process.exitCode).toBe(1);
  });

  it('reports undated rows separately, sampled, without touching the exit code', async () => {
    const undated = Array.from({ length: 5 }, (_, i) => `| undated-${i} | no date |`).join('\n');
    mockFs(
      {
        'backlog/now.md': '### 🎯 Current Focus (max 3)\n1. a\n',
        'backlog/cold/follow-ups.md': `| Item | Why |\n| --- | --- |\n| dated | Surfaced 2026-04-01. |\n${undated}\n`,
      },
      []
    );

    await runBacklogLint({ rootDir: '/repo' });

    const out = logSpy.mock.calls.flat().join('\n');
    expect(out).toContain('5 follow-up(s) have no date');
    expect(out).toContain('… and 2 more'); // 5 undated, sample size 3
    expect(out).toContain('2026-04-01'); // the dated row still gets its escalation slot
    expect(process.exitCode).not.toBe(1); // undated rows are a prompt, never a gate
  });
});
