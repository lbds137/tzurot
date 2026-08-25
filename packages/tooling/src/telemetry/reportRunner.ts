/**
 * Shared shell for telemetry report commands
 *
 * Owns everything that is identical across the reports: `--days` validation,
 * environment resolution, Prisma client lifecycle, and output routing
 * (stdout vs `--output <file>`). Each report supplies one callback that
 * queries its data and returns the rendered markdown.
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

export interface TelemetryReportOptions {
  env: Environment;
  days?: number | string;
  output?: string;
}

/** Structural view of the Prisma client surface the reports consume. */
export interface PrismaQueryable {
  $queryRaw: <T>(strings: TemplateStringsArray, ...values: unknown[]) => Promise<T>;
}

/**
 * Parse and validate the `--days` option. Returns a positive integer or
 * throws a plain `Error` describing why the input was rejected — the runner
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

/**
 * Run one telemetry report end-to-end: validate options, resolve the
 * environment's database, hand a live client to `buildMarkdown`, and route
 * the result to stdout or `--output`. Read-only by contract — callbacks
 * issue SELECTs only.
 */
export async function runTelemetryReport(
  options: TelemetryReportOptions,
  buildMarkdown: (prisma: PrismaQueryable, env: Environment, days: number) => Promise<string>
): Promise<void> {
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
    const markdown = await buildMarkdown(prisma, env, days);

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
