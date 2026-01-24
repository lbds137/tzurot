/**
 * Context Commands
 *
 * Commands for understanding codebase state during AI sessions.
 */

import type { CAC } from 'cac';

export function registerContextCommands(cli: CAC): void {
  cli
    .command('context', 'Show codebase context for AI session startup')
    .option('--verbose', 'Show detailed file lists')
    .option('--skip-migrations', 'Skip migration status check (faster)')
    .example('pnpm ops context')
    .example('pnpm ops context --verbose')
    .example('pnpm ops context --skip-migrations')
    .action(async (options: { verbose?: boolean; skipMigrations?: boolean }) => {
      const { getSessionContext } = await import('../context/session-context.js');
      await getSessionContext(options);
    });
}
