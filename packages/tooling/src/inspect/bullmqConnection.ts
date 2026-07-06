/**
 * BullMQ Connection Helpers
 *
 * Shared Redis URL resolution and queue creation for inspection commands.
 */

import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { RETRY_CONFIG } from '@tzurot/common-types/constants/timing';
import { parseRedisUrl, createBullMQRedisConfig } from '@tzurot/common-types/utils/redis';
import chalk from 'chalk';

import type { Environment } from '../utils/env-runner.js';

/** Default queue name used by Tzurot */
export const DEFAULT_QUEUE_NAME = 'ai-requests';

/**
 * Get Redis URL for environment.
 * For local: uses REDIS_URL env var or localhost default.
 * For dev/prod: fetches from Railway CLI.
 */
export async function getRailwayRedisUrl(env: Environment): Promise<string | null> {
  if (env === 'local') {
    return process.env.REDIS_URL ?? 'redis://localhost:6379';
  }

  const { execFileSync } = await import('node:child_process');
  const railwayEnv = env === 'prod' ? 'production' : 'development';

  try {
    const result = execFileSync(
      'railway',
      ['variables', '--json', '--service', 'redis', '--environment', railwayEnv],
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    );

    const vars = JSON.parse(result) as Record<string, string>;
    return vars.REDIS_URL ?? null;
  } catch {
    console.error(chalk.red(`Failed to get Redis URL from Railway (${env})`));
    console.error(chalk.dim('Make sure you are logged in: railway login'));
    return null;
  }
}

/** Shared URL parsing + IPv4/IPv6 family selection (Railway's network is IPv6). */
function buildRedisConfig(
  redisUrl: string,
  env: Environment
): ReturnType<typeof createBullMQRedisConfig> {
  const parsedUrl = parseRedisUrl(redisUrl);
  return createBullMQRedisConfig({
    ...parsedUrl,
    family: env === 'local' ? 4 : 6,
  });
}

/**
 * Create a BullMQ Queue connected to the given Redis URL.
 * Handles URL parsing and IPv4/IPv6 family selection.
 */
export function createInspectorQueue(redisUrl: string, queueName: string, env: Environment): Queue {
  return new Queue(queueName, { connection: buildRedisConfig(redisUrl, env) });
}

/**
 * Create a plain ioredis client with the SAME URL-handling path as the
 * inspector queue — one config builder, not two (used by `ops maintenance`
 * for the flag key alongside its queue handles).
 *
 * `maxRetriesPerRequest` is re-bounded from BullMQ's required `null` to the
 * standard ad-hoc value: a CLI hitting an unreachable Redis should fail fast
 * with the friendly error, not sit through the full reconnect backoff.
 */
export function createInspectorRedis(redisUrl: string, env: Environment): Redis {
  return new Redis({
    ...buildRedisConfig(redisUrl, env),
    maxRetriesPerRequest: RETRY_CONFIG.REDIS_RETRIES_PER_REQUEST,
  });
}
