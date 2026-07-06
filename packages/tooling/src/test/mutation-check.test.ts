/**
 * Tests for the mutation-score ratchet.
 *
 * The pure pieces (score arithmetic, ratchet evaluation, baseline update)
 * are tested directly; the CLI shell is exercised end-to-end against the
 * audit-canary fixture in canary.test.ts (deliberate below-floor report).
 */

import { describe, it, expect, vi } from 'vitest';
import {
  computeMutationScore,
  evaluateMutationScores,
  parseMutationBaseline,
  computeUpdatedMutationBaseline,
  MUTATED_PACKAGES,
  getMutationConfigFingerprint,
  runMutationCheck,
  MUTATION_IMPL_VERSION,
  type StrykerReport,
  type MutationBaseline,
} from './mutation-check.js';
import { buildBaselineMeta, hashConfigSlice } from '../audits/baseline-meta.js';

function report(statuses: string[]): StrykerReport {
  return { files: { 'src/x.ts': { mutants: statuses.map(status => ({ status })) } } };
}

function baseline(packages: MutationBaseline['packages']): MutationBaseline {
  return { version: 1, lastUpdated: '2026-01-01T00:00:00.000Z', packages };
}

describe('computeMutationScore', () => {
  it('buckets statuses per Stryker score arithmetic', () => {
    const result = computeMutationScore(
      report([
        'Killed',
        'Killed',
        'Timeout', // detected: 3
        'Survived',
        'NoCoverage', // undetected: 2
        'Ignored', // excluded
        'CompileError', // invalid, excluded
      ])
    );

    expect(result).toEqual({
      score: 60, // 3 / (3 + 2)
      detected: 3,
      undetected: 2,
      ignored: 1,
      invalid: 1,
    });
  });

  it('rounds to two decimal places', () => {
    // 1 detected / 3 valid = 33.333…%
    const result = computeMutationScore(report(['Killed', 'Survived', 'Survived']));
    expect(result.score).toBe(33.33);
  });

  it('scores 100 when nothing is measurable (all ignored)', () => {
    expect(computeMutationScore(report(['Ignored', 'Ignored'])).score).toBe(100);
  });
});

describe('evaluateMutationScores', () => {
  const pkgBaseline = baseline({ 'config-resolver': { score: 95, graceMargin: 1 } });

  it('passes at or above the floor (baseline − grace)', () => {
    // 19 killed / 20 valid = 95 — exactly at the baseline (floor is 94).
    const statuses = [...Array.from({ length: 19 }, () => 'Killed'), 'Survived'];
    const outcome = evaluateMutationScores(
      { 'config-resolver': computeMutationScore(report(statuses)) },
      pkgBaseline
    );

    expect(outcome.status).toBe('ok');
    expect(outcome.failures).toEqual([]);
  });

  it('fails when a report contains no measurable mutants — a hollow report is not a pass', () => {
    // All-ignored/invalid means mutation testing effectively did not run;
    // the pure score defaults to 100, so the evaluator must catch it.
    const outcome = evaluateMutationScores(
      { 'config-resolver': computeMutationScore(report(['Ignored', 'Ignored', 'CompileError'])) },
      pkgBaseline
    );

    expect(outcome.status).toBe('fail');
    expect(outcome.failures[0]).toContain('no measurable mutants');
    expect(outcome.failures[0]).toContain('2 ignored, 1 invalid');
  });

  it('fails below the floor', () => {
    // 9/10 = 90 < floor 94
    const outcome = evaluateMutationScores(
      {
        'config-resolver': computeMutationScore(
          report([
            'Killed',
            'Killed',
            'Killed',
            'Killed',
            'Killed',
            'Killed',
            'Killed',
            'Killed',
            'Killed',
            'Survived',
          ])
        ),
      },
      pkgBaseline
    );

    expect(outcome.status).toBe('fail');
    expect(outcome.failures[0]).toContain('config-resolver');
    expect(outcome.failures[0]).toContain('fell below the floor 94');
  });

  it('fails when a tracked package has no report — silence is not passing', () => {
    const outcome = evaluateMutationScores({ 'config-resolver': null }, pkgBaseline);

    expect(outcome.status).toBe('fail');
    expect(outcome.failures[0]).toContain('no mutation report found');
  });
});

describe('parseMutationBaseline', () => {
  it('accepts a well-formed baseline', () => {
    const parsed = parseMutationBaseline(
      JSON.stringify(baseline({ 'config-resolver': { score: 96.5, graceMargin: 1 } })),
      'x.json'
    );
    expect(parsed.packages['config-resolver'].score).toBe(96.5);
  });

  it('rejects a baseline without packages', () => {
    expect(() => parseMutationBaseline('{"version":1}', 'x.json')).toThrow('missing "packages"');
  });

  it('rejects a package entry without numeric score', () => {
    expect(() =>
      parseMutationBaseline('{"packages":{"config-resolver":{"graceMargin":1}}}', 'x.json')
    ).toThrow('needs numeric score+graceMargin');
  });
});

describe('computeUpdatedMutationBaseline', () => {
  const meta = buildBaselineMeta(
    `mutation-check/${MUTATION_IMPL_VERSION}`,
    hashConfigSlice(getMutationConfigFingerprint())
  );

  /** Every tracked package needs a report for update — fill the rest at 100%. */
  function scoresForAll(overrides: Record<string, ReturnType<typeof computeMutationScore>>) {
    return Object.fromEntries(
      MUTATED_PACKAGES.map(name => [
        name,
        overrides[name] ?? computeMutationScore(report(['Killed'])),
      ])
    );
  }

  it('writes the measured score and preserves the previous grace margin + notes', () => {
    const previous: Partial<MutationBaseline> = {
      version: 2,
      notes: 'keep me',
      packages: { 'config-resolver': { score: 90, graceMargin: 2.5 } },
    };
    const scores = scoresForAll({
      'config-resolver': computeMutationScore(report(['Killed', 'Survived'])),
    });

    const updated = computeUpdatedMutationBaseline(scores, previous, meta, new Date(0));

    expect(updated.packages['config-resolver']).toEqual({ score: 50, graceMargin: 2.5 });
    expect(updated.notes).toBe('keep me');
    expect(updated.version).toBe(2);
    expect(updated.meta).toBe(meta);
  });

  it('applies the default grace margin for a newly-tracked package', () => {
    const scores = scoresForAll({});

    const updated = computeUpdatedMutationBaseline(scores, {}, meta);

    expect(updated.packages['config-resolver'].graceMargin).toBe(1);
  });

  it('throws when a tracked package has no report', () => {
    const scores = { ...scoresForAll({}), 'config-resolver': null };
    expect(() => computeUpdatedMutationBaseline(scores, {}, meta)).toThrow(
      'no mutation report for "config-resolver"'
    );
  });
});

describe('getMutationConfigFingerprint', () => {
  it('contains exactly the measurement-affecting inputs', () => {
    // The fingerprint IS the drift contract: implementation version, the
    // expected ignorer set, and the mutated-package list. Adding a package
    // or dropping the ignorer must invalidate baselines.
    expect(getMutationConfigFingerprint()).toEqual({
      implVersion: MUTATION_IMPL_VERSION,
      ignorers: ['logger-calls', 'observability-options'],
      packages: [...MUTATED_PACKAGES],
    });
  });
});

describe('runMutationCheck CLI shell — decay guards', () => {
  // WHY.md names three decay detectors: tool rot (covered by the canary),
  // silent skips (covered above via the missing-report evaluation), and
  // config drift. These exercise the drift + missing-baseline branches
  // through the actual shell, noFail-style, so the guards are proven to
  // fire rather than merely exist.

  async function withTmpDir(run: (tmp: string) => Promise<void>): Promise<void> {
    const { mkdtemp, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const tmp = await mkdtemp(join(tmpdir(), 'mutation-check-test-'));
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await run(tmp);
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
      await rm(tmp, { recursive: true, force: true });
    }
  }

  it('fails on baseline configHash drift', async () => {
    await withTmpDir(async tmp => {
      const { writeFile } = await import('node:fs/promises');
      const { join } = await import('node:path');
      const baselinePath = join(tmp, 'baseline.json');
      await writeFile(
        baselinePath,
        JSON.stringify({
          version: 1,
          lastUpdated: '2026-01-01T00:00:00.000Z',
          packages: { 'config-resolver': { score: 95, graceMargin: 1 } },
          // A hash that cannot match the current fingerprint — simulates a
          // baseline captured under different mutation config.
          meta: buildBaselineMeta('mutation-check/stale', 'stalehash000'),
        })
      );

      const status = runMutationCheck({ rootDir: tmp, baseline: baselinePath, noFail: true });

      expect(status).toBe('fail');
      const errors = vi.mocked(console.error).mock.calls.flat().join(' ');
      expect(errors).toContain('meta drift');
      expect(errors).toContain('mutation:update-baseline');
    });
  });

  it('fails when the baseline file is missing', async () => {
    await withTmpDir(async tmp => {
      const { join } = await import('node:path');

      const status = runMutationCheck({
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
