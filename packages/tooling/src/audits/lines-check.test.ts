/**
 * Tests for the always-loaded context ratchet: baseline parsing, budget
 * evaluation across both dimensions, and the baseline refresh.
 *
 * The surface definitions and their measurement are tested in
 * `lines-surfaces.test.ts`; everything here states its measurements as plain
 * fixtures, which is what the module split buys.
 */

import { describe, it, expect, vi } from 'vitest';
import chalk from 'chalk';
import {
  evaluateSurfaceBudgets,
  parseLinesBaseline,
  computeUpdatedLinesBaseline,
  runLinesCheck,
  runLinesUpdateBaseline,
  type LinesBaseline,
  type LinesCheckOutcome,
} from './lines-check.js';
import {
  getLinesConfigFingerprint,
  measureSurfaces,
  LINES_IMPL_VERSION,
  DIMENSION_NAMES,
  DEFAULT_GRACE_MARGINS,
  DEFAULT_BYTES_GRACE_MARGINS,
  type MeasuredSurfaces,
} from './lines-surfaces.js';
import { buildBaselineMeta, hashConfigSlice } from './baseline-meta.js';

function measured(overrides: Partial<MeasuredSurfaces> = {}): MeasuredSurfaces {
  return {
    rules: { lines: 100, bytes: 8000, fileCount: 3 },
    current: { lines: 20, bytes: 7000, fileCount: 1 },
    skills: { lines: 50, bytes: 3000, fileCount: 2 },
    ...overrides,
  };
}

/** Pull one dimension's evaluation out of an outcome, for readable assertions. */
function dim(
  outcome: LinesCheckOutcome,
  surface: string,
  dimension: string
): { value: number | null; limit: number | null } {
  const found = outcome.surfaces
    .find(s => s.name === surface)
    ?.dimensions.find(d => d.dimension === dimension);
  if (found === undefined) {
    throw new Error(`no ${dimension} evaluation for surface ${surface}`);
  }
  return found;
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

describe('evaluateSurfaceBudgets', () => {
  const budgets = baseline({
    rules: { lines: 100, graceMargin: 10, bytes: 8000, bytesGraceMargin: 500 },
    current: { lines: 20, graceMargin: 5, bytes: 7000, bytesGraceMargin: 400 },
    skills: { lines: 50, graceMargin: 5, bytes: 3000, bytesGraceMargin: 200 },
  });

  it('passes at or below the limit (baseline + grace) on both dimensions', () => {
    const outcome = evaluateSurfaceBudgets(
      measured({
        rules: { lines: 110, bytes: 8500, fileCount: 3 },
        current: { lines: 25, bytes: 7400, fileCount: 1 },
      }),
      budgets
    );

    expect(outcome.status).toBe('ok');
    expect(outcome.failures).toEqual([]);
  });

  it('fails when a surface exceeds its line limit', () => {
    const outcome = evaluateSurfaceBudgets(
      measured({ rules: { lines: 111, bytes: 8000, fileCount: 3 } }),
      budgets
    );

    expect(outcome.status).toBe('fail');
    expect(outcome.failures[0]).toContain('rules');
    expect(outcome.failures[0]).toContain('111 lines exceeds the limit 110');
  });

  it('fails on bytes even when lines are comfortably under budget', () => {
    // THE case the dimension was added for. CURRENT.md sat at 96/97 lines —
    // "comfortable" — while carrying a fifth of the rules surface's bytes.
    // A dense rewrite that halves the line count while growing the payload is
    // exactly what the line ratchet cannot see.
    const outcome = evaluateSurfaceBudgets(
      measured({ current: { lines: 10, bytes: 9000, fileCount: 1 } }),
      budgets
    );

    expect(outcome.status).toBe('fail');
    expect(outcome.failures.join(' ')).toContain('9000 bytes exceeds the limit 7400');
    expect(dim(outcome, 'current', 'lines').value).toBe(10);
  });

  it('reports both dimensions for every surface, pass or fail', () => {
    const outcome = evaluateSurfaceBudgets(measured(), budgets);

    for (const surface of outcome.surfaces) {
      expect(surface.dimensions.map(d => d.dimension)).toEqual([...DIMENSION_NAMES]);
    }
  });

  it('fails when a surface matched zero files — a hollow measurement is not a pass', () => {
    // A moved .claude/rules directory would otherwise "measure" 0 and sail
    // under any budget; the evaluator must catch it on every dimension.
    const outcome = evaluateSurfaceBudgets(
      measured({ rules: { lines: 0, bytes: 0, fileCount: 0 } }),
      budgets
    );

    expect(outcome.status).toBe('fail');
    expect(outcome.failures[0]).toContain('matched zero files');
    expect(dim(outcome, 'rules', 'lines').value).toBeNull();
    expect(dim(outcome, 'rules', 'bytes').value).toBeNull();
  });

  it('fails when the baseline carries no byte budget for a measured surface', () => {
    // Reachable only past the drift check (a hand-edited baseline). An
    // ungated dimension must fail loudly rather than silently measure nothing.
    const outcome = evaluateSurfaceBudgets(
      measured(),
      baseline({ rules: { lines: 100, graceMargin: 10 } })
    );

    expect(outcome.status).toBe('fail');
    expect(outcome.failures.join(' ')).toContain('no bytes budget');
    expect(dim(outcome, 'rules', 'bytes').limit).toBeNull();
  });

  it('fails when the baseline tracks a surface the tool does not measure', () => {
    const outcome = evaluateSurfaceBudgets(
      measured(),
      baseline({ phantom: { lines: 10, graceMargin: 0, bytes: 1, bytesGraceMargin: 0 } })
    );

    expect(outcome.status).toBe('fail');
    // Assert over the whole set, not failures[0]: the canonical surfaces are
    // evaluated first now, so the phantom's failure is no longer the head.
    expect(outcome.failures.join(' ')).toContain('phantom');
    expect(outcome.failures.join(' ')).toContain('does not measure');
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

  it('accepts a pre-bytes baseline so the drift check can explain the refresh', () => {
    // Requiring bytes here would throw a shape error naming no remedy; the
    // configHash drift check names `lines:update-baseline` instead.
    const parsed = parseLinesBaseline(
      JSON.stringify(baseline({ rules: { lines: 2000, graceMargin: 150 } })),
      'x.json'
    );
    expect(parsed.surfaces.rules.bytes).toBeUndefined();
  });

  it('rejects a present-but-non-numeric bytes field', () => {
    expect(() =>
      parseLinesBaseline(
        '{"surfaces":{"rules":{"lines":1,"graceMargin":1,"bytes":"lots"}}}',
        'x.json'
      )
    ).toThrow('non-numeric bytes');
  });
});

describe('computeUpdatedLinesBaseline', () => {
  const meta = buildBaselineMeta(
    `lines-check/${LINES_IMPL_VERSION}`,
    hashConfigSlice(getLinesConfigFingerprint())
  );

  const previousBaseline = (): Partial<LinesBaseline> => ({
    notes: 'keep me',
    surfaces: {
      rules: { lines: 1800, graceMargin: 200, bytes: 150_000, bytesGraceMargin: 9000 },
      current: { lines: 30, graceMargin: 60, bytes: 6000, bytesGraceMargin: 400 },
    },
  });

  it('writes the measured counts and preserves previous grace margins + notes', () => {
    const updated = computeUpdatedLinesBaseline(measured(), previousBaseline(), meta);

    expect(updated.surfaces.rules).toEqual({
      lines: 100,
      graceMargin: 200,
      bytes: 8000,
      bytesGraceMargin: 9000,
    });
    expect(updated.surfaces.current).toEqual({
      lines: 20,
      graceMargin: 60,
      bytes: 7000,
      bytesGraceMargin: 400,
    });
    expect(updated.notes).toBe('keep me');
    expect(updated.meta).toBe(meta);
  });

  it('applies the default grace margins for newly-tracked surfaces', () => {
    const updated = computeUpdatedLinesBaseline(measured(), {}, meta);

    expect(updated.surfaces.rules.graceMargin).toBe(150);
    expect(updated.surfaces.rules.bytesGraceMargin).toBe(12_000);
    // 20, not the older 60: CURRENT.md's effective ceiling had been 97 while it
    // measured 96, so a refresh at the old margin would have handed it 60 lines
    // of new headroom as a side effect of adding the bytes dimension.
    expect(updated.surfaces.current.graceMargin).toBe(20);
    expect(updated.surfaces.current.bytesGraceMargin).toBe(4000);
  });

  it('backfills bytes onto a pre-bytes baseline without disturbing line margins', () => {
    const updated = computeUpdatedLinesBaseline(
      measured(),
      { surfaces: { rules: { lines: 1800, graceMargin: 200 } } },
      meta
    );

    expect(updated.surfaces.rules.bytes).toBe(8000);
    expect(updated.surfaces.rules.bytesGraceMargin).toBe(12_000);
    expect(updated.surfaces.rules.graceMargin).toBe(200);
  });

  it('throws when a surface matched zero files', () => {
    expect(() =>
      computeUpdatedLinesBaseline(
        measured({ current: { lines: 0, bytes: 0, fileCount: 0 } }),
        {},
        meta
      )
    ).toThrow('surface "current" matched zero files');
  });

  describe('scoped refresh (--surface)', () => {
    it('rewrites only the named surface and leaves the other verbatim', () => {
      // The reason the flag exists: an all-or-nothing refresh wanted for a
      // TRIMMED surface also writes a LOOSER budget for one that grew, in a
      // single commit that reads as bookkeeping.
      const updated = computeUpdatedLinesBaseline(measured(), previousBaseline(), meta, 'rules');

      expect(updated.surfaces.rules.lines).toBe(100);
      expect(updated.surfaces.rules.bytes).toBe(8000);
      expect(updated.surfaces.current).toEqual({
        lines: 30,
        graceMargin: 60,
        bytes: 6000,
        bytesGraceMargin: 400,
      });
    });

    it('does not throw on a hollow measurement of an UNTARGETED surface', () => {
      // Nothing is written for it, so a broken path elsewhere must not block a
      // legitimate scoped refresh — `lines:check` is what reports that.
      expect(() =>
        computeUpdatedLinesBaseline(
          measured({ current: { lines: 0, bytes: 0, fileCount: 0 } }),
          previousBaseline(),
          meta,
          'rules'
        )
      ).not.toThrow();
    });

    it('still throws on a hollow measurement of the TARGETED surface', () => {
      expect(() =>
        computeUpdatedLinesBaseline(
          measured({ current: { lines: 0, bytes: 0, fileCount: 0 } }),
          previousBaseline(),
          meta,
          'current'
        )
      ).toThrow('surface "current" matched zero files');
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

describe('runLinesUpdateBaseline CLI shell', () => {
  // The CLI shell needs its own coverage: the pure `computeUpdatedLinesBaseline`
  // beside it can be exercised with plain fixtures, so it attracts the tests —
  // while the shell's own branching (the scoped-refresh print path, the
  // stray-entry path) reads as too thin to test and is where the defects
  // actually landed. Exercised here against a real temp baseline file, the way
  // the canary exercises the check.

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

  async function seedSurfaces(tmp: string): Promise<void> {
    const { mkdir, writeFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    await mkdir(join(tmp, '.claude/rules'), { recursive: true });
    await mkdir(join(tmp, '.claude/skills/example'), { recursive: true });
    await writeFile(join(tmp, '.claude/rules/00-a.md'), 'one\ntwo\n');
    await writeFile(join(tmp, '.claude/skills/example/SKILL.md'), 'one\n');
    await writeFile(join(tmp, 'CURRENT.md'), 'status\n');
  }

  it('scoped refresh from an empty baseline writes ONLY the named surface, and the check catches the gap', async () => {
    // The bug: a scoped refresh spread `previous.surfaces` and skipped the
    // untargeted surface, so bootstrapping with `--surface rules` produced a
    // baseline with NO entry for `current` — and the check iterated the
    // baseline, so that surface went silently ungated.
    await withQuietTmpDir(async tmp => {
      const { readFile } = await import('node:fs/promises');
      const { join } = await import('node:path');
      const baselinePath = join(tmp, 'baseline.json');
      await seedSurfaces(tmp);

      runLinesUpdateBaseline({ rootDir: tmp, baseline: baselinePath, surface: 'rules' });
      const written = JSON.parse(await readFile(baselinePath, 'utf-8')) as LinesBaseline;

      // Deterministic, so assert it directly: a scoped refresh writes ONLY the
      // named surface, so `current` is absent from the write — and the check is
      // what must then catch the gap. A conditional here would pass whichever
      // way either half changed, which is the failure this suite keeps finding.
      expect(written.surfaces.rules.bytes).toBe(8);
      expect(written.surfaces.current).toBeUndefined();

      const outcome = evaluateSurfaceBudgets(measureSurfaces(tmp), written);
      expect(outcome.status).toBe('fail');
      expect(outcome.failures.join(' ')).toContain('the baseline does not track');
    });
  });

  it('scoped --surface skills refresh over a rules+current-only baseline writes ONLY the skills entry, untouched elsewhere', async () => {
    // The skills surface's own bootstrap case: a baseline that predates it
    // (rules + current only) must gain a skills entry with the DEFAULT
    // margins (no prior entry to carry forward), while the two existing
    // entries are carried through byte-for-byte — not recomputed from the
    // live measurement, which would silently discard any prior manual tuning.
    await withQuietTmpDir(async tmp => {
      const { readFile, writeFile } = await import('node:fs/promises');
      const { join } = await import('node:path');
      const baselinePath = join(tmp, 'baseline.json');
      await seedSurfaces(tmp);

      const originalRules = { lines: 999, graceMargin: 111, bytes: 8888, bytesGraceMargin: 222 };
      const originalCurrent = { lines: 888, graceMargin: 11, bytes: 7777, bytesGraceMargin: 22 };
      await writeFile(
        baselinePath,
        JSON.stringify({ surfaces: { rules: originalRules, current: originalCurrent } })
      );

      runLinesUpdateBaseline({ rootDir: tmp, baseline: baselinePath, surface: 'skills' });
      const written = JSON.parse(await readFile(baselinePath, 'utf-8')) as LinesBaseline;

      expect(written.surfaces.rules).toEqual(originalRules);
      expect(written.surfaces.current).toEqual(originalCurrent);

      const measuredSkills = measureSurfaces(tmp).skills;
      expect(written.surfaces.skills).toEqual({
        lines: measuredSkills.lines,
        graceMargin: DEFAULT_GRACE_MARGINS.skills,
        bytes: measuredSkills.bytes,
        bytesGraceMargin: DEFAULT_BYTES_GRACE_MARGINS.skills,
      });
      // A scoped refresh still stamps fresh meta even though only one entry
      // moved — the config it was captured under is identical either way.
      expect(written.meta).toBeDefined();
    });
  });

  it('prunes a stray surface entry on an unscoped refresh instead of throwing', async () => {
    // Pre-PR behaviour, preserved: an unscoped refresh rebuilds from nothing,
    // so an entry for a surface no longer tracked is dropped. The spread that
    // fixed scoped refreshes had made this path throw `Unknown surface`, whose
    // message would have misdirected the reader to their --surface argument.
    await withQuietTmpDir(async tmp => {
      const { writeFile, readFile } = await import('node:fs/promises');
      const { join } = await import('node:path');
      const baselinePath = join(tmp, 'baseline.json');
      await seedSurfaces(tmp);
      await writeFile(
        baselinePath,
        JSON.stringify({
          surfaces: {
            rules: { lines: 1, graceMargin: 1, bytes: 1, bytesGraceMargin: 1 },
            current: { lines: 1, graceMargin: 1, bytes: 1, bytesGraceMargin: 1 },
            retired: { lines: 99, graceMargin: 9, bytes: 99, bytesGraceMargin: 9 },
          },
        })
      );

      expect(() => runLinesUpdateBaseline({ rootDir: tmp, baseline: baselinePath })).not.toThrow();

      const written = JSON.parse(await readFile(baselinePath, 'utf-8')) as LinesBaseline;
      expect(written.surfaces.retired).toBeUndefined();
      expect(Object.keys(written.surfaces).sort()).toEqual(['current', 'rules', 'skills']);
    });
  });

  it('warns at bootstrap time when a scoped refresh leaves surfaces untracked', async () => {
    // The gap otherwise surfaces one command later, at the next lines:check.
    // Warning here puts it at the point of the mistake.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await withTmpDir(async tmp => {
        const { mkdir, writeFile } = await import('node:fs/promises');
        const { join } = await import('node:path');
        await mkdir(join(tmp, '.claude/rules'), { recursive: true });
        await writeFile(join(tmp, '.claude/rules/00-a.md'), 'one\n');
        await writeFile(join(tmp, 'CURRENT.md'), 'status\n');

        runLinesUpdateBaseline({
          rootDir: tmp,
          baseline: join(tmp, 'baseline.json'),
          surface: 'rules',
          dryRun: true,
        });

        const warnings = vi.mocked(console.warn).mock.calls.flat().join(' ');
        expect(warnings).toContain('current');
        expect(warnings).toContain('stay untracked');
      });
    } finally {
      warnSpy.mockRestore();
      logSpy.mockRestore();
    }
  });

  it('stays quiet when the baseline already tracks every surface', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await withTmpDir(async tmp => {
        const { mkdir, writeFile } = await import('node:fs/promises');
        const { join } = await import('node:path');
        await mkdir(join(tmp, '.claude/rules'), { recursive: true });
        await writeFile(join(tmp, '.claude/rules/00-a.md'), 'one\n');
        await writeFile(join(tmp, 'CURRENT.md'), 'status\n');
        await writeFile(
          join(tmp, 'baseline.json'),
          JSON.stringify({
            surfaces: {
              rules: { lines: 1, graceMargin: 1, bytes: 4, bytesGraceMargin: 1 },
              current: { lines: 1, graceMargin: 1, bytes: 7, bytesGraceMargin: 1 },
              skills: { lines: 1, graceMargin: 1, bytes: 4, bytesGraceMargin: 1 },
            },
          })
        );

        runLinesUpdateBaseline({
          rootDir: tmp,
          baseline: join(tmp, 'baseline.json'),
          surface: 'rules',
          dryRun: true,
        });

        expect(vi.mocked(console.warn).mock.calls).toHaveLength(0);
      });
    } finally {
      warnSpy.mockRestore();
      logSpy.mockRestore();
    }
  });

  it('prints all three delta shapes: new, shrunk, and grown', async () => {
    // The refresh report's deltas are the operator's only signal that a
    // "routine" baseline bump is actually LOOSENING a budget. Asserted here
    // because nothing else asserts them — the other CLI tests read the written
    // file and the warning, never the printed lines.
    const captured: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      captured.push(args.map(a => String(a)).join(' '));
    });
    try {
      await withTmpDir(async tmp => {
        const { mkdir, writeFile } = await import('node:fs/promises');
        const { join } = await import('node:path');
        await mkdir(join(tmp, '.claude/rules'), { recursive: true });
        await mkdir(join(tmp, '.claude/skills/example'), { recursive: true });
        // rules measures 3 lines / 12 bytes; current measures 1 line / 7 bytes.
        await writeFile(join(tmp, '.claude/rules/00-a.md'), 'one\ntwo\nsix\n');
        await writeFile(join(tmp, 'CURRENT.md'), 'status\n');
        await writeFile(join(tmp, '.claude/skills/example/SKILL.md'), 'one\n');
        const baselinePath = join(tmp, 'baseline.json');
        await writeFile(
          baselinePath,
          JSON.stringify({
            surfaces: {
              // rules SHRANK (10 -> 3); current GREW (0 -> 1) and has no
              // recorded bytes at all, so its byte delta is the (new) shape.
              rules: { lines: 10, graceMargin: 1, bytes: 40, bytesGraceMargin: 1 },
              current: { lines: 0, graceMargin: 1 },
            },
          })
        );

        runLinesUpdateBaseline({ rootDir: tmp, baseline: baselinePath, dryRun: true });
        const output = captured.join('\n');

        expect(output).toContain('3 lines (-7)');
        expect(output).toContain('12 bytes (-28)');
        expect(output).toContain('1 lines (+1)');
        expect(output).toContain('7 bytes (new)');
      });
    } finally {
      logSpy.mockRestore();
    }
  });

  it('rejects an unknown --surface without writing anything', async () => {
    await withQuietTmpDir(async tmp => {
      const { join } = await import('node:path');
      const { existsSync } = await import('node:fs');
      const baselinePath = join(tmp, 'baseline.json');
      await seedSurfaces(tmp);

      expect(() =>
        runLinesUpdateBaseline({ rootDir: tmp, baseline: baselinePath, surface: 'rulez' })
      ).toThrow('Unknown surface');
      expect(existsSync(baselinePath)).toBe(false);
    });
  });

  it('--dry-run reports without writing the file', async () => {
    await withQuietTmpDir(async tmp => {
      const { join } = await import('node:path');
      const { existsSync } = await import('node:fs');
      const baselinePath = join(tmp, 'baseline.json');
      await seedSurfaces(tmp);

      runLinesUpdateBaseline({ rootDir: tmp, baseline: baselinePath, dryRun: true });
      expect(existsSync(baselinePath)).toBe(false);
    });
  });
});

describe('evaluateSurfaceBudgets — a canonical surface missing from the baseline', () => {
  it('fails loudly rather than skipping it', () => {
    // Iterating the baseline alone meant an absent surface was never checked:
    // no failure, no warning, nothing in the report — a surface completely
    // ungated while everything looked healthy.
    const outcome = evaluateSurfaceBudgets(
      measured(),
      baseline({ rules: { lines: 100, graceMargin: 10, bytes: 8000, bytesGraceMargin: 500 } })
    );

    expect(outcome.status).toBe('fail');
    expect(outcome.failures.join(' ')).toContain('current');
    expect(outcome.failures.join(' ')).toContain('the baseline does not track');
    expect(outcome.surfaces.map(s => s.name)).toContain('current');
  });
});

describe('per-dimension report lines name the REAL reason', () => {
  // Three distinct classes null the same three fields, so a formatter deducing
  // the reason from the shape prints one answer for all of them — and it is
  // wrong for two. These assert the printed text, which nothing else did: the
  // failures block was covered, the per-dimension summary lines were not.

  async function captureCheck(
    files: Record<string, string>,
    baselineSurfaces: LinesBaseline['surfaces']
  ): Promise<string> {
    const { mkdtemp, rm, mkdir, writeFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join, dirname } = await import('node:path');
    const tmp = await mkdtemp(join(tmpdir(), 'lines-report-'));
    const captured: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      captured.push(args.map(a => String(a)).join(' '));
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      for (const [rel, content] of Object.entries(files)) {
        await mkdir(join(tmp, dirname(rel)), { recursive: true });
        await writeFile(join(tmp, rel), content);
      }
      const baselinePath = join(tmp, 'baseline.json');
      await writeFile(
        baselinePath,
        JSON.stringify({
          surfaces: baselineSurfaces,
          meta: buildBaselineMeta(
            `lines-check/${LINES_IMPL_VERSION}`,
            hashConfigSlice(getLinesConfigFingerprint())
          ),
        })
      );
      runLinesCheck({ rootDir: tmp, baseline: baselinePath, noFail: true });
      return captured.join('\n');
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
      await rm(tmp, { recursive: true, force: true });
    }
  }

  const fullBudget = { lines: 10, graceMargin: 5, bytes: 100, bytesGraceMargin: 50 };

  it('says "glob matched zero files" when the surface is gone, not "no budget"', async () => {
    // The baseline DOES carry a budget here — reporting otherwise sends the
    // reader to refresh a baseline that is fine, when a path actually moved.
    const output = await captureCheck(
      { 'CURRENT.md': 'status\n' },
      { rules: fullBudget, current: fullBudget }
    );

    expect(output).toContain('glob matched zero files');
    expect(output).not.toContain('rules: lines: no budget in baseline');
  });

  it('names the missing-budget class specifically, not the generic fallback', async () => {
    // The fourth unevaluated class, and the only one that does NOT route
    // through unmeasurable() — so it is the one that silently degrades to the
    // generic label. Nothing asserted this line, which is how it stayed
    // generic while the other three were fixed.
    const output = await captureCheck(
      { '.claude/rules/00-a.md': 'x\n', 'CURRENT.md': 'status\n' },
      {
        rules: { lines: 1, graceMargin: 1 },
        current: { lines: 1, graceMargin: 1, bytes: 7, bytesGraceMargin: 1 },
      }
    );

    expect(output).toContain('baseline carries no bytes budget');
    expect(output).not.toContain('bytes: not evaluated');
  });

  it('prints the derived token estimate on a passing byte line', async () => {
    // The one piece of new report formatting with no test touching it. The
    // estimate never gates, but it is the number a reader actually weighs
    // against a session budget, so a silent change to it matters.
    const output = await captureCheck(
      { '.claude/rules/00-a.md': 'x\n'.repeat(1000), 'CURRENT.md': 'status\n' },
      {
        rules: { lines: 1000, graceMargin: 50, bytes: 2000, bytesGraceMargin: 100 },
        current: { lines: 1, graceMargin: 1, bytes: 7, bytesGraceMargin: 1 },
      }
    );

    // 2000 bytes / 4 / 1000 -> rounds to 1k; the line carries value, estimate,
    // limit and baseline together.
    // One formatter across gate and ranking: 2000 bytes is ~500 estimated
    // tokens, which the old whole-thousand rounding rendered as "1k".
    expect(output).toContain('2000 bytes ≈500 tok (limit 2100, baseline 2000)');
    expect(output).toContain('1000 lines (limit 1050, baseline 1000)');
  });

  it('says "not tracked by the baseline" for a canonical surface with no entry', async () => {
    const output = await captureCheck(
      { '.claude/rules/00-a.md': 'x\n', 'CURRENT.md': 'status\n' },
      { rules: fullBudget }
    );

    expect(output).toContain('not tracked by the baseline');
  });
});

describe('runLinesCheck --breakdown wiring', () => {
  /**
   * Run the shell with console captured and colour forced off, so the
   * assertions compare text rather than whatever chalk decided the runner's
   * terminal supports.
   */
  async function captureShell(options: {
    tmp: string;
    baseline: string;
    breakdown?: boolean;
  }): Promise<string> {
    const lines: string[] = [];
    const record = (...args: unknown[]): void => {
      lines.push(args.map(String).join(' '));
    };
    const priorLevel = chalk.level;
    chalk.level = 0;
    const logSpy = vi.spyOn(console, 'log').mockImplementation(record);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(record);
    try {
      runLinesCheck({
        rootDir: options.tmp,
        baseline: options.baseline,
        breakdown: options.breakdown,
        noFail: true,
      });
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
      chalk.level = priorLevel;
    }
    return lines.join('\n');
  }

  /** A tmp repo with both surfaces present and a matching fresh baseline. */
  async function seedRepo(tmp: string): Promise<string> {
    const { mkdir, writeFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    await mkdir(join(tmp, '.claude/rules'), { recursive: true });
    await mkdir(join(tmp, '.claude/skills/example'), { recursive: true });
    await writeFile(join(tmp, '.claude/rules/00-a.md'), 'rule\n');
    await writeFile(join(tmp, 'CURRENT.md'), 'status\n');
    await writeFile(join(tmp, '.claude/skills/example/SKILL.md'), 'skill\n');
    const baselinePath = join(tmp, 'baseline.json');
    const m = measureSurfaces(tmp);
    await writeFile(
      baselinePath,
      JSON.stringify({
        surfaces: {
          rules: {
            lines: m.rules.lines,
            graceMargin: 5,
            bytes: m.rules.bytes,
            bytesGraceMargin: 50,
          },
          current: {
            lines: m.current.lines,
            graceMargin: 5,
            bytes: m.current.bytes,
            bytesGraceMargin: 50,
          },
          skills: {
            lines: m.skills.lines,
            graceMargin: 5,
            bytes: m.skills.bytes,
            bytesGraceMargin: 50,
          },
        },
        meta: buildBaselineMeta(
          `lines-check/${LINES_IMPL_VERSION}`,
          hashConfigSlice(getLinesConfigFingerprint())
        ),
      })
    );
    return baselinePath;
  }

  it('prints the ranking only when asked', async () => {
    await withTmpDir(async tmp => {
      const baselinePath = await seedRepo(tmp);

      const withoutFlag = await captureShell({ tmp, baseline: baselinePath });
      const withFlag = await captureShell({ tmp, baseline: baselinePath, breakdown: true });

      expect(withoutFlag).not.toContain('Per-file ranking');
      expect(withFlag).toContain('Per-file ranking');
      expect(withFlag).toContain('.claude/rules/00-a.md');
      // The gate's own verdict still prints either way.
      expect(withoutFlag).toContain('within their budgets');
      expect(withFlag).toContain('within their budgets');
    });
  });

  // `runLinesCheck`'s contract names TWO broken-state exits where the ranking
  // must still print. Both are pinned, not just the one that was easiest to
  // build: the implementation satisfies them together today only because the
  // call sits outside every gate branch, and an edit that moved it inside
  // `runLinesCheckGate` would regress whichever case went unpinned in silence.

  it('still prints the ranking when the baseline is missing entirely', async () => {
    // A missing baseline is exactly when someone needs to see what the
    // surfaces weigh; withholding the diagnostic because the gate is
    // unusable would be backwards.
    await withTmpDir(async tmp => {
      const { mkdir, writeFile } = await import('node:fs/promises');
      const { join } = await import('node:path');
      await mkdir(join(tmp, '.claude/rules'), { recursive: true });
      await writeFile(join(tmp, '.claude/rules/00-a.md'), 'rule\n');

      const output = await captureShell({
        tmp,
        baseline: join(tmp, 'does-not-exist.json'),
        breakdown: true,
      });

      expect(output).toContain('baseline not found');
      expect(output).toContain('Per-file ranking');
    });
  });

  it('still prints the ranking when the baseline drifted out of config', async () => {
    // The other named broken-state exit: drift returns before any evaluation
    // happens, so the ranking is the only number the operator gets.
    await withTmpDir(async tmp => {
      const { mkdir, writeFile } = await import('node:fs/promises');
      const { join } = await import('node:path');
      await mkdir(join(tmp, '.claude/rules'), { recursive: true });
      await writeFile(join(tmp, '.claude/rules/00-a.md'), 'rule\n');
      const baselinePath = join(tmp, 'baseline.json');
      await writeFile(
        baselinePath,
        JSON.stringify({
          surfaces: { rules: { lines: 1, graceMargin: 0 } },
          meta: buildBaselineMeta('lines-check/stale', 'stalehash000'),
        })
      );

      const output = await captureShell({ tmp, baseline: baselinePath, breakdown: true });

      expect(output).toContain('meta drift');
      expect(output).toContain('Per-file ranking');
      expect(output).toContain('.claude/rules/00-a.md');
    });
  });
});
