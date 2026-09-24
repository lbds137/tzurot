/**
 * Tests for the hard instructions ceiling: `CLAUDE.md` + `.claude/rules/*.md`,
 * summed as `.length` (UTF-16 code units), against a fixed, non-baseline cap.
 *
 * Every measurement-touching case goes through the real filesystem (mkdtemp
 * fixtures), not a hand-built `charCounts` array, so a mutation inside
 * `measureInstructionChars` itself — reading the wrong file, summing bytes
 * instead of `.length`, dropping CLAUDE.md from the set — is caught here
 * rather than only in the pure evaluator.
 */

import { describe, it, expect, vi } from 'vitest';
import chalk from 'chalk';
import {
  INSTRUCTION_CHARS_CEILING,
  evaluateInstructionCeiling,
  measureInstructionChars,
  checkInstructionCeiling,
} from './lines-ceiling.js';
import {
  measureSurfaces,
  getLinesConfigFingerprint,
  LINES_IMPL_VERSION,
} from './lines-surfaces.js';
import { runLinesCheck } from './lines-check.js';
import { buildBaselineMeta, hashConfigSlice } from './baseline-meta.js';

async function withTmpDir(run: (tmp: string) => Promise<void>): Promise<void> {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const tmp = await mkdtemp(join(tmpdir(), 'lines-ceiling-test-'));
  try {
    await run(tmp);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

/** Write CLAUDE.md (optional) plus zero or more rules files under a tmp root. */
async function writeFixture(
  tmp: string,
  options: { claudeMd?: string; rulesFiles?: Record<string, string> }
): Promise<void> {
  const { mkdir, writeFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  if (options.claudeMd !== undefined) {
    await writeFile(join(tmp, 'CLAUDE.md'), options.claudeMd);
  }
  const rulesFiles = options.rulesFiles ?? {};
  if (Object.keys(rulesFiles).length > 0) {
    await mkdir(join(tmp, '.claude/rules'), { recursive: true });
    for (const [name, content] of Object.entries(rulesFiles)) {
      await writeFile(join(tmp, '.claude/rules', name), content);
    }
  }
}

describe('evaluateInstructionCeiling — pure comparison', () => {
  it('passes exactly at the ceiling and fails one over', () => {
    expect(evaluateInstructionCeiling([60, 40], 100).failure).toBeNull();
    expect(evaluateInstructionCeiling([60, 41], 100).failure).not.toBeNull();
  });

  it('uses the exported constant as the default ceiling', () => {
    const atDefault = evaluateInstructionCeiling([INSTRUCTION_CHARS_CEILING]);
    expect(atDefault.ceiling).toBe(INSTRUCTION_CHARS_CEILING);
    expect(atDefault.failure).toBeNull();

    const overDefault = evaluateInstructionCeiling([INSTRUCTION_CHARS_CEILING + 1]);
    expect(overDefault.failure).not.toBeNull();
  });

  it("names the total and the ceiling, and that lines:update-baseline can't raise it", () => {
    const outcome = evaluateInstructionCeiling([200], 100);
    expect(outcome.failure).toContain('200');
    expect(outcome.failure).toContain('100');
    expect(outcome.failure).toContain('lines:update-baseline');
    expect(outcome.failure).toContain('--breakdown');
  });
});

describe('checkInstructionCeiling — C1: totals at/over a small ceiling', () => {
  it('passes at exactly the ceiling', async () => {
    await withTmpDir(async tmp => {
      await writeFixture(tmp, {
        claudeMd: 'A'.repeat(50),
        rulesFiles: { '00-a.md': 'B'.repeat(50) },
      });

      const outcome = checkInstructionCeiling(tmp, 100);

      expect(outcome.total).toBe(100);
      expect(outcome.failure).toBeNull();
    });
  });

  it('fails one char over the ceiling', async () => {
    await withTmpDir(async tmp => {
      await writeFixture(tmp, {
        claudeMd: 'A'.repeat(51),
        rulesFiles: { '00-a.md': 'B'.repeat(50) },
      });

      const outcome = checkInstructionCeiling(tmp, 100);

      expect(outcome.total).toBe(101);
      expect(outcome.failure).not.toBeNull();
    });
  });
});

describe('checkInstructionCeiling — C2: rules alone pass, rules + CLAUDE.md fail', () => {
  it('fails only once CLAUDE.md is added to the sum', async () => {
    await withTmpDir(async tmp => {
      await writeFixture(tmp, { rulesFiles: { '00-a.md': 'B'.repeat(60) } });
      const rulesOnly = checkInstructionCeiling(tmp, 100);
      // Rules alone measures under the ceiling — but CLAUDE.md is missing,
      // which is its own hollow failure, so assert the SIZE claim on the
      // measurement directly rather than the ceiling verdict here.
      const { charCounts } = measureInstructionChars(tmp);
      expect(charCounts.reduce((a, b) => a + b, 0)).toBe(60);
      expect(rulesOnly.failure).not.toBeNull(); // hollow: CLAUDE.md missing

      await writeFixture(tmp, { claudeMd: 'C'.repeat(60) });
      const combined = checkInstructionCeiling(tmp, 100);

      expect(combined.total).toBe(120);
      expect(combined.failure).not.toBeNull();
    });
  });
});

describe('checkInstructionCeiling — C3: multibyte content, .length not bytes', () => {
  it('passes when UTF-8 bytes exceed the ceiling but .length does not', async () => {
    await withTmpDir(async tmp => {
      // Em dash: 1 UTF-16 code unit, 3 UTF-8 bytes.
      const emDashes = '—'.repeat(40);
      await writeFixture(tmp, {
        claudeMd: emDashes,
        rulesFiles: { '00-a.md': emDashes },
      });

      const byteTotal = Buffer.byteLength(emDashes, 'utf-8') * 2;
      expect(byteTotal).toBeGreaterThan(100); // the byte sum WOULD fail at this ceiling

      const outcome = checkInstructionCeiling(tmp, 100);

      expect(outcome.total).toBe(80); // 40 + 40 .length units
      expect(outcome.failure).toBeNull();
    });
  });
});

describe('checkInstructionCeiling — hollow measurement never passes at 0', () => {
  it('fails when CLAUDE.md is missing', async () => {
    await withTmpDir(async tmp => {
      await writeFixture(tmp, { rulesFiles: { '00-a.md': 'x' } });

      const outcome = checkInstructionCeiling(tmp);

      expect(outcome.total).toBe(0);
      expect(outcome.failure).toContain('CLAUDE.md');
    });
  });

  it('fails when the rules glob matches zero files', async () => {
    await withTmpDir(async tmp => {
      await writeFixture(tmp, { claudeMd: 'hello' });

      const outcome = checkInstructionCeiling(tmp);

      expect(outcome.total).toBe(0);
      expect(outcome.failure).toContain('.claude/rules');
      expect(outcome.failure).toContain('zero files');
    });
  });

  it('reports both reasons when both are hollow', async () => {
    await withTmpDir(async tmp => {
      const outcome = checkInstructionCeiling(tmp);

      expect(outcome.failure).toContain('CLAUDE.md');
      expect(outcome.failure).toContain('zero files');
    });
  });
});

describe('runLinesCheck wiring — the ceiling gates the CLI shell', () => {
  /** A tmp repo root with rules/current/skills sized to pass their own budgets. */
  async function seedPassingRepo(tmp: string, claudeMdChars: number): Promise<string> {
    const { mkdir, writeFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    await mkdir(join(tmp, '.claude/rules'), { recursive: true });
    await mkdir(join(tmp, '.claude/skills/example'), { recursive: true });
    await writeFile(join(tmp, '.claude/rules/00-a.md'), 'rule\n');
    await writeFile(join(tmp, 'CURRENT.md'), 'status\n');
    await writeFile(join(tmp, '.claude/skills/example/SKILL.md'), 'skill\n');
    await writeFile(join(tmp, 'CLAUDE.md'), 'x'.repeat(claudeMdChars));

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

  it('fails the gate when CLAUDE.md alone pushes the total over the ceiling', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await withTmpDir(async tmp => {
        // CLAUDE.md is 147001 chars; the tiny rules file adds a handful more,
        // so the total clears the 147000 ceiling on CLAUDE.md alone.
        const baselinePath = await seedPassingRepo(tmp, INSTRUCTION_CHARS_CEILING + 1);

        const status = runLinesCheck({ rootDir: tmp, baseline: baselinePath, noFail: true });

        expect(status).toBe('fail');
      });
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  it('passes the gate when every surface AND the ceiling are within budget', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await withTmpDir(async tmp => {
        const baselinePath = await seedPassingRepo(tmp, 100);

        const status = runLinesCheck({ rootDir: tmp, baseline: baselinePath, noFail: true });

        expect(status).toBe('ok');
      });
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  const UPDATE_BASELINE_HINT = 'Either trim the surface back under its budget';

  /** A tmp repo whose `rules` baseline entry is set impossibly low, so the
   * surface itself fails while CLAUDE.md stays tiny (ceiling passes). */
  async function seedSurfaceFailingRepo(tmp: string): Promise<string> {
    const { mkdir, writeFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    await mkdir(join(tmp, '.claude/rules'), { recursive: true });
    await mkdir(join(tmp, '.claude/skills/example'), { recursive: true });
    await writeFile(join(tmp, '.claude/rules/00-a.md'), 'x'.repeat(500) + '\n');
    await writeFile(join(tmp, 'CURRENT.md'), 'status\n');
    await writeFile(join(tmp, '.claude/skills/example/SKILL.md'), 'skill\n');
    await writeFile(join(tmp, 'CLAUDE.md'), 'small');

    const baselinePath = join(tmp, 'baseline.json');
    const m = measureSurfaces(tmp);
    await writeFile(
      baselinePath,
      JSON.stringify({
        surfaces: {
          rules: { lines: 1, graceMargin: 0, bytes: 1, bytesGraceMargin: 0 },
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

  it('omits the update-baseline hint on a ceiling-only failure', async () => {
    const priorLevel = chalk.level;
    chalk.level = 0;
    const output: string[] = [];
    const record = (...args: unknown[]): void => {
      output.push(args.map(String).join(' '));
    };
    const logSpy = vi.spyOn(console, 'log').mockImplementation(record);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(record);
    try {
      await withTmpDir(async tmp => {
        const baselinePath = await seedPassingRepo(tmp, INSTRUCTION_CHARS_CEILING + 1);

        const status = runLinesCheck({ rootDir: tmp, baseline: baselinePath, noFail: true });

        expect(status).toBe('fail');
        expect(output.join('\n')).not.toContain(UPDATE_BASELINE_HINT);
      });
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
      chalk.level = priorLevel;
    }
  });

  it('prints the update-baseline hint on a surface budget failure', async () => {
    const priorLevel = chalk.level;
    chalk.level = 0;
    const output: string[] = [];
    const record = (...args: unknown[]): void => {
      output.push(args.map(String).join(' '));
    };
    const logSpy = vi.spyOn(console, 'log').mockImplementation(record);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(record);
    try {
      await withTmpDir(async tmp => {
        const baselinePath = await seedSurfaceFailingRepo(tmp);

        const status = runLinesCheck({ rootDir: tmp, baseline: baselinePath, noFail: true });

        expect(status).toBe('fail');
        expect(output.join('\n')).toContain(UPDATE_BASELINE_HINT);
      });
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
      chalk.level = priorLevel;
    }
  });
});
