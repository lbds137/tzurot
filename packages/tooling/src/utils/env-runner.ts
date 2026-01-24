/**
 * Environment Runner Utility
 *
 * Provides environment-aware execution of database operations.
 * - 'local': Uses DATABASE_URL from .env file
 * - 'dev': Fetches DATABASE_PUBLIC_URL from Railway dev environment
 * - 'prod': Fetches DATABASE_PUBLIC_URL from Railway prod environment
 */

import { spawn, execFileSync } from 'node:child_process';
import chalk from 'chalk';

export type Environment = 'local' | 'dev' | 'prod';

/**
 * Check if Railway CLI is installed and authenticated
 */
export function checkRailwayCli(): boolean {
  try {
    execFileSync('railway', ['whoami'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the Railway environment name from our shorthand
 */
export function getRailwayEnvName(env: Environment): string {
  switch (env) {
    case 'dev':
      return 'development';
    case 'prod':
      return 'production';
    default:
      throw new Error(`Cannot map '${env}' to Railway environment`);
  }
}

/**
 * Fetch DATABASE_PUBLIC_URL from Railway for a given environment
 *
 * Uses the pgvector service which has the public proxy URL configured.
 */
export function getRailwayDatabaseUrl(env: 'dev' | 'prod'): string {
  const railwayEnv = getRailwayEnvName(env);

  try {
    console.log(chalk.dim(`Fetching database URL from Railway ${railwayEnv}...`));

    // Use execFileSync with array args to prevent command injection
    const result = execFileSync(
      'railway',
      ['variables', '--environment', railwayEnv, '--service', 'pgvector', '--json'],
      { stdio: 'pipe', encoding: 'utf-8' }
    );

    const variables = JSON.parse(result) as Record<string, string>;
    const publicUrl = variables.DATABASE_PUBLIC_URL;

    if (!publicUrl) {
      throw new Error(`DATABASE_PUBLIC_URL not found in Railway ${railwayEnv} environment`);
    }

    return publicUrl;
  } catch (error) {
    if (error instanceof Error && error.message.includes('DATABASE_PUBLIC_URL not found')) {
      throw error;
    }
    throw new Error(
      `Failed to fetch database URL from Railway: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Run a command with Railway database URL injected
 *
 * Fetches the public database URL from Railway and runs the command locally.
 *
 * @param env - Railway environment ('dev' or 'prod')
 * @param command - The executable to run (e.g., 'npx')
 * @param args - Arguments to pass to the command (e.g., ['prisma', 'migrate', 'deploy'])
 *
 * SECURITY: Uses shell: false with explicit array arguments to prevent command injection.
 * The command and args are passed directly to the process, not through a shell.
 */
export async function runWithRailway(
  env: 'dev' | 'prod',
  command: string,
  args: string[] = []
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const databaseUrl = getRailwayDatabaseUrl(env);

  return new Promise((resolve, reject) => {
    // SECURITY: shell: false ensures args are passed directly without shell interpretation
    const proc = spawn(command, args, {
      stdio: ['inherit', 'pipe', 'pipe'],
      shell: false,
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
      },
    });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
      process.stdout.write(data);
    });

    proc.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
      process.stderr.write(data);
    });

    proc.on('close', code => {
      resolve({ stdout, stderr, exitCode: code ?? 0 });
    });

    proc.on('error', err => {
      reject(err);
    });
  });
}

/**
 * Known safe Prisma subcommands that can be executed
 * SECURITY: Only allow known commands to prevent injection via the command parameter
 */
const ALLOWED_PRISMA_COMMANDS = [
  'migrate',
  'db',
  'generate',
  'studio',
  'validate',
  'format',
] as const;

/**
 * Execute a Prisma command in the specified environment
 *
 * @param env - Environment to run in ('local', 'dev', or 'prod')
 * @param command - Prisma subcommand (must be one of ALLOWED_PRISMA_COMMANDS)
 * @param args - Additional arguments to pass to the command
 *
 * SECURITY: Uses shell: false with explicit array arguments to prevent command injection.
 * The command parameter is validated against a whitelist of known safe commands.
 */
export async function runPrismaCommand(
  env: Environment,
  command: string,
  args: string[] = []
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  // SECURITY: Validate command is a known safe value
  if (!ALLOWED_PRISMA_COMMANDS.includes(command as (typeof ALLOWED_PRISMA_COMMANDS)[number])) {
    throw new Error(
      `Invalid Prisma command: "${command}". Allowed: ${ALLOWED_PRISMA_COMMANDS.join(', ')}`
    );
  }

  // Build explicit array of arguments (no shell interpolation)
  const prismaArgs = ['prisma', command, ...args];

  if (env === 'local') {
    // Run directly with local DATABASE_URL
    return new Promise((resolve, reject) => {
      // SECURITY: shell: false ensures args are passed directly without shell interpretation
      const proc = spawn('npx', prismaArgs, {
        stdio: ['inherit', 'pipe', 'pipe'],
        shell: false,
        env: { ...process.env },
      });

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
        process.stdout.write(data);
      });

      proc.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
        process.stderr.write(data);
      });

      proc.on('close', code => {
        resolve({ stdout, stderr, exitCode: code ?? 0 });
      });

      proc.on('error', err => {
        reject(err);
      });
    });
  } else {
    // Run via Railway environment with injected DATABASE_URL
    return runWithRailway(env, 'npx', prismaArgs);
  }
}

/**
 * Validate environment before running database operations
 *
 * If DATABASE_URL is not set and env is 'local', suggests using --env dev instead.
 */
export function validateEnvironment(env: Environment): void {
  if (env === 'local') {
    if (!process.env.DATABASE_URL) {
      console.error(chalk.yellow('⚠️  DATABASE_URL not set in .env'));
      console.error(chalk.dim('   Use --env dev or --env prod to fetch URL from Railway'));
      console.error(chalk.dim('   Example: pnpm ops db:status --env dev'));
      process.exit(1);
    }
    return;
  }

  // Check Railway CLI for dev/prod
  if (!checkRailwayCli()) {
    console.error(chalk.red('❌ Railway CLI not authenticated'));
    console.error(chalk.dim('   Run: railway login'));
    process.exit(1);
  }
}

/**
 * Display environment info banner
 */
export function showEnvironmentBanner(env: Environment): void {
  const envColors: Record<Environment, typeof chalk.green> = {
    local: chalk.blue,
    dev: chalk.yellow,
    prod: chalk.red,
  };

  const envLabels: Record<Environment, string> = {
    local: 'LOCAL',
    dev: 'RAILWAY DEV',
    prod: 'RAILWAY PROD',
  };

  const color = envColors[env];
  const label = envLabels[env];

  console.log(color(`\n🗄️  Environment: ${label}`));
  console.log(color('─'.repeat(40)));
}

/**
 * Confirm production operation (returns true if confirmed)
 */
export async function confirmProductionOperation(operation: string): Promise<boolean> {
  const readline = await import('node:readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise(resolve => {
    console.log(chalk.red.bold('\n⚠️  PRODUCTION DATABASE OPERATION'));
    console.log(chalk.red(`You are about to ${operation} on PRODUCTION.`));
    console.log(chalk.dim('This action may be irreversible.\n'));

    rl.question(chalk.yellow('Type "yes" to confirm: '), answer => {
      rl.close();
      resolve(answer.toLowerCase() === 'yes');
    });
  });
}
