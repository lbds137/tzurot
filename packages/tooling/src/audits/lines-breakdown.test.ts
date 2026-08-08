/**
 * Tests for the per-file ranking of the always-loaded surfaces.
 *
 * The ranking and the formatters take measurements as fixtures, so a case can
 * state the exact shape it is about (a table-heavy file beside a prose-heavy
 * one) instead of building a filesystem to approximate it. Only the reporter
 * needs real files, since walking the surface globs is the part of it that can
 * break.
 */

import { describe, it, expect, vi } from 'vitest';
import chalk from 'chalk';
import {
  rankSurfaceFiles,
  formatTokenEstimate,
  formatBreakdownRow,
  reportBreakdown,
} from './lines-breakdown.js';

describe('rankSurfaceFiles', () => {
  it('ranks by bytes, not by lines', () => {
    // The failure this ordering exists to prevent, in miniature: the
    // table-heavy file has MORE lines and LESS weight. Sorted by lines it
    // would lead, and a reader trimming from the top would work the file
    // that costs least.
    const ranked = rankSurfaceFiles([
      { path: 'tables.md', lines: 300, bytes: 13_000 },
      { path: 'prose.md', lines: 200, bytes: 22_000 },
    ]);

    expect(ranked.map(row => row.path)).toEqual(['prose.md', 'tables.md']);
    expect(ranked[0].bytesPerLine).toBe(110);
    expect(ranked[1].bytesPerLine).toBeCloseTo(43.33, 1);
  });

  it('reports each file share of its own surface', () => {
    const ranked = rankSurfaceFiles([
      { path: 'a.md', lines: 10, bytes: 750 },
      { path: 'b.md', lines: 10, bytes: 250 },
    ]);

    expect(ranked.map(row => row.share)).toEqual([0.75, 0.25]);
  });

  it('breaks byte ties on path so the order is stable across runs', () => {
    const ranked = rankSurfaceFiles([
      { path: 'b.md', lines: 1, bytes: 100 },
      { path: 'a.md', lines: 1, bytes: 100 },
    ]);

    expect(ranked.map(row => row.path)).toEqual(['a.md', 'b.md']);
  });

  it('yields zero share and zero density instead of NaN on empty files', () => {
    // Both divisors can legitimately be zero — an empty file has no lines, and
    // a surface of empty files has no bytes. NaN would print as "NaN%".
    const ranked = rankSurfaceFiles([{ path: 'empty.md', lines: 0, bytes: 0 }]);

    expect(ranked[0].share).toBe(0);
    expect(ranked[0].bytesPerLine).toBe(0);
  });

  it('returns an empty ranking for a surface with no files', () => {
    expect(rankSurfaceFiles([])).toEqual([]);
  });
});

describe('formatTokenEstimate', () => {
  it('keeps one decimal in the range the rules files actually occupy', () => {
    // Whole-thousand rounding renders these two as "1k" and "2k" — a file and
    // one nearly twice its weight, flattened to adjacent integers. That is the
    // ranking's own signal, and losing it to formatting is the failure.
    expect(formatTokenEstimate(5055)).toBe('≈1.3k tok');
    expect(formatTokenEstimate(10_521)).toBe('≈2.6k tok');
  });

  it('rounds to whole thousands once resolution stops mattering', () => {
    expect(formatTokenEstimate(40_460)).toBe('≈10k tok');
  });

  it('reports sub-1k estimates as tokens rather than 0.0k', () => {
    expect(formatTokenEstimate(400)).toBe('≈100 tok');
  });
});

describe('formatBreakdownRow', () => {
  it('carries the path, both raw counts, the share, and the density', () => {
    const line = formatBreakdownRow({
      path: '.claude/rules/05-tooling.md',
      lines: 398,
      bytes: 40_460,
      share: 0.2336,
      bytesPerLine: 101.7,
    });

    expect(line).toContain('40460 B');
    expect(line).toContain('≈10k tok');
    expect(line).toContain('23%');
    expect(line).toContain('398 lines');
    expect(line).toContain('102 B/line');
    expect(line).toContain('.claude/rules/05-tooling.md');
  });
});

describe('reportBreakdown', () => {
  async function withTmpDir(run: (tmp: string) => Promise<void>): Promise<void> {
    const { mkdtemp, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const tmp = await mkdtemp(join(tmpdir(), 'lines-breakdown-test-'));
    try {
      await run(tmp);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  }

  /**
   * Capture console.log for one call, with colour forced OFF.
   *
   * Disabling chalk beats stripping SGR escapes afterwards: the row assertions
   * read the LAST whitespace-delimited token of a line, and a trailing reset
   * code would silently attach itself to the path being compared. Forcing the
   * level also makes the test independent of whether the runner happens to
   * look like a TTY.
   */
  function captured(run: () => void): string {
    const lines: string[] = [];
    const priorLevel = chalk.level;
    chalk.level = 0;
    const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(' '));
    });
    try {
      run();
    } finally {
      spy.mockRestore();
      chalk.level = priorLevel;
    }
    return lines.join('\n');
  }

  it('prints every surface with its files ranked worst-first', async () => {
    await withTmpDir(async tmp => {
      const { mkdir, writeFile } = await import('node:fs/promises');
      const { join } = await import('node:path');
      await mkdir(join(tmp, '.claude/rules'), { recursive: true });
      await writeFile(join(tmp, '.claude/rules/00-small.md'), 'x\n');
      await writeFile(join(tmp, '.claude/rules/01-big.md'), 'y'.repeat(500) + '\n');
      await writeFile(join(tmp, 'CURRENT.md'), 'status\n');

      const output = captured(() => reportBreakdown(tmp));

      // Alphabetical order would put 00-small first; byte order must not.
      const rulesRows = output
        .split('\n')
        .filter(line => line.includes('.claude/rules/'))
        .map(line => line.trim().split(/\s+/).pop());
      expect(rulesRows).toEqual(['.claude/rules/01-big.md', '.claude/rules/00-small.md']);
      expect(output).toContain('CURRENT.md');
    });
  });

  it('names a zero-match surface rather than printing a healthy-looking empty section', async () => {
    // The branch that matters: a moved CURRENT.md must not render as a surface
    // with nothing wrong with it.
    await withTmpDir(async tmp => {
      const { mkdir, writeFile } = await import('node:fs/promises');
      const { join } = await import('node:path');
      await mkdir(join(tmp, '.claude/rules'), { recursive: true });
      await writeFile(join(tmp, '.claude/rules/00-a.md'), 'x\n');

      const output = captured(() => reportBreakdown(tmp));

      expect(output).toContain('glob matched zero files');
      expect(output).toContain('current');
    });
  });
});
