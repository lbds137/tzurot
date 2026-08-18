/**
 * inspect:redis-key
 *
 * Reads ONE key out of an environment's Redis and reports what is actually
 * there: existence, type, TTL, size, and a bounded sample.
 *
 * Why a first-class command rather than an ad-hoc script: `pnpm ops run`
 * injects only `DATABASE_URL`, so a hand-rolled Redis probe run through it
 * silently reads whatever `REDIS_URL` the local `.env` happens to hold. That
 * produces a clean, plausible, completely wrong answer — and it put a
 * fabricated "the prod catalog key is absent" claim into a merged PR body.
 * This routes through `getRailwayRedisUrl`, the same resolution the other
 * Redis-touching ops commands use, which prints the resolved host so a
 * wrong-instance read is visible rather than inferred.
 *
 * An absent key is only meaningful once a known-present key has been read
 * through the same path — the reported host is what makes that check possible.
 *
 * **Values are printed unredacted, deliberately.** The sample is whatever the
 * key holds, so pointing this at a key containing a token prints that token.
 * That is accepted rather than guarded, for two reasons: the operator already
 * holds the environment's Redis credentials (they are a prerequisite for
 * running this at all), so nothing here escalates access; and the sibling
 * inspection tooling makes the same trade — `inspect:dlq --verbose` prints
 * whole job payloads, which carry message content. A key-NAME pattern guard
 * was considered and rejected as security theater: it would miss any key whose
 * name does not advertise its contents, which is the only case that matters.
 * The real exposure is incidental capture — shell history, a recorded session,
 * CI logs — so treat the output as sensitive rather than expecting the command
 * to.
 */

import chalk from 'chalk';

import type { Environment } from '../utils/env-runner.js';
import {
  getRailwayRedisUrl,
  createInspectorRedis,
  describeRedisTarget,
} from './bullmqConnection.js';

/** How much of a string value to render. Catalog blobs run to hundreds of KB. */
const SAMPLE_CHARS = 200;

/** How many members of a collection to render. */
const SAMPLE_MEMBERS = 5;

export interface InspectRedisKeyOptions {
  env: Environment;
  key: string;
  json?: boolean;
}

/** What the probe observed. `size` is type-dependent; see `sizeUnit`. */
export interface RedisKeyReport {
  env: Environment;
  host: string;
  key: string;
  exists: boolean;
  /** ioredis reports `none` for a missing key. */
  type: string;
  /** Seconds remaining; -1 = no expiry, -2 = key absent (Redis's own encoding). */
  ttl: number;
  size?: number;
  sizeUnit?: 'bytes' | 'members';
  sample?: string[];
  /** Element count when a string value parses as a JSON array. */
  jsonArrayLength?: number;
}

/**
 * Human rendering of Redis's TTL sentinels, which are easy to misread: -2 is
 * "no such key" and -1 is "key exists, never expires" — opposite meanings that
 * differ by one character.
 */
export function formatTtl(ttl: number): string {
  if (ttl === -2) return 'absent';
  if (ttl === -1) return 'no expiry';
  return `${ttl}s (~${(ttl / 3600).toFixed(1)}h)`;
}

/** Read the type-appropriate size and sample for an existing key. */
async function readValue(
  redis: ReturnType<typeof createInspectorRedis>,
  key: string,
  type: string
): Promise<Pick<RedisKeyReport, 'size' | 'sizeUnit' | 'sample' | 'jsonArrayLength'>> {
  switch (type) {
    case 'string': {
      const value = await redis.get(key);
      if (value === null) {
        return {};
      }
      const report: Pick<RedisKeyReport, 'size' | 'sizeUnit' | 'sample' | 'jsonArrayLength'> = {
        // Byte length, NOT `value.length`: JS string length counts UTF-16 code
        // units, so any multi-byte content (non-Latin bios, emoji) would
        // understate what Redis actually stores — and this tool exists to
        // report accurately. The sample below is still sliced by CHARACTERS,
        // which is the right unit for something a human reads.
        size: Buffer.byteLength(value, 'utf8'),
        sizeUnit: 'bytes',
        sample: [value.slice(0, SAMPLE_CHARS)],
      };
      try {
        const parsed: unknown = JSON.parse(value);
        if (Array.isArray(parsed)) {
          report.jsonArrayLength = parsed.length;
        }
      } catch {
        // Not JSON — the raw sample above is the whole answer.
      }
      return report;
    }
    case 'list': {
      const size = await redis.llen(key);
      return { size, sizeUnit: 'members', sample: await redis.lrange(key, 0, SAMPLE_MEMBERS - 1) };
    }
    case 'set': {
      // `size` comes from scard/hlen, never from the scan, so it stays correct
      // even when the sample is short: SCAN's COUNT is a hint, and a single
      // cursor-0 call may legitimately return fewer elements (or none) than
      // the collection holds. An empty sample beside a non-zero size is that
      // case, not a bug. lrange/zrange are index-based and unaffected.
      const size = await redis.scard(key);
      const [, members] = await redis.sscan(key, 0, 'COUNT', SAMPLE_MEMBERS);
      return { size, sizeUnit: 'members', sample: members.slice(0, SAMPLE_MEMBERS) };
    }
    case 'zset': {
      const size = await redis.zcard(key);
      return { size, sizeUnit: 'members', sample: await redis.zrange(key, 0, SAMPLE_MEMBERS - 1) };
    }
    case 'hash': {
      const size = await redis.hlen(key);
      const [, fields] = await redis.hscan(key, 0, 'COUNT', SAMPLE_MEMBERS);
      return { size, sizeUnit: 'members', sample: fields.slice(0, SAMPLE_MEMBERS * 2) };
    }
    default:
      return {};
  }
}

/**
 * Gather the report. Split from rendering so the shape is testable without a
 * terminal, and so `--json` and the human view cannot drift apart.
 */
export async function probeRedisKey(
  redis: ReturnType<typeof createInspectorRedis>,
  options: { env: Environment; host: string; key: string }
): Promise<RedisKeyReport> {
  const { env, host, key } = options;
  const [exists, type, ttl] = await Promise.all([
    redis.exists(key),
    redis.type(key),
    redis.ttl(key),
  ]);

  const base: RedisKeyReport = { env, host, key, exists: exists === 1, type, ttl };
  if (exists !== 1) {
    return base;
  }
  return { ...base, ...(await readValue(redis, key, type)) };
}

function render(report: RedisKeyReport): void {
  console.log('');
  console.log(chalk.yellow(`🔑 ${report.key}`));
  console.log(chalk.dim('─'.repeat(50)));
  console.log(`   Environment: ${report.env}`);
  console.log(`   Host:        ${report.host}`);
  console.log(
    `   Exists:      ${report.exists ? chalk.green('yes') : chalk.red('no')}   Type: ${report.type}`
  );
  console.log(`   TTL:         ${formatTtl(report.ttl)}`);

  if (report.size !== undefined) {
    console.log(`   Size:        ${report.size} ${report.sizeUnit ?? ''}`);
  }
  if (report.jsonArrayLength !== undefined) {
    console.log(`   JSON array:  ${report.jsonArrayLength} elements`);
  }
  if (report.sample !== undefined && report.sample.length > 0) {
    console.log(chalk.dim('   Sample:'));
    for (const entry of report.sample) {
      console.log(chalk.dim(`     ${entry}`));
    }
  } else if (report.size !== undefined && report.size > 0) {
    // Without this line, a set/hash whose single scan pass returned nothing
    // renders as a non-zero size with no sample at all — which, in a tool being
    // used to ask "is the data actually there", reads as evidence that it is
    // not. Say which of the two it is.
    console.log(chalk.dim('   Sample:      (none returned by this scan pass)'));
  }
  console.log('');
}

export async function inspectRedisKey(options: InspectRedisKeyOptions): Promise<void> {
  const redisUrl = await getRailwayRedisUrl(options.env);
  if (redisUrl === null) {
    process.exitCode = 1;
    return;
  }

  const host = describeRedisTarget(redisUrl);
  const redis = createInspectorRedis(redisUrl);

  try {
    const report = await probeRedisKey(redis, { env: options.env, host, key: options.key });
    if (options.json === true) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      render(report);
    }
  } catch (error) {
    // Caught here rather than left to the CLI's top-level handler, which
    // rethrows anything that is not a UsageError with a full stack trace.
    // "Redis is unreachable" is a routine outcome for a diagnostic tool — often
    // the very thing being diagnosed — so it gets a readable line, matching
    // `inspect:queue` and `inspect:dlq`.
    console.error(chalk.red(`Failed to inspect key '${options.key}' on ${host}`));
    if (error instanceof Error) {
      console.error(chalk.dim(error.message));
    }
    process.exitCode = 1;
  } finally {
    await redis.quit();
  }
}
