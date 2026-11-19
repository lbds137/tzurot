/**
 * Inference usage report
 *
 * Read-only SQL over `usage_logs` for a trailing window: per provider/model
 * volume and latency, a free-tier spend proxy, and per-personality
 * attribution. Never mutates, never emits a raw user id.
 */

import type { Environment } from '../utils/env-runner.js';
import {
  runTelemetryReport,
  type PrismaQueryable,
  type TelemetryReportOptions,
} from './reportRunner.js';
import {
  renderInferenceMarkdown,
  type InferenceReportData,
  type PerModelStats,
  type CacheHitStats,
  type FreeTierStats,
  type PersonalityStats,
} from './inference-report-render.js';

/** Raw shape returned by the cache hit-rate query (Q-cache). */
export interface CacheHitRawRow {
  provider: string;
  model: string;
  requests: bigint;
  tokens_in: bigint;
  cache_reported_calls: bigint;
  cache_reported_tokens_in: bigint | null;
  cache_hit_calls: bigint;
  cache_read_tokens: bigint | null;
  cache_read_tokens_for_share: bigint | null;
  cache_write_tokens: bigint | null;
}

/**
 * Raw shape returned by the per-provider/model query. `COUNT`/`SUM` aggregate
 * to Postgres `bigint`, which the driver hands back as JS `bigint`. `AVG` and
 * `percentile_cont` are cast to `::float8` in the query so they arrive as JS
 * `number` rather than a string/Decimal — see the Q1 query below.
 */
export interface PerModelRawRow {
  provider: string;
  model: string;
  requests: bigint;
  tokens_in: bigint;
  tokens_out: bigint;
  byok_true: bigint;
  byok_false: bigint;
  byok_null: bigint;
  latency_measured: bigint;
  latency_avg_ms: number | null;
  latency_p95_ms: number | null;
}

/** Raw shape returned by the free-tier spend-proxy query. */
export interface FreeTierRawRow {
  provider: string;
  model: string;
  requests: bigint;
  total_tokens: bigint;
}

/** Raw shape returned by the per-personality attribution query. */
export interface PersonalityRawRow {
  personality_name: string | null;
  requests: bigint;
  total_tokens: bigint;
}

/** Exported for direct unit coverage of the bigint→number conversion boundary. */
export function toPerModelStats(row: PerModelRawRow): PerModelStats {
  return {
    provider: row.provider,
    model: row.model,
    requests: Number(row.requests),
    tokensIn: Number(row.tokens_in),
    tokensOut: Number(row.tokens_out),
    byokTrue: Number(row.byok_true),
    byokFalse: Number(row.byok_false),
    byokNull: Number(row.byok_null),
    latencyMeasured: Number(row.latency_measured),
    latencyAvgMs: row.latency_avg_ms,
    latencyP95Ms: row.latency_p95_ms,
  };
}

/**
 * Convert a raw per-model row into cache hit-rate stats.
 *
 * `SUM(cache_read_tokens)` in Postgres returns `NULL` when every row in the
 * `(provider, model)` group has `cache_read_tokens IS NULL`, and a non-null
 * `bigint` (possibly `0n` when every reported call missed) once at least one
 * call reported a count. Shares are computed over reporting rows only and are
 * `null` when all rows are null or when the denominator
 * (`cache_reported_calls` or `cache_reported_tokens_in`) is zero — never `0`
 * for unreported data and never `NaN`.
 */
export function toCacheHitStats(row: CacheHitRawRow): CacheHitStats {
  const requests = Number(row.requests);
  const tokensIn = Number(row.tokens_in);
  const cacheReportedCalls = Number(row.cache_reported_calls);
  const cacheReportedTokensIn =
    row.cache_reported_tokens_in !== null ? Number(row.cache_reported_tokens_in) : null;
  const cacheHitCalls = Number(row.cache_hit_calls);
  const cacheReadTokens = row.cache_read_tokens !== null ? Number(row.cache_read_tokens) : null;
  const cacheReadTokensForShare =
    row.cache_read_tokens_for_share !== null ? Number(row.cache_read_tokens_for_share) : null;
  const cacheWriteTokens = row.cache_write_tokens !== null ? Number(row.cache_write_tokens) : null;

  return {
    provider: row.provider,
    model: row.model,
    requests,
    tokensIn,
    cacheReportedCalls,
    cacheReportedTokensIn,
    cacheHitCalls,
    cacheReadTokens,
    cacheWriteTokens,
    hitCallShare: cacheReportedCalls > 0 ? cacheHitCalls / cacheReportedCalls : null,
    readShare:
      cacheReadTokensForShare !== null &&
      cacheReportedTokensIn !== null &&
      cacheReportedTokensIn > 0
        ? cacheReadTokensForShare / cacheReportedTokensIn
        : null,
  };
}

function toFreeTierStats(row: FreeTierRawRow): FreeTierStats {
  return {
    provider: row.provider,
    model: row.model,
    requests: Number(row.requests),
    totalTokens: Number(row.total_tokens),
  };
}

/** Rows with no personality attribution render under this literal label. */
const UNATTRIBUTED_LABEL = '(unattributed)';

function toPersonalityStats(row: PersonalityRawRow): PersonalityStats {
  return {
    personalityName: row.personality_name ?? UNATTRIBUTED_LABEL,
    requests: Number(row.requests),
    totalTokens: Number(row.total_tokens),
  };
}

/**
 * Detect Postgres undefined-column (`42703`) errors across direct pg errors,
 * driver-adapter wrapped `cause` / Prisma `P2010` `meta` payloads, and
 * `42703`-bearing error messages so a pre-migration database without
 * `cache_read_tokens` / `cache_write_tokens` degrades the cache section to
 * `null` instead of aborting the whole report. Requires both a `42703` code
 * match and the error message naming one of the cache columns so a misspelled
 * or renamed column elsewhere in the Q-cache SQL fails loudly rather than
 * masquerading as a missing migration.
 */
function isMissingColumnError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) {
    return false;
  }
  const record = err as { code?: unknown; cause?: unknown; meta?: unknown; message?: unknown };
  const cause =
    typeof record.cause === 'object' && record.cause !== null
      ? (record.cause as { code?: unknown })
      : null;
  const meta =
    typeof record.meta === 'object' && record.meta !== null
      ? (record.meta as { code?: unknown })
      : null;
  return (
    (record.code === '42703' ||
      cause?.code === '42703' ||
      meta?.code === '42703' ||
      String(record.message).includes('42703')) &&
    /cache_(read|write)_tokens/.test(String(record.message))
  );
}

/**
 * Query all four report sections over `usage_logs` for the given trailing
 * window, isolating the cache hit-rate query so pre-migration schemas
 * degrade that section to `null`. The cache query reads chat
 * `llm_generation` rows only; `Requests` there is the chat population,
 * pre-migration chat rows included until they age out of the window.
 * SELECT-only; never mutates.
 */
async function queryReportData(
  prisma: PrismaQueryable,
  env: Environment,
  days: number
): Promise<InferenceReportData> {
  // Q1, Q-cache, and Q2 carry no LIMIT deliberately: their row counts are
  // bounded by the cardinality of distinct (provider, model) pairs — a small
  // set fixed by admin configuration, not by user-generated data — and
  // truncating them would silently drop real spend from the report. Q3 is the
  // user-data-cardinality query and is the one that takes a LIMIT.
  const perModelRaw = await prisma.$queryRaw<PerModelRawRow[]>`
    SELECT provider,
           model,
           COUNT(*)                                   AS requests,
           SUM(tokens_in)                             AS tokens_in,
           SUM(tokens_out)                             AS tokens_out,
           COUNT(*) FILTER (WHERE byok = true)        AS byok_true,
           COUNT(*) FILTER (WHERE byok = false)       AS byok_false,
           COUNT(*) FILTER (WHERE byok IS NULL)       AS byok_null,
           COUNT(latency_ms)                          AS latency_measured,
           AVG(latency_ms)::float8                    AS latency_avg_ms,
           percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms)::float8 AS latency_p95_ms
    FROM usage_logs
    WHERE created_at >= now() - (interval '1 day' * ${days})
    GROUP BY provider, model
    ORDER BY (SUM(tokens_in) + SUM(tokens_out)) DESC
  `;

  let cacheHitRate: CacheHitStats[] | null = null;
  try {
    const cacheRaw = await prisma.$queryRaw<CacheHitRawRow[]>`
      SELECT provider,
             model,
             COUNT(*)                                   AS requests,
             SUM(tokens_in)                             AS tokens_in,
             COUNT(cache_read_tokens)                   AS cache_reported_calls,
             -- exclude token-less rows so read share stays bounded
             SUM(tokens_in) FILTER (WHERE cache_read_tokens IS NOT NULL AND tokens_in > 0) AS cache_reported_tokens_in,
             COUNT(*) FILTER (WHERE cache_read_tokens > 0) AS cache_hit_calls,
             SUM(cache_read_tokens)                     AS cache_read_tokens,
             SUM(cache_read_tokens) FILTER (WHERE cache_read_tokens IS NOT NULL AND tokens_in > 0) AS cache_read_tokens_for_share,
             SUM(cache_write_tokens) FILTER (WHERE cache_read_tokens IS NOT NULL) AS cache_write_tokens
      FROM usage_logs
      WHERE created_at >= now() - (interval '1 day' * ${days}) AND request_type = 'llm_generation'
      GROUP BY provider, model
      ORDER BY (SUM(tokens_in) + SUM(tokens_out)) DESC
    `;
    cacheHitRate = cacheRaw.map(toCacheHitStats);
  } catch (err) {
    if (!isMissingColumnError(err)) {
      throw err;
    }
  }

  // Free-tier spend proxy: `byok = false` only. Rows where `byok IS NULL`
  // (system/background calls, plus any row written before the column
  // existed) are excluded entirely, so this is a lower bound on free-tier
  // spend, not an estimate of it.
  const freeTierRaw = await prisma.$queryRaw<FreeTierRawRow[]>`
    SELECT provider,
           model,
           COUNT(*)                          AS requests,
           SUM(tokens_in + tokens_out)       AS total_tokens
    FROM usage_logs
    WHERE created_at >= now() - (interval '1 day' * ${days})
      AND byok = false
    GROUP BY provider, model
    ORDER BY total_tokens DESC
  `;

  const personalityRaw = await prisma.$queryRaw<PersonalityRawRow[]>`
    SELECT COALESCE(p.display_name, p.name) AS personality_name,
           COUNT(*)                          AS requests,
           SUM(u.tokens_in + u.tokens_out)   AS total_tokens
    FROM usage_logs u
    LEFT JOIN personalities p ON p.id = u.personality_id
    WHERE u.created_at >= now() - (interval '1 day' * ${days})
    GROUP BY u.personality_id, COALESCE(p.display_name, p.name)
    ORDER BY total_tokens DESC
    LIMIT 15
  `;

  return {
    days,
    env,
    generatedAt: new Date(),
    perModel: perModelRaw.map(toPerModelStats),
    cacheHitRate,
    freeTier: freeTierRaw.map(toFreeTierStats),
    perPersonality: personalityRaw.map(toPersonalityStats),
  };
}

/**
 * Print (or write to file) an inference usage report over `usage_logs` for a
 * trailing window. Read-only: SELECTs only, never mutates.
 */
export async function telemetryInferenceReport(options: TelemetryReportOptions): Promise<void> {
  await runTelemetryReport(options, async (prisma, env, days) =>
    renderInferenceMarkdown(await queryReportData(prisma, env, days))
  );
}
