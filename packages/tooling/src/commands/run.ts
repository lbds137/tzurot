/**
 * Generic run command for executing arbitrary scripts with Railway environment
 *
 * This provides a universal way to run any script against Railway databases
 * without needing to add specific ops commands for each one-off script.
 *
 * Usage:
 *   pnpm ops run --env dev <command> [args...]
 *
 * Examples:
 *   pnpm ops run --env dev tsx scripts/src/db/backfill-local-embeddings.ts
 *   pnpm ops run --env prod npx prisma studio
 *   pnpm ops run --env dev pnpm --filter @tzurot/scripts run db:fix-phantom
 *
 * Note: The "--" separator is NOT required (cac handles variadic args directly).
 */

import type { CAC } from 'cac';
import type { Environment } from '../utils/env-runner.js';

export function registerRunCommands(cli: CAC): void {
  cli
    .command('run [...command]', 'Run a command with Railway DATABASE_URL injected')
    .option('--env <env>', 'Environment: local, dev, or prod', { default: 'dev' })
    .option('--force', 'Skip confirmation for production operations')
    .example('pnpm ops run --env dev tsx scripts/src/db/backfill-local-embeddings.ts')
    .example('pnpm ops run --env prod --force npx prisma studio')
    .action(async (commandParts: string[], options: { env?: Environment; force?: boolean }) => {
      const { runWithEnv } = await import('../db/run-with-env.js');
      await runWithEnv(commandParts, {
        env: options.env ?? 'dev',
        force: options.force,
      });
    });
}
