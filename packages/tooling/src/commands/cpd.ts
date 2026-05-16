/**
 * CPD (copy-paste detection) commands.
 *
 * - `cpd:filtered` runs the post-filter against the current jscpd output
 *   and prints the filtered count + breakdown. Use this to inspect what
 *   jscpd is flagging that's actually real debt vs. structural uniformity.
 *
 * - `cpd:check` compares the filtered count against a baseline value and
 *   exits non-zero on regression. Used by CI to enforce the ratchet.
 *
 * Both commands assume `pnpm cpd` (or `jscpd --reporters json`) has
 * produced `reports/jscpd/jscpd-report.json` first.
 */

import type { CAC } from 'cac';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import chalk from 'chalk';
import { JSCPD_REPORT_PATH } from '../cpd/postFilter.js';

/** Guard against CLI misconfiguration in CI — a degenerate threshold would
 *  silently produce a meaningless filter (≥1 excludes nothing, ≤0 excludes
 *  everything). Fail fast at the boundary instead. */
function assertThresholdInRange(threshold: number): void {
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    console.error(chalk.red(`--threshold must be between 0.0 and 1.0 (got ${threshold})`));
    process.exit(1);
  }
}

/** Parse and validate the baseline JSON. A malformed baseline (missing or
 *  non-numeric `filteredLines`) would produce a `NaN` ceiling, and any
 *  `> NaN` comparison is `false` — the ratchet would silently pass even
 *  on regression. Fail loudly at the boundary instead. */
function parseBaseline(
  rawContent: string,
  pathForError: string
): { filteredLines: number; graceMargin?: number } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawContent);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(chalk.red(`Baseline ${pathForError} is not valid JSON: ${message}`));
    process.exit(1);
  }
  if (typeof parsed !== 'object' || parsed === null) {
    console.error(chalk.red(`Baseline ${pathForError} must be a JSON object`));
    process.exit(1);
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.filteredLines !== 'number' || !Number.isFinite(obj.filteredLines)) {
    console.error(
      chalk.red(`Baseline ${pathForError} missing required numeric field: filteredLines`)
    );
    process.exit(1);
  }
  if (
    obj.graceMargin !== undefined &&
    (typeof obj.graceMargin !== 'number' || !Number.isFinite(obj.graceMargin))
  ) {
    console.error(
      chalk.red(`Baseline ${pathForError} graceMargin must be a finite number when set`)
    );
    process.exit(1);
  }
  return { filteredLines: obj.filteredLines, graceMargin: obj.graceMargin };
}

export function registerCpdCommands(cli: CAC): void {
  cli
    .command(
      'cpd:filtered',
      'Run the post-filter against jscpd output (excludes call-dominant fragments)'
    )
    .option('--threshold <ratio>', 'Call-ratio threshold (0.0-1.0, default 0.8)', {
      default: 0.8,
    })
    .option('--show-pairs <n>', 'Show top N remaining file pairs by duplicated lines', {
      default: 10,
    })
    .option('--json', 'Emit JSON output instead of human-readable summary')
    .action(async (options: { threshold: number; showPairs: number; json?: boolean }) => {
      assertThresholdInRange(options.threshold);
      if (!existsSync(resolve(process.cwd(), JSCPD_REPORT_PATH))) {
        console.error(
          chalk.red(`jscpd report not found at ${JSCPD_REPORT_PATH} — run \`pnpm cpd\` first.`)
        );
        process.exit(1);
      }

      const { filterReport, loadJscpdReport } = await import('../cpd/postFilter.js');
      const report = loadJscpdReport(JSCPD_REPORT_PATH);
      const result = filterReport(report, options.threshold);

      if (options.json === true) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(chalk.bold('CPD post-filter results'));
      console.log(`  Raw clones:           ${result.rawCount}`);
      console.log(`  Raw duplicated lines: ${result.rawLines}`);
      console.log(`  Excluded as call-dominant: ${chalk.dim(result.excludedCount)}`);
      console.log(
        `  ${chalk.bold('Filtered count:')}      ${chalk.cyan(result.filteredCount.toString())}`
      );
      console.log(
        `  ${chalk.bold('Filtered lines:')}      ${chalk.cyan(result.filteredLines.toString())}`
      );

      if (result.remainingByPair.length > 0) {
        console.log();
        console.log(chalk.bold(`Top ${options.showPairs} remaining file pairs by lines:`));
        for (const { pair, clones, lines } of result.remainingByPair.slice(0, options.showPairs)) {
          console.log(
            `  ${chalk.yellow(`${lines}`.padStart(4))} lines, ${clones} clones — ${pair}`
          );
        }
      }
    });

  cli
    .command('cpd:check', 'Fail if filtered CPD count exceeds the baseline (CI gate)')
    .option('--baseline <path>', 'Path to baseline JSON', {
      default: '.github/baselines/cpd-baseline.json',
    })
    .option('--threshold <ratio>', 'Call-ratio threshold (default 0.8)', { default: 0.8 })
    .action(async (options: { baseline: string; threshold: number }) => {
      assertThresholdInRange(options.threshold);
      if (!existsSync(resolve(process.cwd(), JSCPD_REPORT_PATH))) {
        console.error(
          chalk.red(`jscpd report not found at ${JSCPD_REPORT_PATH} — run \`pnpm cpd\` first.`)
        );
        process.exit(1);
      }
      if (!existsSync(resolve(process.cwd(), options.baseline))) {
        console.error(chalk.red(`Baseline not found at ${options.baseline}`));
        process.exit(1);
      }

      const { filterReport, loadJscpdReport } = await import('../cpd/postFilter.js');

      const baseline = parseBaseline(
        readFileSync(resolve(process.cwd(), options.baseline), 'utf-8'),
        options.baseline
      );

      const report = loadJscpdReport(JSCPD_REPORT_PATH);
      const result = filterReport(report, options.threshold);

      const grace = baseline.graceMargin ?? 0;
      const ceiling = baseline.filteredLines + grace;

      console.log(chalk.bold('CPD ratchet check'));
      console.log(`  Baseline filtered lines: ${baseline.filteredLines}`);
      console.log(`  Grace margin:            ${grace}`);
      console.log(`  Ceiling:                 ${ceiling}`);
      console.log(`  Current filtered lines:  ${result.filteredLines}`);

      if (result.filteredLines > ceiling) {
        console.error();
        console.error(
          chalk.red(
            `❌ CPD ratchet failed: filtered lines ${result.filteredLines} exceeds ceiling ${ceiling}`
          )
        );
        console.error(
          chalk.dim(
            'Either reduce duplication, or update the baseline if the new clones are intentional.'
          )
        );
        console.error(
          chalk.dim('Run `pnpm ops cpd:filtered --show-pairs 25` to see the top remaining pairs.')
        );
        process.exit(1);
      }

      console.log(chalk.green(`✓ Filtered lines within ceiling`));
    });
}
