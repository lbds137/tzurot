/**
 * Test Commands
 *
 * Commands for auditing test coverage using ratchet systems.
 * These enforce that new code comes with appropriate tests.
 */

import type { CAC } from 'cac';

export function registerTestCommands(cli: CAC): void {
  // Generate PGLite schema
  cli
    .command('test:generate-schema', 'Regenerate PGLite schema SQL from Prisma')
    .option('--output <path>', 'Output file path')
    .example('pnpm ops test:generate-schema')
    .action(async (options: { output?: string }) => {
      const { generateSchema } = await import('../test/generate-schema.js');
      await generateSchema(options);
    });

  // Unified audit command (primary)
  cli
    .command('test:audit', 'Run unified test coverage audit')
    .option('--update', 'Update baseline with current gaps')
    .option('--strict', 'Fail if ANY gap exists (not just new ones)')
    .option('--category <cat>', 'Only run: services, contracts')
    .option('--verbose', 'Show detailed output')
    .example('pnpm ops test:audit')
    .example('pnpm ops test:audit --category=services')
    .example('pnpm ops test:audit --update')
    .example('pnpm ops test:audit --strict')
    .action(
      async (options: {
        update?: boolean;
        strict?: boolean;
        category?: string;
        verbose?: boolean;
      }) => {
        const { auditUnified } = await import('../test/audit-unified.js');

        // Validate category option
        const category = options.category as 'services' | 'contracts' | undefined;
        if (category && category !== 'services' && category !== 'contracts') {
          console.error(`❌ Invalid category: ${options.category}`);
          console.error('   Valid options: services, contracts');
          process.exitCode = 1;
          return;
        }

        const passed = auditUnified({
          update: options.update,
          strict: options.strict,
          category,
          verbose: options.verbose,
        });
        if (!passed) {
          process.exitCode = 1;
        }
      }
    );

  // Legacy command - contracts (deprecated)
  cli
    .command('test:audit-contracts', 'DEPRECATED: Use test:audit --category=contracts')
    .option('--update', 'Update baseline with current gaps')
    .option('--strict', 'Fail if ANY gap exists (not just new ones)')
    .example('pnpm ops test:audit --category=contracts')
    .action(async (options: { update?: boolean; strict?: boolean }) => {
      console.warn('⚠️  DEPRECATED: Use "pnpm ops test:audit --category=contracts"\n');

      const { auditUnified } = await import('../test/audit-unified.js');
      const passed = auditUnified({
        update: options.update,
        strict: options.strict,
        category: 'contracts',
      });
      if (!passed) {
        process.exitCode = 1;
      }
    });

  // Legacy command - services (deprecated)
  cli
    .command('test:audit-services', 'DEPRECATED: Use test:audit --category=services')
    .option('--update', 'Update baseline with current gaps')
    .option('--strict', 'Fail if ANY gap exists (not just new ones)')
    .example('pnpm ops test:audit --category=services')
    .action(async (options: { update?: boolean; strict?: boolean }) => {
      console.warn('⚠️  DEPRECATED: Use "pnpm ops test:audit --category=services"\n');

      const { auditUnified } = await import('../test/audit-unified.js');
      const passed = auditUnified({
        update: options.update,
        strict: options.strict,
        category: 'services',
      });
      if (!passed) {
        process.exitCode = 1;
      }
    });
}
