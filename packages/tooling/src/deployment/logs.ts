/**
 * Railway Log Fetcher
 *
 * Fetches and displays logs from Railway services.
 * Supports filtering by service, time range, and log level.
 *
 * Correlation flags (`--request-id`, `--job-id`) deliberately do NOT
 * translate to Railway's server-side `--filter` DSL: hyphenated tokens
 * (UUIDs are all hyphens) and quoted phrases frequently match nothing in
 * that engine. They implement the reliable incident-dig pattern instead —
 * pull a window (capped at the CLI's ~5000-line limit) and substring-match
 * locally, sweeping all app services when none is specified so the
 * cross-service trace lands in one command.
 *
 * Exit-code contract: a sweep where ANY service window fails to fetch exits
 * non-zero even if other services returned matches — incomplete data should
 * never read as a clean dig. Automation wanting best-effort semantics should
 * check for output rather than exit code.
 */

import { execFileSync } from 'node:child_process';
import chalk from 'chalk';
import { checkRailwayCli, getRailwayEnvName } from '../utils/env-runner.js';

interface LogsOptions {
  env: 'dev' | 'prod';
  service?: string;
  lines?: number;
  filter?: string;
  follow?: boolean;
  /** Correlation term: match lines containing this request ID (local substring). */
  requestId?: string;
  /** Correlation term: match lines containing this job ID (local substring). */
  jobId?: string;
  /** Time floor: ISO-8601 timestamp or relative (`30m`, `2h`, `1d`). Local filter on pino `time`. */
  since?: string;
}

// Known services in the Tzurot project
const KNOWN_SERVICES = ['bot-client', 'api-gateway', 'ai-worker', 'pgvector', 'redis'] as const;

/** Services swept by correlation mode — the ones that carry request/job IDs. */
const APP_SERVICES = ['bot-client', 'api-gateway', 'ai-worker'] as const;

/**
 * Railway CLI hard limit: `-n` values above ~5000 don't degrade gracefully —
 * they error out and return ZERO rows, which reads as "no matching logs".
 * Clamp instead; to reach further back, narrow by deployment ID
 * (`railway deployment list` → `railway logs <id>`).
 */
const MAX_LINES = 5000;

/** Default window in correlation mode — a dig wants depth, not the last screenful. */
const CORRELATION_DEFAULT_LINES = MAX_LINES;

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
  // eslint-disable-next-line sonarjs/no-duplicate-string -- CLI decorative separator shared across display functions
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
  console.log(chalk.dim('💡 Tips (--filter uses Railway query DSL):'));
  console.log(chalk.dim('   pnpm ops logs --env dev --service api-gateway'));
  console.log(chalk.dim('   pnpm ops logs --env dev --filter "@level:error"'));
  console.log(chalk.dim('   pnpm ops logs --env prod --request-id <uuid>   # cross-service dig'));
  console.log(chalk.dim('   pnpm ops logs --env prod --job-id <id> --since 2h'));
  console.log(chalk.dim('   Correlation reads the CURRENT deployment; for older windows use'));
  console.log(chalk.dim('   `railway deployment list` + `railway logs <deployment-id>`.'));
  console.log(chalk.cyan.bold('═══════════════════════════════════════════════════════'));
}

/**
 * Parse `--since` into an epoch-ms floor. Accepts ISO-8601 (anything
 * `Date.parse` takes) or a relative suffix form: `45m`, `6h`, `2d`.
 * Exported for direct unit testing.
 */
export function parseSinceMs(since: string, nowMs: number): number {
  const relative = /^(\d+)([mhd])$/i.exec(since.trim());
  if (relative !== null) {
    const amount = Number(relative[1]);
    const unit = relative[2].toLowerCase() as 'm' | 'h' | 'd';
    const unitMs = { m: 60_000, h: 3_600_000, d: 86_400_000 }[unit];
    return nowMs - amount * unitMs;
  }
  const parsed = Date.parse(since);
  if (Number.isNaN(parsed)) {
    throw new Error(
      `Cannot parse --since "${since}" — use ISO-8601 (2026-07-03T02:00:00Z) or relative (45m, 6h, 2d)`
    );
  }
  return parsed;
}

/** Extract the pino epoch-ms `time` field from a JSON log line, if present. */
function lineTimeMs(line: string): number | undefined {
  const match = /"time":\s*(\d{10,})/.exec(line);
  return match === null ? undefined : Number(match[1]);
}

/**
 * Local line filtering: every correlation term must appear (case-insensitive
 * substring — predictable, unlike the server DSL), and when a time floor is
 * set, only lines whose pino `time` is at/after it survive (lines without a
 * parseable time are dropped in since-mode; they're boot noise, not events).
 */
export function applyLocalFilters(logs: string, terms: string[], sinceMs?: number): string[] {
  const lowered = terms.map(t => t.toLowerCase());
  return logs.split('\n').filter(line => {
    if (line.trim().length === 0) {
      return false;
    }
    const lineLower = line.toLowerCase();
    if (!lowered.every(term => lineLower.includes(term))) {
      return false;
    }
    if (sinceMs !== undefined) {
      const time = lineTimeMs(line);
      return time !== undefined && time >= sinceMs;
    }
    return true;
  });
}

/**
 * Stream logs in follow mode using spawn
 */
async function streamLogsWithFollow(args: string[]): Promise<void> {
  const { spawn } = await import('node:child_process');
  const proc = spawn('railway', args, {
    stdio: ['inherit', 'pipe', 'pipe'],
    shell: false,
  });

  proc.stdout?.on('data', (data: Buffer) => {
    const output = data.toString();
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
function fetchLogsSync(args: string[]): void {
  const result = execFileSync('railway', args, {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large log output
  });

  if (result.trim()) {
    console.log(colorizeLogs(result));
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
 * Build the `railway logs` argument vector for one fetch.
 * `--filter` passes through as a Railway 4.11.2 server-side query (attribute
 * filters like `@level:error`, boolean operators like `"vision AND 404"`).
 */
function buildRailwayArgs(opts: {
  railwayEnv: string;
  service?: string;
  lines: number;
  filter?: string;
  follow?: boolean;
}): string[] {
  const args = ['logs', '--environment', opts.railwayEnv];
  if (opts.service !== undefined && opts.service.length > 0) {
    args.push('--service', opts.service);
  }
  args.push('-n', String(opts.lines));
  if (opts.filter !== undefined) {
    args.push('--filter', opts.filter);
  }
  if (opts.follow === true) {
    args.push('--follow');
  }
  return args;
}

/**
 * Correlation/since dig: window-fetch per service, filter locally, print
 * labeled sections. Sweeps all app services when none was specified.
 */
function runLocalFilterDig(opts: {
  railwayEnv: string;
  service?: string;
  lines: number;
  filter?: string;
  terms: string[];
  sinceMs?: number;
}): void {
  const services: string[] = opts.service !== undefined ? [opts.service] : [...APP_SERVICES];

  let totalMatched = 0;
  for (const svc of services) {
    const args = buildRailwayArgs({
      railwayEnv: opts.railwayEnv,
      service: svc,
      lines: opts.lines,
      filter: opts.filter,
    });
    let raw: string;
    try {
      raw = execFileSync('railway', args, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        maxBuffer: 10 * 1024 * 1024,
      });
    } catch (error) {
      handleLogsError(error, svc);
      continue;
    }

    const matched = applyLocalFilters(raw, opts.terms, opts.sinceMs);
    totalMatched += matched.length;
    if (services.length > 1) {
      console.log(chalk.cyan.bold(`\n── ${svc} ──`));
    }
    if (matched.length === 0) {
      console.log(chalk.dim('   (no matching lines in this window)'));
    } else {
      console.log(colorizeLogs(matched.join('\n')));
    }
  }

  console.log('');
  console.log(
    chalk.dim(
      `${totalMatched} matching line(s) across ${services.length} service window(s) of ${opts.lines} lines each.`
    )
  );
}

/**
 * Validate + resolve the window bounds (`--since` floor, `--lines` count).
 * Prints the error and returns null on invalid input; the caller exits.
 */
function resolveWindowBounds(
  options: LogsOptions,
  digMode: boolean
): { sinceMs?: number; lines: number } | null {
  let sinceMs: number | undefined;
  if (options.since !== undefined) {
    try {
      sinceMs = parseSinceMs(options.since, Date.now());
    } catch (error) {
      console.error(chalk.red(`❌ ${error instanceof Error ? error.message : String(error)}`));
      process.exitCode = 1;
      return null;
    }
  }

  const requestedLines = options.lines ?? (digMode ? CORRELATION_DEFAULT_LINES : 100);
  if (!Number.isFinite(requestedLines) || requestedLines <= 0) {
    // NaN silently comparing false against the cap would forward `-n NaN`
    // to the railway CLI — a confusing downstream failure instead of this.
    console.error(chalk.red(`❌ --lines must be a positive number, got "${options.lines}"`));
    process.exitCode = 1;
    return null;
  }
  if (requestedLines > MAX_LINES) {
    console.log(
      chalk.yellow(
        `⚠️  --lines ${requestedLines} exceeds the Railway CLI cap (~${MAX_LINES}); ` +
          `clamping to ${MAX_LINES}. For older windows, use \`railway logs <deployment-id>\`.`
      )
    );
    return { sinceMs, lines: MAX_LINES };
  }
  return { sinceMs, lines: requestedLines };
}

/**
 * Fetch logs from Railway service
 */
export async function fetchLogs(options: LogsOptions): Promise<void> {
  const { env, service, filter, follow = false, requestId, jobId, since } = options;

  if (!checkRailwayCli()) {
    console.error(chalk.red('❌ Railway CLI not authenticated'));
    console.error(chalk.dim('   Run: railway login'));
    process.exitCode = 1;
    return;
  }

  const terms = [requestId, jobId].filter(
    (t): t is string => typeof t === 'string' && t.length > 0
  );
  const digMode = terms.length > 0 || since !== undefined;

  if (digMode && follow) {
    console.error(chalk.red('❌ --request-id/--job-id/--since cannot combine with --follow'));
    console.error(chalk.dim('   They filter a fetched window; --follow is a live stream.'));
    process.exitCode = 1;
    return;
  }

  const bounds = resolveWindowBounds(options, digMode);
  if (bounds === null) {
    return;
  }
  const { sinceMs, lines } = bounds;

  const railwayEnv = getRailwayEnvName(env);
  const validatedService = validateService(service);

  // Header shows BOTH filter layers when they compose: the server-side DSL
  // narrows the fetched window, then the correlation terms match locally.
  const filterDisplay = [
    filter,
    terms.length > 0 ? `local terms: ${terms.join(' AND ')}` : undefined,
  ]
    .filter((part): part is string => part !== undefined && part.length > 0)
    .join(' | ');
  displayHeader(railwayEnv, validatedService, lines, filterDisplay);

  try {
    if (digMode) {
      runLocalFilterDig({ railwayEnv, service: validatedService, lines, filter, terms, sinceMs });
    } else if (follow) {
      await streamLogsWithFollow(
        buildRailwayArgs({ railwayEnv, service: validatedService, lines, filter, follow })
      );
    } else {
      fetchLogsSync(buildRailwayArgs({ railwayEnv, service: validatedService, lines, filter }));
    }
  } catch (error) {
    handleLogsError(error, validatedService);
  }

  displayFooter();
}
