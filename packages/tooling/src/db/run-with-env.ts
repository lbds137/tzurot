/**
 * Generic Environment Runner
 *
 * Runs arbitrary commands with Railway database credentials injected.
 * This is the implementation for `pnpm ops run --env <env> <command>`.
 *
 * Usage:
 *   pnpm ops run --env dev tsx scripts/<your-db-script>.ts
 *   pnpm ops run --env prod npx prisma studio
 *   pnpm with-env prod npx prisma studio  (shortcut)
 */

import chalk from 'chalk';
import {
  type Environment,
  validateEnvironment,
  showEnvironmentBanner,
  runWithRailway,
  requireProductionConfirmation,
} from '../utils/env-runner.js';
import { resolveExtraRailwayVars } from '../utils/railway-extra-vars.js';

interface RunWithEnvOptions {
  env: Environment;
  force?: boolean;
  /** Extra Railway variable NAMES (shared/project tier) to inject; dev/prod only. */
  withVars?: string[];
}

/**
 * Run an arbitrary command with Railway DATABASE_URL injected
 */
export async function runWithEnv(
  commandParts: string[],
  options: RunWithEnvOptions
): Promise<void> {
  const { env, force, withVars } = options;

  if (commandParts.length === 0) {
    console.error(chalk.red('❌ No command specified'));
    console.error(chalk.dim('Usage: pnpm ops run --env dev <command> [args...]'));
    console.error(chalk.dim('Example: pnpm ops run --env dev tsx scripts/<your-db-script>.ts'));
    process.exit(1);
  }

  // --with reads Railway variables, so it needs a Railway environment to read from.
  if (withVars !== undefined && withVars.length > 0 && env === 'local') {
    console.error(chalk.red('❌ --with requires --env dev or --env prod'));
    console.error(
      chalk.dim('There is no Railway environment to read variables from for --env local')
    );
    process.exit(1);
  }

  // Validate environment
  validateEnvironment(env);
  showEnvironmentBanner(env);

  // Production safety check
  if (env === 'prod' && !force) {
    await requireProductionConfirmation(`run: ${commandParts.join(' ')}`);
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
      proc.on('error', error => {
        // Enhance error with command context for better debugging
        const enhancedError = new Error(`Failed to spawn '${command}': ${error.message}`);
        enhancedError.cause = error;
        reject(enhancedError);
      });
    });

    process.exit(result);
  } else {
    // For dev/prod, resolve any --with variables (never logged), then use
    // runWithRailway to inject DATABASE_URL alongside them.
    const extra = await resolveExtraRailwayVars(env, withVars ?? []);
    if (Object.keys(extra).length > 0) {
      console.log(chalk.dim(`injected: ${['DATABASE_URL', ...Object.keys(extra)].join(', ')}`));
    }

    const result = await runWithRailway(env, command, args, undefined, extra);
    process.exit(result.exitCode);
  }
}
