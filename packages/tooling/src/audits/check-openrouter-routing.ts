/**
 * OpenRouter Pinned-Routing Slug Liveness Guard
 *
 * For each model id in `OPENROUTER_ROUTING.PINNED_MODELS`, fetches OpenRouter's
 * per-model endpoints listing (`GET /api/v1/models/<id>/endpoints`) and diffs
 * the served host slugs against the pinned allowlist. If OpenRouter renames or
 * retires a host slug, the effective `only` set shrinks silently until it
 * risks `ROUTING_EXHAUSTED`; this check surfaces the missing slug on the
 * weekly `pnpm ops health` cadence before that happens.
 *
 * External-system claims:
 * - Unauthenticated access (`200 OK` without an `Authorization` header) and the
 *   `data.endpoints[].tag` response shape (`"<slug>/<variant>"` or bare
 *   `"<slug>"`) were verified by a live probe against
 *   `https://openrouter.ai/api/v1/models/z-ai/glm-5.3-flash/endpoints`
 *   (recorded in tracker TASK-1554 and TASK-1261).
 * - Each endpoint entry also carries an integer `status` field (`0` on the
 *   sampled entry); its semantics (e.g. whether non-zero values mean degraded
 *   or offline) are NOT verified, so this check does not filter on `status`.
 *   A slug counts as served when any endpoint entry carries it.
 * - An unknown model id on the endpoints route returns HTTP 404 with a JSON
 *   error body (`{"error":{"message":"Not Found","code":404}}`), verified by an
 *   unauthenticated live probe with a deliberately bogus id against
 *   `https://openrouter.ai/api/v1/models/z-ai/definitely-not-a-real-model-9x7/endpoints`.
 */

import { AI_ENDPOINTS } from '@tzurot/common-types/constants/ai';
import { OPENROUTER_ROUTING } from '@tzurot/common-types/constants/openrouterRouting';
import { emitSummary } from './summary.js';

export const TOOL_NAME = 'guard:openrouter-routing';

/** Per-model fetch timeout (~10s) so an unresponsive endpoint degrades promptly. */
export const OPENROUTER_ENDPOINTS_TIMEOUT_MS = 10_000;

/**
 * Build the OpenRouter endpoints URL for a pinned model id.
 *
 * Pinned model ids are repository constants (`<vendor>/<slug>`, e.g.
 * `z-ai/glm-5.3-flash`). Each `/`-separated path segment is
 * `encodeURIComponent`-encoded for defense in depth per the SSRF rule, while
 * the `/` between author and model slug stays the literal path separator on
 * OpenRouter's `/api/v1/models/:author/:slug/endpoints` route.
 */
export function buildModelEndpointsUrl(modelId: string): string {
  return `${AI_ENDPOINTS.OPENROUTER_BASE_URL}/models/${modelId.split('/').map(encodeURIComponent).join('/')}/endpoints`;
}

/**
 * Derive the bare host slug (`PINNED_MODELS` format) from one OpenRouter
 * endpoint `tag` value.
 *
 * OpenRouter endpoint tags carry either `<slug>/<variant>` (e.g.
 * `"relace/fp4"`, `"baseten/fp8"`) or a bare `<slug>` (e.g. `"together"`).
 * Returns the prefix before `'/'` when present, else the whole tag; returns
 * `null` when `tag` is not a non-empty string.
 */
export function deriveHostSlugFromTag(tag: unknown): string | null {
  if (typeof tag !== 'string') {
    return null;
  }
  const slug = tag.includes('/') ? tag.split('/')[0] : tag;
  return slug.length > 0 ? slug.toLowerCase() : null;
}

/**
 * Collect the set of distinct host slugs served across a raw `data.endpoints`
 * array. Entries that are not objects or whose `tag` is not a string are
 * skipped. Does not filter on `status` (semantics unverified).
 */
export function deriveServedSlugs(endpoints: readonly unknown[]): Set<string> {
  const slugs = new Set<string>();
  for (const entry of endpoints) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }
    const slug = deriveHostSlugFromTag((entry as { tag?: unknown }).tag);
    if (slug !== null) {
      slugs.add(slug);
    }
  }
  return slugs;
}

export type ModelSlugLiveness =
  | {
      modelId: string;
      available: true;
      pinnedCount: number;
      servedCount: number;
      missingSlugs: string[];
      unpinnedServed?: string[];
    }
  | {
      modelId: string;
      available: false;
      reason: string;
      httpStatus?: number;
    };

export interface OpenRouterRoutingCheckResult {
  models: ModelSlugLiveness[];
  /** Total count of allowlisted slugs absent from live endpoints across reachable models. */
  findings: number;
  /**
   * `fail` when any allowlisted slug is absent or when a pinned model id itself
   * is gone (HTTP 404 from OpenRouter); `warn` (non-failing degradation) when
   * no slug or model id is proven absent but at least one model's endpoints
   * fetch failed or timed out; `ok` when every pinned model resolved with zero
   * missing slugs.
   */
  status: 'ok' | 'warn' | 'fail';
}

export interface CheckOpenRouterRoutingOptions {
  /** Emit the standardized JSONL audit-summary line as the final stdout line. */
  summary?: boolean;
  /** Per-request timeout override (ms). Defaults to `OPENROUTER_ENDPOINTS_TIMEOUT_MS`. */
  timeoutMs?: number;
  /** Override the pinned-models map for unit testing. */
  pinnedModels?: Readonly<Record<string, readonly string[]>>;
  /** Override `fetch` for unit testing. */
  fetchFn?: typeof fetch;
}

/** Extract the `data.endpoints` array from a parsed endpoints response body, or throw a descriptive error. */
function extractEndpointsArray(payload: unknown): unknown[] {
  if (typeof payload !== 'object' || payload === null) {
    throw new Error('response body is not a JSON object');
  }
  const data = (payload as { data?: unknown }).data;
  if (typeof data !== 'object' || data === null) {
    throw new Error('response body is missing data object');
  }
  const endpoints = (data as { endpoints?: unknown }).endpoints;
  if (!Array.isArray(endpoints)) {
    throw new Error('response body data.endpoints is not an array');
  }
  return endpoints;
}

/** Fetch and evaluate one pinned model's live endpoints against its allowlist. Never throws. */
async function checkSinglePinnedModel(
  modelId: string,
  allowlist: readonly string[],
  fetchFn: typeof fetch,
  timeoutMs: number
): Promise<ModelSlugLiveness> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchFn(buildModelEndpointsUrl(modelId), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) {
      return {
        modelId,
        available: false,
        httpStatus: response.status,
        reason: `HTTP ${String(response.status)} ${response.statusText}`.trim(),
      };
    }
    const payload: unknown = await response.json();
    const endpoints = extractEndpointsArray(payload);
    const served = deriveServedSlugs(endpoints);
    const lowerAllowlist = allowlist.map(slug => slug.toLowerCase());
    const allowlistSet = new Set(lowerAllowlist);
    const missingSlugs = lowerAllowlist.filter(slug => !served.has(slug));
    const unpinnedServed = [...served].filter(slug => !allowlistSet.has(slug)).sort();
    return {
      modelId,
      available: true,
      pinnedCount: allowlist.length,
      servedCount: served.size,
      missingSlugs,
      ...(unpinnedServed.length > 0 ? { unpinnedServed } : {}),
    };
  } catch (error) {
    const reason =
      error instanceof Error && error.name === 'AbortError'
        ? `request timed out after ${String(timeoutMs)}ms`
        : error instanceof Error
          ? error.message
          : String(error);
    return { modelId, available: false, reason };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Evaluate every pinned model's allowlist against OpenRouter's live endpoints
 * API. Pure given an injected `fetchFn` and `pinnedModels` table.
 */
export async function evaluateOpenRouterRoutingLiveness(
  options: CheckOpenRouterRoutingOptions = {}
): Promise<OpenRouterRoutingCheckResult> {
  const pinnedModels = options.pinnedModels ?? OPENROUTER_ROUTING.PINNED_MODELS;
  const fetchFn = options.fetchFn ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? OPENROUTER_ENDPOINTS_TIMEOUT_MS;

  const models: ModelSlugLiveness[] = [];
  for (const [modelId, allowlist] of Object.entries(pinnedModels)) {
    models.push(await checkSinglePinnedModel(modelId, allowlist, fetchFn, timeoutMs));
  }

  let findings = 0;
  let anyUnavailable = false;
  let anyModelNotFound = false;
  for (const model of models) {
    if (!model.available) {
      anyUnavailable = true;
      if (model.httpStatus === 404) {
        anyModelNotFound = true;
      }
    } else {
      findings += model.missingSlugs.length;
    }
  }

  const status: OpenRouterRoutingCheckResult['status'] =
    findings > 0 || anyModelNotFound ? 'fail' : anyUnavailable ? 'warn' : 'ok';

  return { models, findings, status };
}

/** Format human-readable report lines naming dead slugs, missing model ids, or offline degradation reasons. */
export function formatOpenRouterRoutingReport(result: OpenRouterRoutingCheckResult): string {
  const lines: string[] = [];
  for (const model of result.models) {
    if (!model.available) {
      if (model.httpStatus === 404) {
        lines.push(
          `❌ ${model.modelId}: pinned model id or endpoints route not found (${model.reason}) — check the pin and its route: remove/re-measure the entry or fix the route`
        );
        continue;
      }
      lines.push(`⚠️  ${model.modelId}: endpoints check unavailable (${model.reason})`);
      continue;
    }
    if (model.missingSlugs.length > 0) {
      lines.push(
        `❌ ${model.modelId}: ${String(model.missingSlugs.length)}/${String(model.pinnedCount)} pinned host slug(s) absent from live endpoints: ${model.missingSlugs.join(', ')}`
      );
      if (model.unpinnedServed !== undefined && model.unpinnedServed.length > 0) {
        lines.push(`   note: served but unpinned: ${model.unpinnedServed.join(', ')}`);
      }
      continue;
    }
    lines.push(
      `✅ ${model.modelId}: all ${String(model.pinnedCount)} pinned host slug(s) present (${String(model.servedCount)} distinct host slug(s) served)`
    );
  }
  return lines.join('\n');
}

/**
 * CLI entry point for `pnpm ops guard:openrouter-routing`.
 *
 * Prints the per-model liveness lines (naming any dead slugs or the offline
 * degradation reason), emits the JSONL `AuditSummary` line when `--summary` is
 * set, and sets `process.exitCode = 1` only when `status === 'fail'` (missing
 * allowlisted slugs, or a 404 on a pinned model id). Network failures degrade
 * to `status: 'warn'` with `findings: 0` so an offline run never reads as
 * `TOOL BROKEN` or fails the weekly health report.
 */
export async function checkOpenRouterRouting(
  options: CheckOpenRouterRoutingOptions = {}
): Promise<OpenRouterRoutingCheckResult> {
  const result = await evaluateOpenRouterRoutingLiveness(options);

  console.log(formatOpenRouterRoutingReport(result));

  if (options.summary === true) {
    emitSummary({
      tool: TOOL_NAME,
      status: result.status,
      findings: result.findings,
      baseline: 0,
    });
  }

  if (result.status === 'fail') {
    process.exitCode = 1;
  }

  return result;
}
