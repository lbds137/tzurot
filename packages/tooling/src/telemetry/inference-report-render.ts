/**
 * Pure markdown renderer for the inference usage report — no DB access.
 * Kept in its own module so the presentation layer can be unit-tested
 * against plain data, with no Prisma client to mock.
 */

import type { Environment } from '../utils/env-runner.js';

/** Domain (number-typed) shape for a per-provider/model table row. */
export interface PerModelStats {
  provider: string;
  model: string;
  requests: number;
  tokensIn: number;
  tokensOut: number;
  byokTrue: number;
  byokFalse: number;
  byokNull: number;
  latencyMeasured: number;
  latencyAvgMs: number | null;
  latencyP95Ms: number | null;
}

/**
 * Domain shape for a free-tier spend-proxy row. Keyed by (provider, model),
 * matching the per-model table above it — the same model id can be reachable
 * through two providers, and merging them would misattribute spend.
 */
export interface FreeTierStats {
  provider: string;
  model: string;
  requests: number;
  totalTokens: number;
}

/** Domain shape for a per-personality attribution row. */
export interface PersonalityStats {
  personalityName: string;
  requests: number;
  totalTokens: number;
}

export interface InferenceReportData {
  days: number;
  env: Environment;
  generatedAt: Date;
  perModel: PerModelStats[];
  freeTier: FreeTierStats[];
  perPersonality: PersonalityStats[];
}

/** Render a nullable latency value; null renders as an em dash, never 0. */
function renderLatency(value: number | null): string {
  return value === null ? '—' : value.toFixed(0);
}

function renderPerModelTable(rows: PerModelStats[]): string {
  const header =
    '| Provider | Model | Requests | Tokens in | Tokens out | BYOK | Free | Unknown | Latency measured | Avg ms | p95 ms |\n' +
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |';
  const lines = rows.map(
    row =>
      `| ${escapeTableCell(row.provider)} | ${escapeTableCell(row.model)} | ${row.requests} | ${row.tokensIn} | ${row.tokensOut} | ` +
      `${row.byokTrue} | ${row.byokFalse} | ${row.byokNull} | ${row.latencyMeasured} | ` +
      `${renderLatency(row.latencyAvgMs)} | ${renderLatency(row.latencyP95Ms)} |`
  );
  return [header, ...lines].join('\n');
}

const FREE_TIER_CAPTION =
  'Excludes rows where `byok IS NULL` (system/background calls, and any row ' +
  'written before the byok column existed) — this figure is a lower bound on ' +
  'free-tier spend, not an estimate of it.';

function renderFreeTierTable(rows: FreeTierStats[]): string {
  const header = '| Provider | Model | Requests | Total tokens |\n| --- | --- | --- | --- |';
  const lines = rows.map(
    row =>
      `| ${escapeTableCell(row.provider)} | ${escapeTableCell(row.model)} | ${row.requests} | ${row.totalTokens} |`
  );
  return [header, ...lines].join('\n');
}

/**
 * Personality names AND model strings are user-controlled (LlmConfig.model is
 * an unrestricted string and catalog validation is skippable when the model
 * cache is unavailable), so every string cell that can originate from user
 * input is escaped: a literal `|` or newline would break its row's cell
 * structure — or fabricate rows — in any markdown-rendering surface the
 * report gets pasted into.
 */
function escapeTableCell(value: string): string {
  return value.replaceAll('|', '\\|').replaceAll(/\r?\n/g, ' ');
}

function renderPersonalityTable(rows: PersonalityStats[]): string {
  const header = '| Personality | Requests | Total tokens |\n| --- | --- | --- |';
  const lines = rows.map(
    row => `| ${escapeTableCell(row.personalityName)} | ${row.requests} | ${row.totalTokens} |`
  );
  return [header, ...lines].join('\n');
}

const LIMITATIONS_PARAGRAPH =
  'Rows where `byok IS NULL` are excluded from the free-tier spend proxy, so ' +
  'that figure is a lower bound. Latency is only recorded on the ' +
  'chat-generation path — fact-extraction and roster-blurb rows have no ' +
  'timing and are excluded from the latency columns above. Measured latency ' +
  'spans the whole generation pipeline (auth, retrieval, memory persistence), ' +
  'not just the model call, so cross-model comparisons carry some ' +
  'model-independent overhead.';

/** Pure renderer: markdown from already-computed report data, no DB. */
export function renderInferenceMarkdown(data: InferenceReportData): string {
  const sections = [
    '# Inference usage report',
    `Window: trailing ${data.days} days · env: ${data.env} · generated at ${data.generatedAt.toISOString()}`,
    '## Per provider/model',
    renderPerModelTable(data.perModel),
    '## Free-tier spend proxy',
    FREE_TIER_CAPTION,
    renderFreeTierTable(data.freeTier),
    '## Per-character attribution (top 15)',
    renderPersonalityTable(data.perPersonality),
    '## Limitations',
    LIMITATIONS_PARAGRAPH,
  ];
  return sections.join('\n\n') + '\n';
}
