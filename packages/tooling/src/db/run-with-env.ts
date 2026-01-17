/**
 * Generic Environment Runner
 *
 * Runs arbitrary commands with Railway database credentials injected.
 * This is the implementation for `pnpm ops run --env <env> -- <command>`.
 *
 * Usage:
 *   pnpm ops run --env dev -- pnpm --filter @tzurot/scripts run db:backfill-local-embeddings
 *   pnpm ops run --env prod -- npx prisma studio
 *   pnpm ops run --env dev -- tsx scripts/src/db/some-script.ts
 */

import chalk from 'chalk';
import {
  type Environment,
  validateEnvironment,
  showEnvironmentBanner,
  runWithRailway,
  confirmProductionOperation,
} from '../utils/env-runner.js';

export interface RunWithEnvOptions {
  env: Environment;
  force?: boolean;
}

/**
 * Run an arbitrary command with Railway DATABASE_URL injected
 */
export async function runWithEnv(
  commandParts: string[],
  options: RunWithEnvOptions
): Promise<void> {
  const { env, force } = options;

  if (commandParts.length === 0) {
    console.error(chalk.red('❌ No command specified'));
    console.error(chalk.dim('Usage: pnpm ops run --env dev <command> [args...]'));
    console.error(
      chalk.dim('Example: pnpm ops run --env dev tsx scripts/src/db/backfill-local-embeddings.ts')
    );
    process.exit(1);
  }

  // Validate environment
  validateEnvironment(env);
  showEnvironmentBanner(env);

  // Production safety check
  if (env === 'prod' && !force) {
    const confirmed = await confirmProductionOperation(`run: ${commandParts.join(' ')}`);
    if (!confirmed) {
      console.log(chalk.yellow('Operation cancelled.'));
      process.exit(0);
    }
  }

  const [command, ...args] = commandParts;

  console.log(chalk.cyan(`\n🚀 Executing: ${command} ${args.join(' ')}\n`));

  if (env === 'local') {
    // For local, just spawn the command with current environment
    const { spawn } = await import('node:child_process');

    const result = await new Promise<number>((resolve, reject) => {
      const proc = spawn(command, args, {
        stdio: 'inherit',
        shell: false,
        env: process.env,
      });

      proc.on('close', code => resolve(code ?? 0));
      proc.on('error', reject);
    });

    process.exit(result);
  } else {
    // For dev/prod, use runWithRailway to inject DATABASE_URL
    const result = await runWithRailway(env, command, args);
    process.exit(result.exitCode);
  }
}
