/**
 * Command discoverability report
 *
 * Read-only SQL over `command_events` for a trailing window: which commands
 * get used, how many distinct users reach each one, and how broadly any
 * single user's command vocabulary spans. Never mutates, never emits a raw
 * user id.
 */

import { writeFileSync } from 'node:fs';
import chalk from 'chalk';
import { DB_POOL_DEFAULTS } from '@tzurot/common-types/services/poolConfig';
import { createPrismaClient } from '@tzurot/common-types/services/prisma';
import {
  type Environment,
  validateEnvironment,
  showEnvironmentBanner,
  getRailwayDatabaseUrl,
} from '../utils/env-runner.js';

/**
 * A row is flagged when its user_error share meets or exceeds this ratio —
 * marking a command whose asks routinely fail rather than merely occasionally.
 */
const USER_ERROR_RATIO_THRESHOLD = 0.2;

/** Below this many invocations, a ratio is noise rather than signal. */
const USER_ERROR_MIN_INVOCATIONS = 5;

export interface TelemetryReportOptions {
  env: Environment;
  days?: number | string;
  output?: string;
}

/** Raw shape returned by the per-command query — counts arrive as `bigint`. */
export interface PerCommandRawRow {
  command: string;
  invocations: bigint;
  distinct_users: bigint;
  ok_count: bigint;
  user_error_count: bigint;
  system_error_count: bigint;
}

/** Raw shape returned by the breadth-distribution query. */
export interface BreadthRawRow {
  breadth: bigint;
  user_count: bigint;
}

/** Raw shape returned by the header-stats query. */
export interface HeaderRawRow {
  total_events: bigint;
  distinct_users: bigint;
  distinct_commands: bigint;
}

/** Domain (number-typed) shape for a per-command table row. */
export interface PerCommandStats {
  command: string;
  invocations: number;
  distinctUsers: number;
  okCount: number;
  userErrorCount: number;
  systemErrorCount: number;
  otherCount: number;
  userErrorRatio: number;
  flagged: boolean;
}

/** Domain shape for the header summary. */
export interface HeaderStats {
  totalEvents: number;
  distinctUsers: number;
  distinctCommands: number;
}

/** One bucket of the command-breadth distribution. */
export interface BreadthBucket {
  label: '1' | '2–3' | '4–6' | '7+';
  userCount: number;
}

export interface ReportData {
  days: number;
  env: Environment;
  generatedAt: Date;
  header: HeaderStats;
  perCommand: PerCommandStats[];
  breadthBuckets: BreadthBucket[];
}

/**
 * Parse and validate the `--days` option. Returns a positive integer or
 * throws a plain `Error` describing why the input was rejected — the caller
 * prints it and returns before opening a DB connection.
 */
export function parseDays(input: number | string | undefined): number {
  if (input === undefined) {
    return 30;
  }
  const asNumber = typeof input === 'string' ? Number(input) : input;
  if (!Number.isInteger(asNumber) || asNumber <= 0) {
    throw new Error(`--days must be a positive integer, got: ${String(input)}`);
  }
  return asNumber;
}

/** Bucket a single breadth value into one of the four fixed labels. */
function bucketLabelFor(breadth: number): BreadthBucket['label'] {
  if (breadth <= 1) return '1';
  if (breadth <= 3) return '2–3';
  if (breadth <= 6) return '4–6';
  return '7+';
}

/** Fold raw breadth-distribution rows into the four fixed buckets. */
export function bucketBreadth(rows: { breadth: number; userCount: number }[]): BreadthBucket[] {
  const totals = new Map<BreadthBucket['label'], number>([
    ['1', 0],
    ['2–3', 0],
    ['4–6', 0],
    ['7+', 0],
  ]);
  for (const row of rows) {
    const label = bucketLabelFor(row.breadth);
    totals.set(label, (totals.get(label) ?? 0) + row.userCount);
  }
  return (['1', '2–3', '4–6', '7+'] as const).map(label => ({
    label,
    userCount: totals.get(label) ?? 0,
  }));
}

/** Whether a per-command row's user_error share is elevated enough to flag. */
export function isUserErrorFlagged(invocations: number, userErrorCount: number): boolean {
  if (invocations < USER_ERROR_MIN_INVOCATIONS) {
    return false;
  }
  return userErrorCount / invocations >= USER_ERROR_RATIO_THRESHOLD;
}

function toPerCommandStats(row: PerCommandRawRow): PerCommandStats {
  const invocations = Number(row.invocations);
  const okCount = Number(row.ok_count);
  const userErrorCount = Number(row.user_error_count);
  const systemErrorCount = Number(row.system_error_count);
  const otherCount = invocations - okCount - userErrorCount - systemErrorCount;
  return {
    command: row.command,
    invocations,
    distinctUsers: Number(row.distinct_users),
    okCount,
    userErrorCount,
    systemErrorCount,
    otherCount,
    userErrorRatio: invocations > 0 ? userErrorCount / invocations : 0,
    flagged: isUserErrorFlagged(invocations, userErrorCount),
  };
}

function renderPerCommandTable(rows: PerCommandStats[]): string {
  const header =
    '| Command | Invocations | Users | ok | user_error | system_error | other | user_error % |\n' +
    '| --- | --- | --- | --- | --- | --- | --- | --- |';
  const lines = rows.map(row => {
    const pct = (row.userErrorRatio * 100).toFixed(1);
    const marker = row.flagged ? ' ⚠️' : '';
    return `| ${row.command}${marker} | ${row.invocations} | ${row.distinctUsers} | ${row.okCount} | ${row.userErrorCount} | ${row.systemErrorCount} | ${row.otherCount} | ${pct}% |`;
  });
  return [header, ...lines].join('\n');
}

function renderDarkFeatures(rows: PerCommandStats[]): string {
  const dark = rows.filter(row => row.distinctUsers <= 1);
  if (dark.length === 0) {
    return 'None in this window.';
  }
  return dark
    .map(row => `- \`${row.command}\` — ${row.invocations} invocation(s), single distinct user`)
    .join('\n');
}

function renderBreadthTable(buckets: BreadthBucket[]): string {
  const header = '| Distinct commands used | Users |\n| --- | --- |';
  const lines = buckets.map(bucket => `| ${bucket.label} | ${bucket.userCount} |`);
  return [header, ...lines].join('\n');
}

const LIMITATIONS_PARAGRAPH =
  'A command never invoked in this window produces no row and is invisible to ' +
  'this report — the darkest features are exactly the ones missing from it. ' +
  'Cross-check the per-command table against the live command roster manually ' +
  'until a roster join exists.';

/** Pure renderer: markdown from already-computed report data, no DB. */
export function renderDiscoverabilityMarkdown(data: ReportData): string {
  const sections = [
    '# Command discoverability report',
    `Window: trailing ${data.days} days · env: ${data.env} · generated at ${data.generatedAt.toISOString()}`,
    '## Summary',
    `- Total invocations: ${data.header.totalEvents}\n- Distinct users: ${data.header.distinctUsers}\n- Distinct commands: ${data.header.distinctCommands}`,
    '## Per-command',
    renderPerCommandTable(data.perCommand),
    '## Dark features (≤1 distinct user)',
    renderDarkFeatures(data.perCommand),
    '## Command breadth',
    renderBreadthTable(data.breadthBuckets),
    '## Limitations',
    LIMITATIONS_PARAGRAPH,
  ];
  return sections.join('\n\n') + '\n';
}

async function queryReportData(
  prisma: { $queryRaw: <T>(strings: TemplateStringsArray, ...values: unknown[]) => Promise<T> },
  env: Environment,
  days: number
): Promise<ReportData> {
  const perCommandRaw = await prisma.$queryRaw<PerCommandRawRow[]>`
    SELECT command,
           COUNT(*)                                         AS invocations,
           COUNT(DISTINCT user_id)                          AS distinct_users,
           COUNT(*) FILTER (WHERE outcome = 'ok')           AS ok_count,
           COUNT(*) FILTER (WHERE outcome = 'user_error')   AS user_error_count,
           COUNT(*) FILTER (WHERE outcome = 'system_error') AS system_error_count
    FROM command_events
    WHERE occurred_at >= now() - (interval '1 day' * ${days})
    GROUP BY command
    ORDER BY invocations DESC
  `;

  const breadthRaw = await prisma.$queryRaw<BreadthRawRow[]>`
    SELECT breadth, COUNT(*) AS user_count
    FROM (SELECT user_id, COUNT(DISTINCT command) AS breadth
          FROM command_events
          WHERE occurred_at >= now() - (interval '1 day' * ${days})
          GROUP BY user_id) per_user
    GROUP BY breadth
    ORDER BY breadth
  `;

  const headerRaw = await prisma.$queryRaw<HeaderRawRow[]>`
    SELECT COUNT(*) AS total_events,
           COUNT(DISTINCT user_id) AS distinct_users,
           COUNT(DISTINCT command) AS distinct_commands
    FROM command_events
    WHERE occurred_at >= now() - (interval '1 day' * ${days})
  `;

  const headerRow = headerRaw[0];
  const header: HeaderStats = {
    totalEvents: headerRow !== undefined ? Number(headerRow.total_events) : 0,
    distinctUsers: headerRow !== undefined ? Number(headerRow.distinct_users) : 0,
    distinctCommands: headerRow !== undefined ? Number(headerRow.distinct_commands) : 0,
  };

  return {
    days,
    env,
    generatedAt: new Date(),
    header,
    perCommand: perCommandRaw.map(toPerCommandStats),
    breadthBuckets: bucketBreadth(
      breadthRaw.map(row => ({ breadth: Number(row.breadth), userCount: Number(row.user_count) }))
    ),
  };
}

/**
 * Print (or write to file) a command discoverability report over a trailing
 * window. Read-only: SELECTs only, never mutates `command_events`.
 */
export async function telemetryReport(options: TelemetryReportOptions): Promise<void> {
  let days: number;
  try {
    days = parseDays(options.days);
  } catch (error) {
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
    return;
  }

  const env = options.env;
  validateEnvironment(env);
  showEnvironmentBanner(env);

  if (env !== 'local') {
    process.env.DATABASE_URL = getRailwayDatabaseUrl(env);
  }

  const { prisma, dispose } = createPrismaClient({ max: DB_POOL_DEFAULTS.TRANSIENT_MAX });

  try {
    const data = await queryReportData(prisma, env, days);
    const markdown = renderDiscoverabilityMarkdown(data);

    if (options.output !== undefined) {
      writeFileSync(options.output, markdown, 'utf-8');
      console.log(chalk.dim(`Report written to ${options.output}`));
    } else {
      console.log(markdown);
    }
  } finally {
    await dispose().catch(() => undefined);
  }
}
