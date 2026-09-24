/**
 * A hard, non-baseline ceiling on the instructions the harness loads into
 * EVERY turn: `CLAUDE.md` plus the `.claude/rules/*.md` set (summed).
 *
 * `lines-check.ts`'s per-surface budgets are a ratchet against the PREVIOUS
 * measurement — they can be raised at will via `lines:update-baseline`, which
 * is correct for tracking gradual growth but wrong for a limit that is not
 * ours to move. This ceiling mirrors Claude Code's own large-memory-files
 * warning total (150,000 characters on a 1M-context driver), minus a 3,000
 * character allowance for the machine-local `~/.claude/CLAUDE.md` that CI
 * cannot see (it is not checked in and is unmeasured here). It sums
 * `.length` — UTF-16 code units — because that is what the harness itself
 * sums when it decides whether to warn, not byte count. The harness derives
 * its limit from the model's context window (floored at 120,000); the value
 * is not verified stable across harness versions, so this ceiling mirrors
 * observed behavior, not a documented contract.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';
import { measureSurfaceFiles } from './lines-surfaces.js';

export const INSTRUCTION_CHARS_CEILING = 147_000;

/** Measured per-file char counts, or the reason measurement was hollow. */
export interface InstructionMeasurement {
  charCounts: number[];
  /** Non-null when a required file/surface was missing — never a silent 0. */
  hollowFailure: string | null;
}

/**
 * Read `CLAUDE.md` plus every `.claude/rules/*.md` file under `rootDir` as
 * `.length` (UTF-16 code units, matching what the harness sums). Either half
 * missing is a hollow measurement, reported rather than silently read as 0 —
 * the same contract `lines-surfaces.ts` applies to a moved directory.
 */
export function measureInstructionChars(rootDir: string): InstructionMeasurement {
  const failures: string[] = [];
  const charCounts: number[] = [];

  const claudeMdPath = join(rootDir, 'CLAUDE.md');
  if (existsSync(claudeMdPath)) {
    charCounts.push(readFileSync(claudeMdPath, 'utf-8').length);
  } else {
    failures.push('CLAUDE.md not found at repo root — instructions ceiling cannot be measured');
  }

  const ruleFiles = measureSurfaceFiles(rootDir, 'rules');
  if (ruleFiles.length === 0) {
    failures.push(
      '.claude/rules/*.md matched zero files — instructions ceiling cannot be measured'
    );
  } else {
    for (const file of ruleFiles) {
      charCounts.push(readFileSync(join(rootDir, file.path), 'utf-8').length);
    }
  }

  return { charCounts, hollowFailure: failures.length > 0 ? failures.join('; ') : null };
}

export interface InstructionCeilingOutcome {
  total: number;
  ceiling: number;
  /** Non-null when the total exceeds the ceiling, or measurement was hollow. */
  failure: string | null;
}

/**
 * Pure comparison: sum the given char counts and compare against `ceiling`.
 * Passes at exactly the ceiling. No filesystem access — the hollow-measurement
 * case is handled one layer up, in `checkInstructionCeiling`, because "zero
 * files" is a measurement failure, not a value this evaluator could ever see.
 */
export function evaluateInstructionCeiling(
  charCounts: number[],
  ceiling: number = INSTRUCTION_CHARS_CEILING
): InstructionCeilingOutcome {
  const total = charCounts.reduce((sum, count) => sum + count, 0);
  const failure =
    total <= ceiling
      ? null
      : `instructions: ${total} chars exceeds the hard ceiling ${ceiling} ` +
        `(CLAUDE.md + .claude/rules, summed as UTF-16 .length) — this is a HARD ceiling ` +
        `that \`lines:update-baseline\` cannot raise; trim via \`pnpm ops lines:check --breakdown\``;
  return { total, ceiling, failure };
}

/** Measure `rootDir` and evaluate it against `ceiling` in one call. */
export function checkInstructionCeiling(
  rootDir: string,
  ceiling: number = INSTRUCTION_CHARS_CEILING
): InstructionCeilingOutcome {
  const { charCounts, hollowFailure } = measureInstructionChars(rootDir);
  if (hollowFailure !== null) {
    return { total: 0, ceiling, failure: hollowFailure };
  }
  return evaluateInstructionCeiling(charCounts, ceiling);
}

/** One report line, printed on every normal `lines:check` run. */
export function formatInstructionCeilingLine(outcome: InstructionCeilingOutcome): string {
  const label = '  instructions:'.padEnd(15);
  const line = `${label} ${outcome.total} chars (ceiling ${outcome.ceiling}; CLAUDE.md + .claude/rules)`;
  return outcome.failure === null ? chalk.green(line) : chalk.red(line);
}
