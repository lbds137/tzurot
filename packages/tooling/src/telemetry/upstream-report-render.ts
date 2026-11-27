/**
 * Pure markdown renderer for the OpenRouter upstream-host report — no DB
 * access. Kept in its own module so the presentation layer can be unit-tested
 * against plain data, with no Prisma client to mock.
 */

import { DIAGNOSTIC_RETENTION_DAYS } from '@tzurot/common-types/constants/diagnostics';
import type { Environment } from '../utils/env-runner.js';
import { escapeTableCell } from './markdown.js';

/** Domain (number-typed) shape for one (model, upstream host) row. */
export interface UpstreamStats {
  model: string;
  upstream: string;
  /** All requests in the group, failed ones included; the share column is computed over this. */
  requests: number;
  /** Requests whose payload carried an error. Counted in `requests`, excluded from the finish and average counts. */
  failed: number;
  finishStop: number;
  finishLength: number;
  finishContentFilter: number;
  /** Non-failed rows whose finish reason is `error` (provider failure reported inside a response). */
  finishError: number;
  finishOther: number;
  /**
   * Blank raw replies, including empty-after-retries failures. Rows with no
   * reply recorded (no response captured, or a thrown failure) carry a
   * non-blank placeholder, so they never count.
   */
  emptyReplies: number;
  /**
   * Mean `completionTokens` over non-failed rows reporting > 0 output tokens
   * (missing usage is stored as 0, so zero is excluded); null when none did.
   */
  avgCompletionTokens: number | null;
}

export interface UpstreamReportData {
  days: number;
  env: Environment;
  generatedAt: Date;
  rows: UpstreamStats[];
}

/** Render a nullable average; null renders as an em dash, never 0. */
function renderAverage(value: number | null): string {
  return value === null ? '—' : value.toFixed(0);
}

/** Render a 0..1 share as a percentage with one decimal place. */
function renderShare(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

/** Total requests per model, so each row's share is over that model's whole window. */
function modelTotals(rows: UpstreamStats[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const row of rows) {
    totals.set(row.model, (totals.get(row.model) ?? 0) + row.requests);
  }
  return totals;
}

function renderUpstreamTable(rows: UpstreamStats[]): string {
  const totals = modelTotals(rows);
  const header =
    '| Model | Upstream host | Requests | Failed | Share of model | stop | length | content_filter | error | other | Empty (incl. failed) | Avg out tokens |\n' +
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |';
  const lines = rows.map(row => {
    const modelTotal = totals.get(row.model) ?? 0;
    const share = modelTotal > 0 ? renderShare(row.requests / modelTotal) : '—';
    return (
      `| ${escapeTableCell(row.model)} | ${escapeTableCell(row.upstream)} | ${row.requests} | ${row.failed} | ${share} | ` +
      `${row.finishStop} | ${row.finishLength} | ${row.finishContentFilter} | ${row.finishError} | ${row.finishOther} | ` +
      `${row.emptyReplies} | ${renderAverage(row.avgCompletionTokens)} |`
    );
  });
  return [header, ...lines].join('\n');
}

const EMPTY_CAPTION = 'No OpenRouter diagnostic rows in this window.';

const SCOPE_NOTE = [
  '- Intended scope: conversation path only (not checked here: the query filters on provider, not request kind).',
  `- \`llm_diagnostic_logs\` rows are normally pruned after ${DIAGNOSTIC_RETENTION_DAYS} days by hourly cleanup, so slightly older rows can remain until the next run.`,
  '- Failed requests count toward Requests and Failed; the finish and average columns exclude them.',
  "- Non-failed rows with no recorded response (defaulted to `finishReason: 'unknown'`) or a missing/`'unknown'` finish reason land in `other` beside unrecognized provider finish reasons.",
  '- Empty counts blank replies, including empty-after-retries failures.',
  "- A retried request is credited to the host of the last attempt that recorded a response; earlier attempts' hosts are not recorded.",
  "- Requests that failed with a thrown error record no upstream host and are counted under (none); a host's Failed column only counts failures that happened after a response arrived.",
  "- Failures recorded before the provider was resolved are stored as provider 'unknown' and fall outside this report.",
  "- Share of model counts (none) in its denominator, so named hosts' shares understate their share of served traffic.",
  '- The diagnostic payload type has no BYOK field; the BYOK split per model is in `telemetry:inference`.',
  '- Model is the requested model id, so a router alias groups every host it routed to.',
].join('\n');

/** The window line; a window wider than retention notes when rows are normally pruned. */
function renderWindowLine(data: UpstreamReportData): string {
  const requested =
    data.days > DIAGNOSTIC_RETENTION_DAYS
      ? ` requested (diagnostic retention ${DIAGNOSTIC_RETENTION_DAYS} days; older rows are normally pruned)`
      : '';
  return `Window: trailing ${data.days} days${requested} · env: ${data.env} · generated at ${data.generatedAt.toISOString()}`;
}

/** Pure renderer: markdown from already-computed report data, no DB. */
export function renderUpstreamMarkdown(data: UpstreamReportData): string {
  const sections = ['# OpenRouter upstream host report', renderWindowLine(data), SCOPE_NOTE];

  if (data.rows.length === 0) {
    sections.push(EMPTY_CAPTION);
    return sections.join('\n\n') + '\n';
  }

  const distinctModels = new Set(data.rows.map(row => row.model)).size;
  const distinctHosts = new Set(data.rows.map(row => row.upstream)).size;
  sections.push(
    '## Serving host per model',
    renderUpstreamTable(data.rows),
    `Distinct models: ${distinctModels} · distinct hosts: ${distinctHosts}`
  );
  return sections.join('\n\n') + '\n';
}
