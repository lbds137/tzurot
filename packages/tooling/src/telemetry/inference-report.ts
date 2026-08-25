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
  type FreeTierStats,
  type PersonalityStats,
} from './inference-report-render.js';

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
 * Query all three report sections over `usage_logs` for the given trailing
 * window. SELECT-only; never mutates.
 */
async function queryReportData(
  prisma: PrismaQueryable,
  env: Environment,
  days: number
): Promise<InferenceReportData> {
  // Q1 and Q2 carry no LIMIT deliberately: their row counts are bounded by
  // the cardinality of distinct (provider, model) pairs — a small set fixed
  // by admin configuration, not by user-generated data — and truncating them
  // would silently drop real spend from the report. Q3 is the user-data-
  // cardinality query and is the one that takes a LIMIT.
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
