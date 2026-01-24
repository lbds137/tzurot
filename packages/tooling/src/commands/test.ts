/**
 * Test Commands
 *
 * Commands for auditing test coverage using ratchet systems.
 * These enforce that new code comes with appropriate tests.
 */

import type { CAC } from 'cac';

export function registerTestCommands(cli: CAC): void {
  cli
    .command('test:audit-contracts', 'Audit API contract test coverage')
    .option('--update', 'Update baseline with current gaps')
    .option('--strict', 'Fail if ANY gap exists (not just new ones)')
    .example('ops test:audit-contracts')
    .example('ops test:audit-contracts --update')
    .example('ops test:audit-contracts --strict')
    .action(async (options: { update?: boolean; strict?: boolean }) => {
      const { auditContracts } = await import('../test/audit-contracts.js');
      auditContracts(options);
    });

  cli
    .command('test:audit-services', 'Audit service integration test coverage')
    .option('--update', 'Update baseline with current gaps')
    .option('--strict', 'Fail if ANY gap exists (not just new ones)')
    .example('ops test:audit-services')
    .example('ops test:audit-services --update')
    .example('ops test:audit-services --strict')
    .action(async (options: { update?: boolean; strict?: boolean }) => {
      const { auditServices } = await import('../test/audit-services.js');
      auditServices(options);
    });

  cli
    .command('test:audit', 'Run all test coverage audits')
    .option('--strict', 'Fail if ANY gap exists (not just new ones)')
    .example('ops test:audit')
    .example('ops test:audit --strict')
    .action(async (options: { strict?: boolean }) => {
      const { auditContracts } = await import('../test/audit-contracts.js');
      const { auditServices } = await import('../test/audit-services.js');

      console.log('═'.repeat(60));
      console.log('Running all test coverage audits...');
      console.log('═'.repeat(60) + '\n');

      const contractsPass = auditContracts({ strict: options.strict });

      console.log('═'.repeat(60) + '\n');

      const servicesPass = auditServices({ strict: options.strict });

      console.log('═'.repeat(60));
      if (contractsPass && servicesPass) {
        console.log('✅ All audits passed!');
      } else {
        console.log('❌ Some audits failed.');
        process.exitCode = 1;
      }
      console.log('═'.repeat(60));
    });
}
