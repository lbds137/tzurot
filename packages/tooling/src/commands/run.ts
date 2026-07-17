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
 *   pnpm ops run --env dev tsx scripts/<your-db-script>.ts
 *   pnpm ops run --env prod npx prisma studio
 *   pnpm ops run --env dev npx prisma migrate status
 *
 * Flags for the WRAPPED command go after a "--" separator — cac's
 * unknown-option check throws on any bare dash-flag in the variadic part
 * (`--dry-run`, even `-c`), but everything after "--" lands in
 * `options['--']` untouched and is re-appended to the command here:
 *
 *   pnpm ops run --env prod -- tsx scripts/foo.ts --dry-run
 */

import type { CAC } from 'cac';
import type { Environment } from '../utils/env-runner.js';

export function registerRunCommands(cli: CAC): void {
  cli
    // NOTE: deliberately NO .allowUnknownOptions() — cac would silently
    // STRIP unknown flags from the variadic part (a `--dry-run` typed
    // without the "--" separator would vanish and the script would run for
    // real). The loud unknown-option error is the guard that pushes the
    // operator to the lossless `-- <cmd> --flags` form below.
    .command('run [...command]', 'Run a command with Railway DATABASE_URL injected')
    .option('--env <env>', 'Environment: local, dev, or prod', { default: 'dev' })
    .option('--force', 'Skip confirmation for production operations')
    .example('pnpm ops run --env dev tsx scripts/<your-db-script>.ts')
    .example('pnpm ops run --env prod --force npx prisma studio')
    .example('pnpm ops run --env prod -- tsx scripts/backfill.ts --dry-run')
    .action(
      async (
        commandParts: string[],
        options: { env?: Environment; force?: boolean; '--'?: string[] }
      ) => {
        const { runWithEnv } = await import('../db/run-with-env.js');
        // Rest-args after "--" carry the wrapped command's own flags, which
        // cac would otherwise reject as unknown options of `ops run`.
        const fullCommand = [...commandParts, ...(options['--'] ?? [])];
        await runWithEnv(fullCommand, {
          env: options.env ?? 'dev',
          force: options.force,
        });
      }
    );
}
