/**
 * Tests for the always-loaded context line ratchet.
 *
 * The pure pieces (line counting, surface measurement, ratchet evaluation,
 * baseline update) are tested directly; the CLI shell is exercised
 * end-to-end against the audit-canary fixture in canary.test.ts
 * (deliberately over-budget surfaces).
 */

import { describe, it, expect, vi } from 'vitest';
import {
  countLines,
  measureSurfaces,
  evaluateLineBudgets,
  parseLinesBaseline,
  computeUpdatedLinesBaseline,
  getLinesConfigFingerprint,
  runLinesCheck,
  LINES_IMPL_VERSION,
  type MeasuredSurfaces,
  type LinesBaseline,
} from './lines-check.js';
import { buildBaselineMeta, hashConfigSlice } from './baseline-meta.js';

function measured(overrides: Partial<MeasuredSurfaces> = {}): MeasuredSurfaces {
  return {
    rules: { lines: 100, fileCount: 3 },
    current: { lines: 20, fileCount: 1 },
    ...overrides,
  };
}

function baseline(surfaces: LinesBaseline['surfaces']): LinesBaseline {
  return { surfaces };
}

async function withTmpDir(run: (tmp: string) => Promise<void>): Promise<void> {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const tmp = await mkdtemp(join(tmpdir(), 'lines-check-test-'));
  try {
    await run(tmp);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

describe('countLines', () => {
  it('counts newline-terminated lines like wc -l', () => {
    expect(countLines('a\nb\nc\n')).toBe(3);
  });

  it('counts a final unterminated line', () => {
    expect(countLines('a\nb\nc')).toBe(3);
  });

  it('counts an empty file as zero lines', () => {
    expect(countLines('')).toBe(0);
  });
});

describe('measureSurfaces', () => {
  it('sums rules/*.md line counts and measures CURRENT.md individually', async () => {
    await withTmpDir(async tmp => {
      const { mkdir, writeFile } = await import('node:fs/promises');
      const { join } = await import('node:path');
      await mkdir(join(tmp, '.claude/rules'), { recursive: true });
      await writeFile(join(tmp, '.claude/rules/00-a.md'), 'one\ntwo\n');
      await writeFile(join(tmp, '.claude/rules/01-b.md'), 'one\ntwo\nthree\n');
      // Non-markdown files in the rules dir must not count toward the budget.
      await writeFile(join(tmp, '.claude/rules/notes.txt'), 'x\n'.repeat(50));
      await writeFile(join(tmp, 'CURRENT.md'), 'status\n');

      expect(measureSurfaces(tmp)).toEqual({
        rules: { lines: 5, fileCount: 2 },
        current: { lines: 1, fileCount: 1 },
      });
    });
  });

  it('reports zero matched files for missing surfaces instead of throwing', async () => {
    await withTmpDir(async tmp => {
      expect(measureSurfaces(tmp)).toEqual({
        rules: { lines: 0, fileCount: 0 },
        current: { lines: 0, fileCount: 0 },
      });
    });
  });
});

describe('evaluateLineBudgets', () => {
  const budgets = baseline({
    rules: { lines: 100, graceMargin: 10 },
    current: { lines: 20, graceMargin: 5 },
  });

  it('passes at or below the limit (baseline + grace)', () => {
    const outcome = evaluateLineBudgets(
      measured({ rules: { lines: 110, fileCount: 3 }, current: { lines: 25, fileCount: 1 } }),
      budgets
    );

    expect(outcome.status).toBe('ok');
    expect(outcome.failures).toEqual([]);
  });

  it('fails when a surface exceeds its limit', () => {
    const outcome = evaluateLineBudgets(measured({ rules: { lines: 111, fileCount: 3 } }), budgets);

    expect(outcome.status).toBe('fail');
    expect(outcome.failures[0]).toContain('rules');
    expect(outcome.failures[0]).toContain('111 lines exceeds the limit 110');
  });

  it('fails when a surface matched zero files — a hollow measurement is not a pass', () => {
    // A moved .claude/rules directory would otherwise "measure" 0 lines and
    // sail under any budget; the evaluator must catch it.
    const outcome = evaluateLineBudgets(measured({ rules: { lines: 0, fileCount: 0 } }), budgets);

    expect(outcome.status).toBe('fail');
    expect(outcome.failures[0]).toContain('matched zero files');
    expect(outcome.surfaces.find(s => s.name === 'rules')?.lines).toBeNull();
  });

  it('fails when the baseline tracks a surface the tool does not measure', () => {
    const outcome = evaluateLineBudgets(
      measured(),
      baseline({ phantom: { lines: 10, graceMargin: 0 } })
    );

    expect(outcome.status).toBe('fail');
    expect(outcome.failures[0]).toContain('phantom');
    expect(outcome.failures[0]).toContain('does not measure');
  });
});

describe('parseLinesBaseline', () => {
  it('accepts a well-formed baseline', () => {
    const parsed = parseLinesBaseline(
      JSON.stringify(baseline({ rules: { lines: 2000, graceMargin: 150 } })),
      'x.json'
    );
    expect(parsed.surfaces.rules.lines).toBe(2000);
  });

  it('rejects a baseline without surfaces', () => {
    expect(() => parseLinesBaseline('{"meta":{}}', 'x.json')).toThrow('missing "surfaces"');
  });

  it('rejects a surface entry without numeric lines', () => {
    expect(() =>
      parseLinesBaseline('{"surfaces":{"rules":{"graceMargin":150}}}', 'x.json')
    ).toThrow('needs numeric lines+graceMargin');
  });
});

describe('computeUpdatedLinesBaseline', () => {
  const meta = buildBaselineMeta(
    `lines-check/${LINES_IMPL_VERSION}`,
    hashConfigSlice(getLinesConfigFingerprint())
  );

  it('writes the measured counts and preserves previous grace margins + notes', () => {
    const previous: Partial<LinesBaseline> = {
      notes: 'keep me',
      surfaces: {
        rules: { lines: 1800, graceMargin: 200 },
        current: { lines: 30, graceMargin: 60 },
      },
    };

    const updated = computeUpdatedLinesBaseline(measured(), previous, meta);

    expect(updated.surfaces.rules).toEqual({ lines: 100, graceMargin: 200 });
    expect(updated.surfaces.current).toEqual({ lines: 20, graceMargin: 60 });
    expect(updated.notes).toBe('keep me');
    expect(updated.meta).toBe(meta);
  });

  it('applies the default grace margins for newly-tracked surfaces', () => {
    const updated = computeUpdatedLinesBaseline(measured(), {}, meta);

    expect(updated.surfaces.rules.graceMargin).toBe(150);
    expect(updated.surfaces.current.graceMargin).toBe(60);
  });

  it('throws when a surface matched zero files', () => {
    expect(() =>
      computeUpdatedLinesBaseline(measured({ current: { lines: 0, fileCount: 0 } }), {}, meta)
    ).toThrow('surface "current" matched zero files');
  });
});

describe('getLinesConfigFingerprint', () => {
  it('contains exactly the measurement-affecting inputs', () => {
    // The fingerprint IS the drift contract: implementation version, the
    // surface set, and each surface's glob. Adding a surface or moving a
    // glob must invalidate baselines.
    expect(getLinesConfigFingerprint()).toEqual({
      implVersion: LINES_IMPL_VERSION,
      surfaces: ['rules', 'current'],
      globs: {
        rules: '.claude/rules/*.md',
        current: 'CURRENT.md',
      },
    });
  });
});

describe('runLinesCheck CLI shell — decay guards', () => {
  // WHY.md names three decay detectors: tool rot (covered by the canary),
  // hollow measurements (covered above via the zero-file evaluation), and
  // config drift. These exercise the drift + missing-baseline branches
  // through the actual shell, noFail-style, so the guards are proven to
  // fire rather than merely exist.

  async function withQuietTmpDir(run: (tmp: string) => Promise<void>): Promise<void> {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await withTmpDir(run);
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
    }
  }

  it('fails on baseline configHash drift', async () => {
    await withQuietTmpDir(async tmp => {
      const { writeFile } = await import('node:fs/promises');
      const { join } = await import('node:path');
      const baselinePath = join(tmp, 'baseline.json');
      await writeFile(
        baselinePath,
        JSON.stringify({
          surfaces: { rules: { lines: 2000, graceMargin: 150 } },
          // A hash that cannot match the current fingerprint — simulates a
          // baseline captured under different surface config.
          meta: buildBaselineMeta('lines-check/stale', 'stalehash000'),
        })
      );

      const status = runLinesCheck({ rootDir: tmp, baseline: baselinePath, noFail: true });

      expect(status).toBe('fail');
      const errors = vi.mocked(console.error).mock.calls.flat().join(' ');
      expect(errors).toContain('meta drift');
      expect(errors).toContain('lines:update-baseline');
    });
  });

  it('fails when the baseline file is missing', async () => {
    await withQuietTmpDir(async tmp => {
      const { join } = await import('node:path');

      const status = runLinesCheck({
        rootDir: tmp,
        baseline: join(tmp, 'does-not-exist.json'),
        noFail: true,
      });

      expect(status).toBe('fail');
      const errors = vi.mocked(console.error).mock.calls.flat().join(' ');
      expect(errors).toContain('baseline not found');
    });
  });
});
