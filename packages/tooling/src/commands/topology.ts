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
      const { generateCoverageTopology, surfaceGap } =
        await import('../topology/coverageTopology.js');
      const topology = generateCoverageTopology();
      console.log(JSON.stringify(topology, null, 2));

      const gaps = topology.surfaces.filter(s => surfaceGap(s).length > 0);
      console.log(`\n${topology.surfaces.length} surface(s); ${gaps.length} with a tier gap.`);
      console.log(
        'NOTE: report-only. Surfaces are enumerated from ROUTE_MANIFEST + JobType payload ' +
          'schemas + the context-assembly envelope; actualTiers is optimistic-from-mechanism. ' +
          'Phase 2b adds --write (commit the artifact), mechanism-presence verification, and the ' +
          'lockfile-diff CI gate; the test:tier-audit ratchet is Phase 4.'
      );
    });
}
