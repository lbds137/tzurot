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

/** Domain (number-typed) shape for a per-provider/model cache hit-rate row. */
export interface CacheHitStats {
  provider: string;
  model: string;
  requests: number;
  tokensIn: number;
  cacheReportedCalls: number;
  cacheReportedTokensIn: number | null;
  cacheHitCalls: number;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  /** Share of reporting calls with `cache_read_tokens > 0` (`cacheHitCalls / cacheReportedCalls`), or null when unreported / 0 reported calls. */
  hitCallShare: number | null;
  /**
   * Share of reporting-call prompt tokens served from cache (`cacheReadTokens / cacheReportedTokensIn`), or null when unreported / 0 reported tokensIn.
   * Numerator and denominator share the `cache_read_tokens IS NOT NULL AND tokens_in > 0` row set.
   */
  readShare: number | null;
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
  cacheHitRate: CacheHitStats[] | null;
  freeTier: FreeTierStats[];
  perPersonality: PersonalityStats[];
}

/** Render a nullable latency value; null renders as an em dash, never 0. */
function renderLatency(value: number | null): string {
  return value === null ? '—' : value.toFixed(0);
}

/** Render a nullable token total; null renders as an em dash, never 0. */
function renderNullableTokens(value: number | null): string {
  return value === null ? '—' : String(value);
}

/** Render a nullable 0..1 share as a percentage; null renders as an em dash, never 0%. */
function renderShare(value: number | null): string {
  return value === null ? '—' : `${(value * 100).toFixed(1)}%`;
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

const EMPTY_CACHE_CAPTION = 'No cache rows in this window.';

const ALL_NULL_CACHE_CAPTION =
  'No cache token data reported in this window (`cache_read_tokens` is NULL for all rows).';

const UNAVAILABLE_CACHE_CAPTION =
  'Cache hit rate unavailable: this database predates the cache-token columns (run the migration).';

function renderCacheHitTable(rows: CacheHitStats[]): string {
  const header =
    '| Provider | Model | Requests | Reported | Hit calls | Hit call share | Tokens in | Cache read | Cache write | Read share |\n' +
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |';
  const lines = rows.map(
    row =>
      `| ${escapeTableCell(row.provider)} | ${escapeTableCell(row.model)} | ${row.requests} | ${row.cacheReportedCalls} | ${row.cacheHitCalls} | ` +
      `${renderShare(row.hitCallShare)} | ${row.tokensIn} | ${renderNullableTokens(row.cacheReadTokens)} | ` +
      `${renderNullableTokens(row.cacheWriteTokens)} | ${renderShare(row.readShare)} |`
  );
  return [header, ...lines].join('\n');
}

function renderCacheHitSection(rows: CacheHitStats[] | null): string[] {
  const heading = '## Cache hit rate';
  if (rows === null) {
    return [heading, UNAVAILABLE_CACHE_CAPTION];
  }
  const table = renderCacheHitTable(rows);
  if (rows.length === 0) {
    return [heading, EMPTY_CACHE_CAPTION, table];
  }
  if (rows.every(row => row.cacheReadTokens === null)) {
    return [heading, ALL_NULL_CACHE_CAPTION, table];
  }
  return [heading, table];
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
  'model-independent overhead. Cache tokens share the same limit — only chat ' +
  '`llm_generation` rows populate them; other writers and pre-migration rows ' +
  'are NULL and are excluded from the hit-rate denominators. Cache write ' +
  'totals come from the same read-reporting rows (`cache_read_tokens IS NOT NULL`); ' +
  'a row reporting only writes is excluded from the section. Providers that ' +
  'omit zero cache counts on a miss are indistinguishable from unreported ' +
  'rows — compare the `Reported` column to `Requests` when reading the ' +
  'hit-call share; a large gap means omitted zeros, not a writer bug.';

/** Pure renderer: markdown from already-computed report data, no DB. */
export function renderInferenceMarkdown(data: InferenceReportData): string {
  const sections = [
    '# Inference usage report',
    `Window: trailing ${data.days} days · env: ${data.env} · generated at ${data.generatedAt.toISOString()}`,
    '## Per provider/model',
    renderPerModelTable(data.perModel),
    ...renderCacheHitSection(data.cacheHitRate),
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
