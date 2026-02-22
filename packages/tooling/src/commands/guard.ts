/**
 * Guard Commands
 *
 * Architecture and code quality guard checks.
 */

import type { CAC } from 'cac';

export function registerGuardCommands(cli: CAC): void {
  cli
    .command('guard:boundaries', 'Check for architecture boundary violations')
    .option('--verbose', 'Show detailed output')
    .example('ops guard:boundaries')
    .example('ops guard:boundaries --verbose')
    .action(async (options: { verbose?: boolean }) => {
      const { checkBoundaries } = await import('../dev/check-boundaries.js');
      await checkBoundaries(options);
    });

  cli
    .command(
      'guard:duplicate-exports',
      'Check for duplicate exported names across files within each package'
    )
    .option('--verbose', 'Show per-package scan details')
    .option('--package <name>', 'Check only a specific package (api-gateway, bot-client, etc.)')
    .example('ops guard:duplicate-exports')
    .example('ops guard:duplicate-exports --package api-gateway')
    .example('ops guard:duplicate-exports --verbose')
    .action(async (options: { verbose?: boolean; package?: string }) => {
      const { checkDuplicateExports } = await import('../dev/check-duplicate-exports.js');
      await checkDuplicateExports(options);
    });
}
