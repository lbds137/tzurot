/**
 * OpenRouter upstream-host report
 *
 * Read-only SQL over `llm_diagnostic_logs` for a trailing window: which
 * OpenRouter upstream host served each conversation request, per model. Failed
 * requests (rows whose payload carries `error`, set by DiagnosticCollector)
 * count toward Requests and Failed; the finish-reason and average columns
 * exclude them. Empty counts blank raw replies with no failure guard, so
 * empty-after-retries failures are included. Intended scope is the conversation
 * path only; the query filters on `provider`, not request kind, so that scope
 * is an assumption about what writes the table, not something this module
 * checks. Never selects the `data` column whole and never reads reply text into
 * JS: `rawContent` is measured inside SQL with `length(...)`. Never emits a
 * user id.
 */

import { AIProvider } from '@tzurot/common-types/constants/ai';
import { DIAGNOSTIC_RETENTION_DAYS } from '@tzurot/common-types/constants/diagnostics';
import { FINISH_REASONS, NATURAL_STOP_REASONS } from '@tzurot/common-types/constants/finishReasons';
import type { Environment } from '../utils/env-runner.js';
import {
  runTelemetryReport,
  type PrismaQueryable,
  type TelemetryReportOptions,
} from './reportRunner.js';
import {
  renderUpstreamMarkdown,
  type UpstreamReportData,
  type UpstreamStats,
} from './upstream-report-render.js';

/**
 * Raw shape returned by the per-model/upstream query. Expected: `COUNT`
 * aggregates arrive as JS `bigint`, and the `AVG` over a `float8` expression
 * arrives as a JS `number`, or `null` when no non-failed row carried a positive
 * numeric `completionTokens`. The unit tests pass this shape by hand; the live
 * dev run is the runtime observation of the driver's actual types.
 */
export interface UpstreamRawRow {
  model: string;
  upstream: string;
  requests: bigint;
  failed: bigint;
  finish_stop: bigint;
  finish_length: bigint;
  finish_content_filter: bigint;
  finish_error: bigint;
  finish_other: bigint;
  empty_replies: bigint;
  avg_completion_tokens: number | null;
}

/** Exported for direct unit coverage of the bigint→number conversion boundary. */
export function toUpstreamStats(row: UpstreamRawRow): UpstreamStats {
  return {
    model: row.model,
    upstream: row.upstream,
    requests: Number(row.requests),
    failed: Number(row.failed),
    finishStop: Number(row.finish_stop),
    finishLength: Number(row.finish_length),
    finishContentFilter: Number(row.finish_content_filter),
    finishError: Number(row.finish_error),
    finishOther: Number(row.finish_other),
    emptyReplies: Number(row.empty_replies),
    avgCompletionTokens: row.avg_completion_tokens,
  };
}

/**
 * Query the serving-host rows over `llm_diagnostic_logs` for the given
 * trailing window. SELECT-only; never mutates. No LIMIT: the cardinality is
 * bounded by (model, upstream host) pairs, and truncating would hide a host.
 * Exported so the component test can run the real SQL over PGLite.
 */
export async function queryUpstreamData(
  prisma: PrismaQueryable,
  env: Environment,
  days: number
): Promise<UpstreamReportData> {
  // isNaturalStop (LLMInvoker's continuation predicate) must not change; this
  // report alone also counts stop_sequence as a natural stop. See TASK-1542.
  const stopReasons = [...NATURAL_STOP_REASONS, FINISH_REASONS.STOP_SEQUENCE];
  // MATERIALIZED stops Postgres from inlining this single-reference CTE, so the
  // response object and the failure flag are extracted once per row and the outer
  // SELECT aggregates over those two values, not over repeated `data->` reads.
  const raw = await prisma.$queryRaw<UpstreamRawRow[]>`
    WITH served AS MATERIALIZED (
      SELECT model,
             data->'llmResponse' AS r,
             (data->'error') IS NOT NULL AS failed
      FROM llm_diagnostic_logs
      WHERE created_at >= now() - (interval '1 day' * ${days})
        AND provider = ${AIProvider.OpenRouter}
    )
    SELECT model,
           COALESCE(r->'reasoningDebug'->>'upstreamProvider', '(none)') AS upstream,
           COUNT(*) AS requests,
           COUNT(*) FILTER (WHERE failed) AS failed,
           COUNT(*) FILTER (WHERE r->>'finishReason' = ANY(${stopReasons}) AND NOT failed) AS finish_stop,
           COUNT(*) FILTER (WHERE r->>'finishReason' = ${FINISH_REASONS.LENGTH} AND NOT failed) AS finish_length,
           COUNT(*) FILTER (WHERE r->>'finishReason' = ${FINISH_REASONS.CONTENT_FILTER} AND NOT failed) AS finish_content_filter,
           COUNT(*) FILTER (WHERE r->>'finishReason' = ${FINISH_REASONS.ERROR} AND NOT failed) AS finish_error,
           COUNT(*) FILTER (WHERE COALESCE(r->>'finishReason','') NOT IN (${FINISH_REASONS.LENGTH}, ${FINISH_REASONS.CONTENT_FILTER}, ${FINISH_REASONS.ERROR})
                              AND NOT (COALESCE(r->>'finishReason','') = ANY(${stopReasons}))
                              AND NOT failed) AS finish_other,
           COUNT(*) FILTER (WHERE length(btrim(COALESCE(r->>'rawContent',''))) = 0) AS empty_replies,
           AVG(CASE WHEN NOT failed
                     AND jsonb_typeof(r->'completionTokens') = 'number'
                    THEN CASE WHEN (r->>'completionTokens')::float8 > 0
                              THEN (r->>'completionTokens')::float8 END END) AS avg_completion_tokens
    FROM served
    GROUP BY 1, 2
    ORDER BY model, requests DESC
  `;

  return {
    days,
    env,
    generatedAt: new Date(),
    rows: raw.map(toUpstreamStats),
  };
}

/**
 * Print (or write to file) the OpenRouter upstream-host report over
 * `llm_diagnostic_logs` for a trailing window. Read-only: SELECTs only.
 * Defaults to the diagnostic retention window when `days` is omitted.
 */
export async function telemetryUpstreamReport(options: TelemetryReportOptions): Promise<void> {
  await runTelemetryReport(
    { defaultDays: DIAGNOSTIC_RETENTION_DAYS, ...options },
    async (prisma, env, days) => renderUpstreamMarkdown(await queryUpstreamData(prisma, env, days))
  );
}
