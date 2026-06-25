/**
 * Coverage-topology commands (test-pyramid epic).
 *
 * `topology:generate` prints the code-derived cross-service coverage topology
 * (which test tiers each surface should/does carry); `--write` emits the
 * committed `coverage-topology.json`. `topology:check` regenerates and
 * byte-compares against the committed file — the CI drift gate (same shape as
 * `codegen:routes --check`). The hard ratchet that fails on a missing required
 * tier is a separate, later tool (`test:tier-audit`).
 */

import type { CAC } from 'cac';
import chalk from 'chalk';

export function registerTopologyCommands(cli: CAC): void {
  cli
    .command('topology:generate', 'Print (or --write) the cross-service coverage topology')
    .option('--write', 'Write the committed coverage-topology.json instead of printing')
    .example('pnpm ops topology:generate')
    .example('pnpm ops topology:generate --write')
    .action(async (options: { write?: boolean }) => {
      const {
        generateCoverageTopology,
        surfaceGap,
        writeCoverageTopology,
        COVERAGE_TOPOLOGY_PATH,
      } = await import('../topology/coverageTopology.js');

      if (options.write === true) {
        writeCoverageTopology();
        console.log(chalk.green(`✓ Wrote ${COVERAGE_TOPOLOGY_PATH}`));
        return;
      }

      const topology = generateCoverageTopology();
      console.log(JSON.stringify(topology, null, 2));

      const gaps = topology.surfaces.filter(s => surfaceGap(s).length > 0);
      console.log(
        `\n${topology.surfaces.length} surface(s); ${gaps.length} with a tier gap ` +
          `(coverage mechanism absent).`
      );
    });

  cli
    .command('topology:check', 'Fail if the committed coverage-topology.json is stale (CI mode)')
    .example('pnpm ops topology:check')
    .action(async () => {
      const { checkCoverageTopology, COVERAGE_TOPOLOGY_PATH } =
        await import('../topology/coverageTopology.js');

      const result = checkCoverageTopology();
      if (result.upToDate) {
        console.log(chalk.green(`✓ ${COVERAGE_TOPOLOGY_PATH} up-to-date`));
        return;
      }

      console.error(
        chalk.red(
          result.missing
            ? `✗ ${COVERAGE_TOPOLOGY_PATH} is missing`
            : `✗ ${COVERAGE_TOPOLOGY_PATH} is out of sync with code`
        )
      );
      console.error(
        chalk.yellow('\nRun `pnpm ops topology:generate --write`, then commit the result.')
      );
      process.exit(1);
    });
}
