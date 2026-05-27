/**
 * CLI runner for `pnpm ops legacy:count`.
 *
 * Splits the I/O wrapper from the pure counting/comparison logic in
 * `legacy-count.ts` so the latter is unit-testable against synthetic
 * trees.
 */

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import chalk from 'chalk';
import {
  compareWithBaseline,
  countLegacyCallsites,
  describeSource,
  readBaseline,
  writeBaseline,
  type LegacyCallsiteBaseline,
  type LegacyCallsiteCounts,
} from './legacy-count.js';

const BASELINE_RELPATH = '.github/baselines/legacy-callsite-baseline.json';

const DEFAULT_NOTES =
  'Burn-down gate for the route-manifest cutover. Counts shrink monotonically as migration steps move bot-client callsites from adminFetch/callGatewayApi to the generated ServiceClient/OwnerClient/UserClient. Deleted (with this baseline) once both counts reach zero.';

export interface RunOptions {
  /** Refresh the baseline with current counts and exit 0. */
  update?: boolean;
}

export async function runLegacyCount(options: RunOptions): Promise<void> {
  // Mirror the other dev:* runners — `pnpm` invocations resolve cwd to the
  // repo root in CI and developer environments.
  const repoRoot = resolve(process.cwd());
  const baselinePath = join(repoRoot, BASELINE_RELPATH);
  const current = countLegacyCallsites(repoRoot);
  const source = describeSource();

  console.log(chalk.dim(`Counting from: ${source}`));
  console.log(
    chalk.bold(
      `Current counts: adminFetch=${current.adminFetch}, callGatewayApi=${current.callGatewayApi}`
    )
  );

  if (options.update === true) {
    const baseline = writeBaseline(baselinePath, current, DEFAULT_NOTES);
    console.log(chalk.green(`✓ Baseline updated: ${BASELINE_RELPATH}`));
    printBaselineSummary(baseline);
    return;
  }

  if (!existsSync(baselinePath)) {
    console.error(chalk.red(`✗ Baseline missing: ${BASELINE_RELPATH}`));
    console.error(chalk.yellow('Run `pnpm ops legacy:count --update` to create it.'));
    process.exit(1);
  }

  const baseline = readBaseline(baselinePath);
  const result = compareWithBaseline(current, baseline);

  printDelta(result.delta);

  if (result.regression) {
    console.error(chalk.red('✗ Legacy callsite regression detected.'));
    console.error(
      chalk.yellow(
        'The route-manifest cutover (Epic Phase 4) burns these counts down. If you must add a new callsite, justify it in the PR description AND run `pnpm ops legacy:count --update` after merging the migration that absorbs it.'
      )
    );
    process.exit(1);
  }

  if (result.delta.adminFetch === 0 && result.delta.callGatewayApi === 0) {
    console.log(chalk.green('✓ Counts level with baseline.'));
  } else {
    console.log(chalk.green('✓ Counts below baseline (burn-down in progress).'));
  }
}

function printDelta(delta: LegacyCallsiteCounts): void {
  const fmt = (n: number): string => {
    if (n === 0) return chalk.dim('±0');
    if (n < 0) return chalk.green(String(n));
    return chalk.red(`+${n}`);
  };
  console.log(
    `Delta vs baseline: adminFetch=${fmt(delta.adminFetch)}, callGatewayApi=${fmt(delta.callGatewayApi)}`
  );
}

function printBaselineSummary(baseline: LegacyCallsiteBaseline): void {
  console.log(chalk.dim(`  adminFetch:     ${baseline.adminFetch}`));
  console.log(chalk.dim(`  callGatewayApi: ${baseline.callGatewayApi}`));
  console.log(chalk.dim(`  lastUpdated:    ${baseline.lastUpdated}`));
}
