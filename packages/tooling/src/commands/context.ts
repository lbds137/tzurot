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

  cli
    .command('session:save', 'Save current session state for later restoration')
    .option('--notes <text>', 'Add notes to remember for next session')
    .example('pnpm ops session:save')
    .example('pnpm ops session:save --notes "Working on auth flow"')
    .action(async (options: { notes?: string }) => {
      const { saveSession } = await import('../context/session-state.js');
      await saveSession(options);
    });

  cli
    .command('session:load', 'Load and display saved session state')
    .example('pnpm ops session:load')
    .action(async () => {
      const { loadSession } = await import('../context/session-state.js');
      await loadSession();
    });

  cli
    .command('session:clear', 'Clear saved session state')
    .example('pnpm ops session:clear')
    .action(async () => {
      const { clearSession } = await import('../context/session-state.js');
      await clearSession();
    });
}
