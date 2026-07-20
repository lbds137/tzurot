/**
 * Test Commands
 *
 * Commands for auditing test coverage using ratchet systems.
 * These enforce that new code comes with appropriate tests.
 */

import type { CAC } from 'cac';

const UPDATE_OPTION_DESC = 'Update baseline with current gaps';
const STRICT_OPTION_DESC = 'Fail if ANY gap exists (not just new ones)';

/** Mutation-score ratchet commands (audit-class; see mutation-check.WHY.md). */
function registerMutationCommands(cli: CAC): void {
  cli
    .command('mutation:check', 'Fail if a mutation score fell below its baseline floor (CI gate)')
    .option('--baseline <path>', 'Path to baseline JSON', {
      default: '.github/baselines/mutation-baseline.json',
    })
    .option('--summary', 'Emit one JSONL summary line (aggregator contract)')
    .example('pnpm ops mutation:check')
    .action(async (options: { baseline: string; summary?: boolean }) => {
      const { runMutationCheck } = await import('../test/mutation-check.js');
      runMutationCheck(options);
    });

  cli
    .command(
      'mutation:gate',
      'Decide whether the diff can have moved any tracked mutation score (CI skip gate; fail-open)'
    )
    .option('--base <ref>', 'Git ref to diff against (merge-base semantics)', {
      default: 'origin/develop',
    })
    .example('pnpm ops mutation:gate')
    .action(async (options: { base: string }) => {
      const { runMutationGate } = await import('../test/mutation-gate.js');
      runMutationGate({ base: options.base });
    });

  cli
    .command(
      'mutation:update-baseline',
      'Write current mutation scores to the baseline (run after intentional score changes)'
    )
    .option('--baseline <path>', 'Path to baseline JSON', {
      default: '.github/baselines/mutation-baseline.json',
    })
    .option('--dry-run', 'Show the diff without writing the file')
    .example('pnpm ops mutation:update-baseline --dry-run')
    .action(async (options: { baseline: string; dryRun?: boolean }) => {
      const { runMutationUpdateBaseline } = await import('../test/mutation-check.js');
      runMutationUpdateBaseline(options);
    });
}

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

  registerMutationCommands(cli);

  // Unified audit command (primary)
  cli
    .command('test:audit', 'Run unified test coverage audit')
    .option('--update', UPDATE_OPTION_DESC)
    .option('--strict', STRICT_OPTION_DESC)
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

        const passed = await auditUnified({
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

  // Tier distribution report (report-only — no gate)
  cli
    .command('test:tiers', 'Report the per-package test-tier distribution (report-only)')
    .option('--summary', 'Emit only the informational JSONL summary line')
    .example('pnpm ops test:tiers')
    .action(async (options: { summary?: boolean }) => {
      const { runTierReport } = await import('../test/tier-report.js');
      await runTierReport({ summary: options.summary });
    });

  // Legacy command - contracts (deprecated)
  cli
    .command('test:audit-contracts', 'DEPRECATED: Use test:audit --category=contracts')
    .option('--update', UPDATE_OPTION_DESC)
    .option('--strict', STRICT_OPTION_DESC)
    .example('pnpm ops test:audit --category=contracts')
    .action(async (options: { update?: boolean; strict?: boolean }) => {
      console.warn('⚠️  DEPRECATED: Use "pnpm ops test:audit --category=contracts"\n');

      const { auditUnified } = await import('../test/audit-unified.js');
      const passed = await auditUnified({
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
    .option('--update', UPDATE_OPTION_DESC)
    .option('--strict', STRICT_OPTION_DESC)
    .example('pnpm ops test:audit --category=services')
    .action(async (options: { update?: boolean; strict?: boolean }) => {
      console.warn('⚠️  DEPRECATED: Use "pnpm ops test:audit --category=services"\n');

      const { auditUnified } = await import('../test/audit-unified.js');
      const passed = await auditUnified({
        update: options.update,
        strict: options.strict,
        category: 'services',
      });
      if (!passed) {
        process.exitCode = 1;
      }
    });
}
