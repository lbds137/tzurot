/**
 * Coverage-topology commands (test-pyramid epic).
 *
 * Report-only skeleton: prints the cross-service coverage topology (which test
 * tiers each surface should/does carry). The full code-derived enumeration +
 * lockfile-diff + CI ratchet are Phase 2/4, not wired here.
 */

import type { CAC } from 'cac';

export function registerTopologyCommands(cli: CAC): void {
  cli
    .command(
      'topology:generate',
      'Print the cross-service coverage topology (report-only skeleton)'
    )
    .example('pnpm ops topology:generate')
    .action(async () => {
      const { buildCoverageTopology, surfaceGap } = await import('../topology/coverageTopology.js');
      const topology = buildCoverageTopology();
      console.log(JSON.stringify(topology, null, 2));

      const gaps = topology.surfaces.filter(s => surfaceGap(s).length > 0);
      console.log(`\n${topology.surfaces.length} surface(s); ${gaps.length} with a tier gap.`);
      console.log(
        'NOTE: skeleton — seeded with 1 proven surface. The full ROUTE_MANIFEST + JobType walk ' +
          '(deriving actualTiers from tests) is Phase 2 of the test-pyramid epic; report-only, no gate.'
      );
    });
}
