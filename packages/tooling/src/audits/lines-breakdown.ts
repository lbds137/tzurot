/**
 * The per-file view of the always-loaded context surfaces.
 *
 * `lines-check.ts` answers "did a surface exceed its budget?" — a yes/no about
 * a whole surface. That is the right question for a CI gate and the wrong one
 * for a human about to trim: a surface is ten files, and the gate says nothing
 * about which of them to open. This module answers the second question, and it
 * is deliberately not part of the gate — nothing here has a threshold, a
 * baseline, or a verdict, so no trim decision can ever change a build outcome.
 *
 * Both views measure through `measureSurfaceFiles`, so the ranking and the
 * budget can never disagree about what a file weighs.
 */

import chalk from 'chalk';
import { SURFACE_NAMES, measureSurfaceFiles, type FileMeasurement } from './lines-surfaces.js';

/**
 * Bytes per token, for the derived estimates in the reports only. Roughly right
 * for English prose and markdown across current tokenizers, and deliberately
 * NOT used by any gate — a threshold resting on a rule of thumb would be a
 * threshold nobody could reason about.
 *
 * Exported so the gate's per-surface estimate and the ranking's per-file
 * estimate are the same number by construction. They are two views of one
 * measurement, and a second copy of the ratio would let them drift apart with
 * nothing failing — jscpd cannot catch it either, since the declaration is
 * shorter than its `minLines` threshold.
 */
export const BYTES_PER_TOKEN_ESTIMATE = 4;

/**
 * One ranked per-file row, worst-first by bytes.
 *
 * `share` and `bytesPerLine` are carried rather than left to the formatter
 * because they are the two numbers that make the ranking actionable: share
 * says whether trimming this file would move anything, and density says
 * whether its line count was lying about its weight.
 */
export interface BreakdownRow {
  path: string;
  lines: number;
  bytes: number;
  /** Fraction of its own surface's bytes, 0–1. */
  share: number;
  /** Bytes per line — the density figure that makes a line count misleading. */
  bytesPerLine: number;
}

/**
 * Rank one surface's files worst-first by bytes.
 *
 * Bytes, not lines, is the sort key on purpose: ranking by lines is the exact
 * failure this breakdown exists to fix. Sorted by lines, the ten rules files
 * put `04-discord.md` (308 lines) three places above `03-database.md` (187)
 * while `04-discord.md` is table-heavy at ~44 B/line and actually costs less —
 * so a reader trimming from the top of a line-sorted list works the wrong file
 * first. Ties break on path so the output is stable to compare across runs.
 */
export function rankSurfaceFiles(files: FileMeasurement[]): BreakdownRow[] {
  const total = files.reduce((sum, file) => sum + file.bytes, 0);
  return files
    .map(file => ({
      path: file.path,
      lines: file.lines,
      bytes: file.bytes,
      // A surface of empty files is 0 total bytes; every row's share is then
      // genuinely 0, and dividing would make it NaN and print as "NaN%".
      share: total === 0 ? 0 : file.bytes / total,
      bytesPerLine: file.lines === 0 ? 0 : file.bytes / file.lines,
    }))
    .sort((a, b) => (b.bytes === a.bytes ? a.path.localeCompare(b.path) : b.bytes - a.bytes));
}

/**
 * Compact token estimate for the breakdown's columns.
 *
 * Resolution is chosen per magnitude rather than fixed, because a single `k`
 * rounding flattens exactly the range that matters: the rules files land
 * between ~1.2k and ~10k estimated tokens, where whole-thousand rounding
 * renders a file and one twice its weight as "1k" and "2k" — the ranking's
 * own signal, lost to formatting.
 */
export function formatTokenEstimate(bytes: number): string {
  const tokens = bytes / BYTES_PER_TOKEN_ESTIMATE;
  if (tokens < 1000) {
    return `≈${Math.round(tokens)} tok`;
  }
  if (tokens < 10_000) {
    return `≈${(tokens / 1000).toFixed(1)}k tok`;
  }
  return `≈${Math.round(tokens / 1000)}k tok`;
}

/** Format one ranked row as its report line. */
export function formatBreakdownRow(row: BreakdownRow): string {
  return (
    `    ${String(row.bytes).padStart(7)} B ` +
    `${formatTokenEstimate(row.bytes).padEnd(10)} ` +
    `${`${Math.round(row.share * 100)}%`.padStart(4)}  ` +
    `${String(row.lines).padStart(4)} lines  ` +
    `${String(Math.round(row.bytesPerLine)).padStart(4)} B/line  ` +
    `${row.path}`
  );
}

/** Print the ranked per-file view for every tracked surface. */
export function reportBreakdown(rootDir: string): void {
  console.log('');
  console.log(chalk.bold('Per-file ranking — worst-first by bytes (the trim order)'));
  for (const name of SURFACE_NAMES) {
    const rows = rankSurfaceFiles(measureSurfaceFiles(rootDir, name));
    const bytes = rows.reduce((sum, row) => sum + row.bytes, 0);
    console.log('');
    console.log(
      chalk.bold(`  ${name}`) +
        chalk.dim(
          ` — ${rows.length} file${rows.length === 1 ? '' : 's'}, ` +
            `${bytes} bytes ${formatTokenEstimate(bytes)}`
        )
    );
    // Zero matches is the hollow-measurement signal the gate fails on; the
    // ranking has no verdict to give, so it says so rather than printing an
    // empty section that reads as "this surface is fine".
    if (rows.length === 0) {
      console.log(chalk.red('    (glob matched zero files)'));
      continue;
    }
    for (const row of rows) {
      console.log(formatBreakdownRow(row));
    }
  }
  console.log('');
  console.log(
    chalk.dim(
      '  Density (B/line) is why lines mislead: a table-heavy file can outrank a ' +
        'prose-heavy one\n  on lines while costing less. Trim from the top of THIS list. ' +
        'The pruning procedure\n  is the economy pass in `/tzurot-doc-audit`.'
    )
  );
}
