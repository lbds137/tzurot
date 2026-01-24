/**
 * Railway Log Fetcher
 *
 * Fetches and displays logs from Railway services.
 * Supports filtering by service, time range, and log level.
 */

import { execFileSync } from 'node:child_process';
import chalk from 'chalk';
import { checkRailwayCli, getRailwayEnvName } from '../utils/env-runner.js';

export interface LogsOptions {
  env: 'dev' | 'prod';
  service?: string;
  lines?: number;
  filter?: string;
  follow?: boolean;
}

// Known services in the Tzurot project
const KNOWN_SERVICES = ['bot-client', 'api-gateway', 'ai-worker', 'pgvector', 'redis'] as const;

/**
 * Validate and get the service name
 */
function validateService(service: string | undefined): string | undefined {
  if (!service) return undefined;

  // Allow known services or any custom service name
  if (KNOWN_SERVICES.includes(service as (typeof KNOWN_SERVICES)[number])) {
    return service;
  }

  // Warn about unknown service but allow it
  console.log(
    chalk.yellow(`⚠️  Unknown service "${service}". Known services: ${KNOWN_SERVICES.join(', ')}`)
  );
  return service;
}

/**
 * Filter log lines by keyword or log level
 */
function filterLogs(logs: string, filter: string | undefined): string {
  if (!filter) return logs;

  const filterLower = filter.toLowerCase();
  const lines = logs.split('\n');

  // Check if filter is a log level
  const logLevels = ['error', 'warn', 'info', 'debug'];
  const isLevelFilter = logLevels.includes(filterLower);

  return lines
    .filter(line => {
      const lineLower = line.toLowerCase();
      if (isLevelFilter) {
        // For level filters, match the level keyword
        return (
          lineLower.includes(`"level":"${filterLower}"`) ||
          lineLower.includes(`level=${filterLower}`)
        );
      }
      // For other filters, do a simple substring match
      return lineLower.includes(filterLower);
    })
    .join('\n');
}

/**
 * Colorize log output based on log level
 */
function colorizeLogs(logs: string): string {
  return logs
    .split('\n')
    .map(line => {
      const lineLower = line.toLowerCase();
      if (lineLower.includes('"level":"error"') || lineLower.includes('level=error')) {
        return chalk.red(line);
      }
      if (lineLower.includes('"level":"warn"') || lineLower.includes('level=warn')) {
        return chalk.yellow(line);
      }
      if (lineLower.includes('"level":"debug"') || lineLower.includes('level=debug')) {
        return chalk.dim(line);
      }
      return line;
    })
    .join('\n');
}

/**
 * Display the logs header
 */
function displayHeader(
  railwayEnv: string,
  validatedService: string | undefined,
  lines: number,
  filter?: string
): void {
  console.log(chalk.cyan.bold('═══════════════════════════════════════════════════════'));
  console.log(chalk.cyan.bold(`           RAILWAY LOGS - ${railwayEnv.toUpperCase()}`));
  console.log(chalk.cyan.bold('═══════════════════════════════════════════════════════'));
  console.log('');
  console.log(chalk.dim(`Service: ${validatedService ?? 'All services'}`));
  console.log(chalk.dim(`Lines: ${lines}`));
  if (filter) {
    console.log(chalk.dim(`Filter: ${filter}`));
  }
  console.log('');
}

/**
 * Display the logs footer with tips
 */
function displayFooter(): void {
  console.log('');
  console.log(chalk.cyan.bold('═══════════════════════════════════════════════════════'));
  console.log(chalk.dim('💡 Tips:'));
  console.log(chalk.dim('   pnpm ops logs --env dev --service api-gateway'));
  console.log(chalk.dim('   pnpm ops logs --env dev --filter error'));
  console.log(chalk.dim('   pnpm ops logs --env dev --follow'));
  console.log(chalk.cyan.bold('═══════════════════════════════════════════════════════'));
}

/**
 * Stream logs in follow mode using spawn
 */
async function streamLogsWithFollow(args: string[], filter: string | undefined): Promise<void> {
  const { spawn } = await import('node:child_process');
  const proc = spawn('railway', args, {
    stdio: ['inherit', 'pipe', 'pipe'],
    shell: false,
  });

  proc.stdout?.on('data', (data: Buffer) => {
    let output = data.toString();
    if (filter) {
      output = filterLogs(output, filter);
    }
    if (output.trim()) {
      process.stdout.write(colorizeLogs(output));
    }
  });

  proc.stderr?.on('data', (data: Buffer) => {
    process.stderr.write(chalk.red(data.toString()));
  });

  proc.on('error', err => {
    console.error(chalk.red(`❌ Failed to fetch logs: ${err.message}`));
    process.exitCode = 1;
  });

  // Handle Ctrl+C gracefully
  process.once('SIGINT', () => {
    proc.kill();
    console.log(chalk.dim('\n\nLog streaming stopped.'));
    process.exit(0);
  });
}

/**
 * Fetch logs synchronously (non-follow mode)
 */
function fetchLogsSync(args: string[], filter: string | undefined): void {
  const result = execFileSync('railway', args, {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large log output
  });

  let output = result;
  if (filter) {
    output = filterLogs(output, filter);
  }

  if (output.trim()) {
    console.log(colorizeLogs(output));
  } else {
    console.log(chalk.dim('No logs found matching the criteria.'));
  }
}

/**
 * Handle Railway CLI errors with helpful messages
 */
function handleLogsError(error: unknown, validatedService: string | undefined): void {
  if (error instanceof Error) {
    if (error.message.includes('service not found')) {
      console.error(chalk.red(`❌ Service not found: ${validatedService}`));
      console.error(chalk.dim(`   Available services: ${KNOWN_SERVICES.join(', ')}`));
    } else if (error.message.includes('not linked')) {
      console.error(chalk.red('❌ Railway project not linked'));
      console.error(chalk.dim('   Run: railway link'));
    } else {
      console.error(chalk.red(`❌ Failed to fetch logs: ${error.message}`));
    }
  }
  process.exitCode = 1;
}

/**
 * Fetch logs from Railway service
 */
export async function fetchLogs(options: LogsOptions): Promise<void> {
  const { env, service, lines = 100, filter, follow = false } = options;

  if (!checkRailwayCli()) {
    console.error(chalk.red('❌ Railway CLI not authenticated'));
    console.error(chalk.dim('   Run: railway login'));
    process.exitCode = 1;
    return;
  }

  const railwayEnv = getRailwayEnvName(env);
  const validatedService = validateService(service);

  displayHeader(railwayEnv, validatedService, lines, filter);

  // Build Railway logs command arguments
  const args = ['logs', '--environment', railwayEnv];
  if (validatedService) {
    args.push('--service', validatedService);
  }
  args.push('-n', String(lines));
  if (follow) {
    args.push('--follow');
  }

  try {
    if (follow) {
      await streamLogsWithFollow(args, filter);
    } else {
      fetchLogsSync(args, filter);
    }
  } catch (error) {
    handleLogsError(error, validatedService);
  }

  displayFooter();
}
