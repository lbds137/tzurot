/**
 * BullMQ Connection Helpers
 *
 * Shared Redis URL resolution and queue/client creation for the ops commands
 * that talk to an environment's Redis (inspect:queue, inspect:dlq,
 * maintenance). This tooling always runs OFF-platform (a dev machine), which
 * drives two non-obvious choices below: the PUBLIC proxy URL (the internal
 * `redis.railway.internal` address only resolves inside Railway's network)
 * and IPv4 (the public proxy resolves A records; IPv6 is an in-platform
 * concern).
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
 * Railway service names to try for the Redis instance, in order. Railway's
 * Redis template names the service "Redis" (capitalized — this project's
 * actual name in both environments); the lowercase fallback covers
 * manually-created services. The lookup is case-sensitive on Railway's side.
 */
const REDIS_SERVICE_NAMES = ['Redis', 'redis'] as const;

/** Exec seam so tests can drive the Railway CLI lookup without spawning. */
export type ExecFn = (command: string, args: string[]) => string;

async function defaultExec(): Promise<ExecFn> {
  const { execFileSync } = await import('node:child_process');
  return (command, args) =>
    execFileSync(command, args, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
}

/**
 * Get a Redis URL reachable FROM THIS MACHINE for the environment.
 * - local: `REDIS_URL` env var or the localhost default.
 * - dev/prod: fetched from the Railway CLI, preferring `REDIS_PUBLIC_URL`
 *   (the proxy address) — the internal `REDIS_URL` does not resolve
 *   off-platform, so returning it produces a client that hangs/retries
 *   instead of connecting.
 */
export async function getRailwayRedisUrl(
  env: Environment,
  execFn?: ExecFn
): Promise<string | null> {
  if (env === 'local') {
    return process.env.REDIS_URL ?? 'redis://localhost:6379';
  }

  const exec = execFn ?? (await defaultExec());
  const railwayEnv = env === 'prod' ? 'production' : 'development';

  for (const service of REDIS_SERVICE_NAMES) {
    try {
      const result = exec('railway', [
        'variables',
        '--json',
        '--service',
        service,
        '--environment',
        railwayEnv,
      ]);
      const vars = JSON.parse(result) as Record<string, string>;
      const url = vars.REDIS_PUBLIC_URL ?? vars.REDIS_URL ?? null;
      if (url !== null) {
        return url;
      }
    } catch {
      // Unknown service name (or CLI hiccup) — try the next casing.
    }
  }

  console.error(chalk.red(`Failed to get Redis URL from Railway (${env})`));
  console.error(
    chalk.dim(
      `Make sure you are logged in (railway login) and a service named ` +
        `${REDIS_SERVICE_NAMES.join(' or ')} exists with REDIS_PUBLIC_URL set.`
    )
  );
  return null;
}

/**
 * Shared URL parsing + connection config for the inspector clients.
 *
 * `family: 4` unconditionally: this tooling runs off-platform against either
 * localhost or Railway's PUBLIC proxy, both IPv4. (The IPv6 requirement seen
 * in service code applies to Railway's internal network, which this tooling
 * never uses — forcing 6 here is what made remote connections hang.)
 *
 * Exported for tests — constructing real clients in tests would open sockets.
 */
export function buildInspectorRedisConfig(
  redisUrl: string
): ReturnType<typeof createBullMQRedisConfig> {
  const parsedUrl = parseRedisUrl(redisUrl);
  return createBullMQRedisConfig({
    ...parsedUrl,
    family: 4,
  });
}

/**
 * Create a BullMQ Queue connected to the given Redis URL.
 */
export function createInspectorQueue(redisUrl: string, queueName: string): Queue {
  return new Queue(queueName, { connection: buildInspectorRedisConfig(redisUrl) });
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
export function createInspectorRedis(redisUrl: string): Redis {
  return new Redis({
    ...buildInspectorRedisConfig(redisUrl),
    maxRetriesPerRequest: RETRY_CONFIG.REDIS_RETRIES_PER_REQUEST,
  });
}
