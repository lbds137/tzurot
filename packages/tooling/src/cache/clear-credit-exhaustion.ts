/**
 * Credit-Exhaustion Cache Clear
 *
 * Operator escape valve for the OpenRouter credit-exhaustion cache. Used when
 * a user reports being blocked by the cache after topping up their account
 * before the TTL (default 1h) expires.
 *
 * Cache key shape mirrors `services/ai-worker/src/services/CreditExhaustionCache.ts`:
 * `nocredits:openrouter:user:<discordId>` for BYOK users, or
 * `nocredits:openrouter:system` for the guest-mode/system-key bucket.
 */

import { Redis } from 'ioredis';
import chalk from 'chalk';
import { CACHE_KEY_PREFIXES } from '@tzurot/common-types/constants/redis-keys';
import { getRailwayRedisUrl } from '../inspect/bullmqConnection.js';
import type { Environment } from '../utils/env-runner.js';

const KEY_PREFIX = CACHE_KEY_PREFIXES.CREDIT_EXHAUSTION_OPENROUTER;

export interface ClearOptions {
  env: Environment;
  userId?: string;
  system?: boolean;
}

/**
 * Result of resolving the cache key from CLI flags. `kind: 'error'` carries a
 * human-readable reason; `kind: 'ok'` carries the Redis key to delete.
 */
export type KeyResolution =
  { kind: 'ok'; key: string } | { kind: 'error'; reason: 'mutually-exclusive' | 'missing-flag' };

/**
 * Pure key-resolution helper. Exposed for unit testing without a Redis client.
 *
 * - Both `--user-id` and `--system` set → `mutually-exclusive` error.
 * - Neither set → `missing-flag` error.
 * - Exactly one set → `ok` with the corresponding Redis key.
 */
export function resolveCreditExhaustionKey(options: {
  userId?: string;
  system?: boolean;
}): KeyResolution {
  const userIdProvided = options.userId !== undefined && options.userId.length > 0;
  if (userIdProvided && options.system === true) {
    return { kind: 'error', reason: 'mutually-exclusive' };
  }
  if (!userIdProvided && options.system !== true) {
    return { kind: 'error', reason: 'missing-flag' };
  }
  if (userIdProvided) {
    return { kind: 'ok', key: `${KEY_PREFIX}user:${options.userId}` };
  }
  return { kind: 'ok', key: `${KEY_PREFIX}system` };
}

/**
 * Minimal interface for the Redis-like client used by `executeClear`. Allows
 * tests to inject a mock without depending on the full ioredis surface.
 */
export interface RedisClientLike {
  del(key: string): Promise<number>;
  disconnect(): void;
}

/**
 * Execute the DEL against the supplied Redis-like client. Pure-ish helper:
 * returns the result instead of writing to console / process.exitCode, so
 * tests can assert behaviour without spying on globals.
 */
export async function executeClear(
  redis: RedisClientLike,
  key: string
): Promise<{ deleted: number; error?: string }> {
  try {
    const deleted = await redis.del(key);
    return { deleted };
  } catch (err) {
    return { deleted: 0, error: err instanceof Error ? err.message : String(err) };
  } finally {
    redis.disconnect();
  }
}

/**
 * CLI entry point. Resolves Redis URL via Railway CLI (or local env), runs
 * the DEL, and reports outcome to stdout/stderr.
 */
export async function clearCreditExhaustion(options: ClearOptions): Promise<void> {
  const resolution = resolveCreditExhaustionKey(options);
  if (resolution.kind === 'error') {
    const message =
      resolution.reason === 'mutually-exclusive'
        ? '--user-id and --system are mutually exclusive; pass exactly one'
        : 'must specify one of --user-id <discordId> or --system';
    console.error(chalk.red(`Error: ${message}`));
    process.exitCode = 2;
    return;
  }

  const redisUrl = await getRailwayRedisUrl(options.env);
  if (redisUrl === null) {
    console.error(chalk.red(`Failed to resolve Redis URL for environment "${options.env}"`));
    process.exitCode = 1;
    return;
  }

  // Pass the URL string directly to ioredis. The BullMQ config wrapper used
  // by `inspect/bullmqConnection.ts` shapes the connection for BullMQ's Queue
  // class specifically; for raw `DEL` calls we don't need that layer.
  // family=6 is required for Railway's IPv6-only Redis service in dev/prod.
  const redis = new Redis(redisUrl, {
    family: options.env === 'local' ? 4 : 6,
  });

  const result = await executeClear(redis, resolution.key);
  if (result.error !== undefined) {
    console.error(chalk.red(`Redis DEL failed: ${result.error}`));
    process.exitCode = 1;
    return;
  }

  if (result.deleted === 0) {
    console.log(
      chalk.yellow(`No cache entry found at key: ${resolution.key} (already cleared or never set)`)
    );
  } else {
    console.log(chalk.green(`✓ Cleared credit-exhaustion cache entry: ${resolution.key}`));
  }
}
