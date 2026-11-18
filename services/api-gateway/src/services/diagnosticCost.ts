/**
 * Estimated USD cost for a diagnostic log's LLM call, priced off the
 * OpenRouter model catalog's LIST price at read time.
 *
 * This is an ESTIMATE, not a billed amount: the catalog price can differ
 * from the price actually charged for the historical request (OpenRouter
 * repriced the model since, the request was served by a non-default
 * upstream provider with different pricing, etc).
 *
 * Pricing model. The catalog's `OpenRouterModelPricing`
 * (`packages/common-types/src/types/ai.ts`) carries `prompt`, `completion`
 * and, on models with prompt caching, `input_cache_read`,
 * `input_cache_write` (default 5-minute TTL) and `input_cache_write_1h`.
 * When the row reports cache tokens (`cachedPromptTokens` reads,
 * `cachedWriteTokens` writes) and the catalog has every cache price those
 * tokens need, the prompt is priced in three parts:
 *   uncached = (promptTokens - reads - writes) * prompt
 *   reads    = reads * input_cache_read
 *   writes   = writes * (input_cache_write | input_cache_write_1h)
 * and the result carries a `cache` block with each part plus
 * `noCacheTotalUsd` (the same tokens, no cache, every prompt token at the
 * prompt rate) so the caller can show what the cache saved or added. In
 * every other case (no cache tokens, a needed cache price absent or
 * unusable, counts that exceed `promptTokens`) `cache` is `null` and every
 * prompt token is priced at the prompt rate. One unpriced write voids the
 * read breakdown too, on purpose: we do not guess a write rate the catalog
 * does not state. Counts are never clamped.
 *
 * Tier rule. A catalog entry may carry `overrides`: prompt-size tiers. Per
 * OpenRouter's docs (https://openrouter.ai/docs/overview/models) an override
 * "applies when total prompt tokens are strictly greater than this
 * threshold" and "Price keys absent from an entry inherit the base price".
 * `resolveTierPricing` picks, among entries whose only condition is
 * `min_prompt_tokens`, the one with the largest threshold strictly below
 * `promptTokens`, and overlays its price keys. The tier applies to the
 * prompt, completion and cache prices alike.
 *
 * TTL rule. The write price depends on the cache TTL the request used, which
 * is not recorded on the diagnostic row. We send `PROMPT_CACHE_TTL` on every
 * cache breakpoint only when the preset has prompt caching on AND the model
 * id is `anthropic/` (ai-worker's ModelFactory:
 * `modelConfig.promptCaching === true && isAnthropicFamilyModelId`). The TTL
 * keys on the REQUESTED id (`modelUsed`), the one ai-worker gated on, not the
 * routed id that served the call. This module cannot see `promptCaching`, so
 * an `anthropic/` row is priced at the 1-hour write price when the constant
 * is '1h' (an `anthropic/` row with caching off and cache writes reported,
 * i.e. provider-side caching, is still priced at that write price: an
 * accepted residual); any other model id sends no TTL, so
 * the provider default applies, taken here as the 5-minute
 * `input_cache_write` price (a reading of OpenRouter's prompt-caching docs,
 * not verified against billing). A 1h row whose catalog entry lacks
 * `input_cache_write_1h` yields `cache: null`; it does NOT fall back to the
 * 5-minute price. A historic row is priced at the CURRENT constant.
 *
 * Residuals (known, accepted):
 * - An `overrides` entry with any condition other than `min_prompt_tokens`
 *   (a `min_*` / `max_*` key, or a value that is not price-shaped) is ignored: we do not
 *   know what the condition means. Unmodelled price keys do not void it.
 * - The write TTL is not recorded per row (see the TTL rule).
 * - `promptTokens` is ASSUMED to include cache reads and writes. That is the
 *   reading under which a dev turn (13,613 prompt tokens with 9,334 read
 *   and 77 written) reproduces its observed numbers; it was not confirmed
 *   against OpenRouter's usage documentation.
 *
 * The provider gate is the diagnostic ROW's `provider` column
 * (`AIProvider`): the provider that SERVED the call, written by the
 * ai-worker pipeline as `effectiveProviderUsed ?? <auth-resolved provider>`,
 * so a request auto-promoted to z.ai and served by the OpenRouter fallback
 * gates as OpenRouter. On a failed generation nothing served, and the row
 * carries the auth-resolved provider. Never `payload.llmConfig.provider` —
 * that field is only the model id's vendor namespace
 * (`modelName.split('/')[0]`, e.g. `anthropic` or `z-ai`), not the dispatch
 * provider, and cannot gate an OpenRouter-only lookup.
 */

import type { OpenRouterModel, OpenRouterModelPricing } from '@tzurot/common-types/types/ai';
import {
  AIProvider,
  PROMPT_CACHE_TTL,
  isAnthropicFamilyModelId,
} from '@tzurot/common-types/constants/ai';
import { type EstimatedCost } from '@tzurot/common-types/schemas/api/diagnostic';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { parseFiniteNumber } from './catalogNumber.js';
import type { OpenRouterModelCache } from './OpenRouterModelCache.js';

const logger = createLogger('diagnostic-cost');

const USD_PER_MILLION = 1_000_000;

/** Cache-write TTL tier whose catalog price applies. */
export type CacheWriteTtl = NonNullable<EstimatedCost['cache']>['writeTtl'];

/** The catalog price keys a tier can set (base entry and each override). */
const PRICE_KEYS = [
  'prompt',
  'completion',
  'input_cache_read',
  'input_cache_write',
  'input_cache_write_1h',
] as const;

type PriceKey = (typeof PRICE_KEYS)[number];

/** Raw catalog price strings after tier selection; a key is absent when the entry has none. */
export type TierPricing = Partial<Record<PriceKey, unknown>>;

/** The only override condition key understood; any other condition voids the entry. */
const TIER_CONDITION_KEY = 'min_prompt_tokens';

/** Keys shaped `min_*` / `max_*` are conditions; only `min_prompt_tokens` is evaluated. */
const CONDITION_KEY_PATTERN = /^(min|max)_/;

/** A price is usable when it is a finite, non-negative number. */
function isUsablePrice(price: number | undefined): price is number {
  return price !== undefined && Number.isFinite(price) && price >= 0;
}

/** Parse a raw per-token USD price (string or number); `undefined` when absent or unusable. */
function parseUsablePrice(raw: unknown): number | undefined {
  const parsed = parseFiniteNumber(raw);
  return isUsablePrice(parsed) ? parsed : undefined;
}

/**
 * The override entry's threshold when it is a tier we understand and
 * `promptTokens` is strictly above it; `undefined` otherwise. A key is a
 * condition when it is `min_*` / `max_*` or its value is not price-shaped
 * (null, or a value `parseFiniteNumber` reads as a finite number). A `-1`
 * value is price-shaped and "eu" is not; shape only classifies a key as price
 * or condition, and `parseUsablePrice` still rejects a `-1` as a price. A
 * non-finite number (NaN, Infinity) is not price-shaped, so it is a condition
 * and voids the entry. The only understood condition is `min_prompt_tokens` (a
 * finite, non-negative number or numeric string); an unparseable or negative
 * threshold is logged at debug and ignored. Any other condition is one we
 * cannot evaluate, so the entry is ignored rather than applied unconditionally.
 * Every remaining key is a price: those in `PRICE_KEYS` overlay, the rest
 * (`image`, `audio`, `discount`, ...) are ignored without voiding the entry.
 */
function matchedTierThreshold(entry: unknown, promptTokens: number): number | undefined {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
    return undefined;
  }
  const record = entry as Record<string, unknown>;
  const rawThreshold = record[TIER_CONDITION_KEY];
  const unknownConditions = Object.keys(record).filter(key => {
    if (key === TIER_CONDITION_KEY) {
      return false;
    }
    const value = record[key];
    return (
      CONDITION_KEY_PATTERN.test(key) || !(value === null || parseFiniteNumber(value) !== undefined)
    );
  });
  if (unknownConditions.length > 0) {
    logger.debug(
      { ignoredKeys: unknownConditions, threshold: rawThreshold },
      'Ignored pricing override with an unknown condition'
    );
    return undefined;
  }
  const threshold = parseFiniteNumber(rawThreshold);
  if (threshold === undefined || threshold < 0) {
    if (rawThreshold !== undefined) {
      logger.debug(
        { threshold: rawThreshold },
        'Ignored pricing override with an unparseable threshold'
      );
    }
    return undefined;
  }
  return promptTokens > threshold ? threshold : undefined;
}

/**
 * Apply the catalog's prompt-size tier: start from the base price keys, then
 * overlay the price keys of the `overrides` entry with the LARGEST
 * `min_prompt_tokens` that `promptTokens` strictly exceeds (keys absent from
 * the entry inherit the base). Entries with a condition other than
 * `min_prompt_tokens` are ignored (see the file header).
 */
export function resolveTierPricing(
  pricing: OpenRouterModelPricing,
  promptTokens: number
): TierPricing {
  const resolved: TierPricing = {};
  for (const key of PRICE_KEYS) {
    resolved[key] = pricing[key];
  }
  const overrides: unknown = pricing.overrides;
  if (!Array.isArray(overrides)) {
    return resolved;
  }
  let best: Record<string, unknown> | undefined;
  let bestThreshold = -Infinity;
  for (const entry of overrides) {
    const threshold = matchedTierThreshold(entry, promptTokens);
    if (threshold !== undefined && threshold > bestThreshold) {
      best = entry as Record<string, unknown>;
      bestThreshold = threshold;
    }
  }
  if (best === undefined) {
    return resolved;
  }
  for (const key of PRICE_KEYS) {
    const value = best[key];
    // Only a string/number price overlays: a null (or other non-price) value
    // in a tier entry must not erase the inherited base price.
    if (typeof value === 'string' || typeof value === 'number') {
      resolved[key] = value;
    }
  }
  return resolved;
}

/**
 * The cache-write TTL the request used. `isAnthropicFamilyModelId` (shared
 * with ai-worker's `ModelFactory.ts`) gates the TTL directive: only
 * `anthropic/` ids send `PROMPT_CACHE_TTL`. Callers pass the REQUESTED id.
 */
function cacheWriteTtlFor(modelId: string): CacheWriteTtl {
  return isAnthropicFamilyModelId(modelId) ? PROMPT_CACHE_TTL : '5m';
}

type CacheBreakdown = NonNullable<EstimatedCost['cache']>;

interface CostInput {
  promptTokens: number;
  completionTokens: number;
  promptPricePerToken: number;
  completionPricePerToken: number;
  model: string;
  /** Prompt tokens served from cache (a subset of `promptTokens`). */
  cachedReadTokens?: number;
  /** Prompt tokens written to cache (a subset of `promptTokens`). */
  cachedWriteTokens?: number;
  /** Per-token cache-read price; absent or unusable disables cache-aware pricing when reads > 0. */
  cacheReadPricePerToken?: number;
  /** Per-token cache-write price for `cacheWriteTtl`; same rule when writes > 0. */
  cacheWritePricePerToken?: number;
  /** TTL tier `cacheWritePricePerToken` belongs to (default '5m'). */
  cacheWriteTtl?: CacheWriteTtl;
}

/**
 * The cache-aware breakdown, or `null` when none is possible or needed: no
 * cache tokens, counts exceeding the prompt (never clamped), or a needed
 * cache price that is absent or unusable.
 */
function priceCache(input: CostInput, completionUsd: number): CacheBreakdown | null {
  const readTokens = input.cachedReadTokens ?? 0;
  const writeTokens = input.cachedWriteTokens ?? 0;
  if (readTokens === 0 && writeTokens === 0) {
    return null;
  }
  if (readTokens + writeTokens > input.promptTokens) {
    return null;
  }
  const { cacheReadPricePerToken: readPrice, cacheWritePricePerToken: writePrice } = input;
  if (readTokens > 0 && !isUsablePrice(readPrice)) {
    return null;
  }
  if (writeTokens > 0 && !isUsablePrice(writePrice)) {
    return null;
  }
  return {
    readTokens,
    writeTokens,
    uncachedPromptUsd: (input.promptTokens - readTokens - writeTokens) * input.promptPricePerToken,
    readUsd: isUsablePrice(readPrice) ? readTokens * readPrice : 0,
    writeUsd: isUsablePrice(writePrice) ? writeTokens * writePrice : 0,
    writeTtl: input.cacheWriteTtl ?? '5m',
    noCacheTotalUsd: input.promptTokens * input.promptPricePerToken + completionUsd,
  };
}

/**
 * Pure USD math for token counts against per-token catalog prices. Without
 * cache parts (or when `priceCache` yields `null`) every prompt token is
 * priced at the prompt rate and `cache` is `null`.
 */
export function computeEstimatedCost(input: CostInput): EstimatedCost {
  const { promptTokens, completionTokens, promptPricePerToken, completionPricePerToken, model } =
    input;
  const completionUsd = completionTokens * completionPricePerToken;
  const cache = priceCache(input, completionUsd);
  const promptUsd =
    cache === null
      ? promptTokens * promptPricePerToken
      : cache.uncachedPromptUsd + cache.readUsd + cache.writeUsd;
  return {
    model,
    promptUsd,
    completionUsd,
    totalUsd: promptUsd + completionUsd,
    promptPricePerMillion: promptPricePerToken * USD_PER_MILLION,
    completionPricePerMillion: completionPricePerToken * USD_PER_MILLION,
    source: 'openrouter-list',
    cache,
  };
}

/** A token count is usable when it is a finite, non-negative number. */
function isTokenCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/**
 * Narrows an unknown diagnostic `data` payload to the shape this module can
 * price: a non-null, non-array `llmResponse` object with finite, non-negative
 * token counts and a string `modelUsed` (and, if present, a string
 * `routedModel` and finite, non-negative `cachedPromptTokens` /
 * `cachedWriteTokens`). A present-but-invalid cache count fails the guard,
 * the same as a bad `promptTokens`. A
 * legacy or minimal diagnostic row (e.g. the conformance-harness fixtures,
 * which carry only `{ meta: {...} }`) fails this guard and is not an error.
 */
function isPricablePayload(payload: unknown): payload is {
  llmResponse: {
    promptTokens: number;
    completionTokens: number;
    modelUsed: string;
    routedModel?: string;
    cachedPromptTokens?: number;
    cachedWriteTokens?: number;
  };
} {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return false;
  }
  const llmResponse = (payload as { llmResponse?: unknown }).llmResponse;
  if (typeof llmResponse !== 'object' || llmResponse === null || Array.isArray(llmResponse)) {
    return false;
  }
  const {
    promptTokens,
    completionTokens,
    modelUsed,
    routedModel,
    cachedPromptTokens,
    cachedWriteTokens,
  } = llmResponse as {
    promptTokens?: unknown;
    completionTokens?: unknown;
    modelUsed?: unknown;
    routedModel?: unknown;
    cachedPromptTokens?: unknown;
    cachedWriteTokens?: unknown;
  };
  return (
    isTokenCount(promptTokens) &&
    isTokenCount(completionTokens) &&
    typeof modelUsed === 'string' &&
    (routedModel === undefined || typeof routedModel === 'string') &&
    (cachedPromptTokens === undefined || isTokenCount(cachedPromptTokens)) &&
    (cachedWriteTokens === undefined || isTokenCount(cachedWriteTokens))
  );
}

/**
 * Resolve an estimated cost for a diagnostic log, or `null` when no
 * confident estimate can be produced (non-OpenRouter provider, no cache
 * wired, model absent from the current catalog, an unusable prompt or
 * completion price, or a `data` payload without a pricable `llmResponse`).
 * An absent or unusable CACHE price is not one of those: it only disables
 * cache-aware pricing (`cache: null`). Never throws for any
 * `data` shape — a pricing-lookup failure or a malformed/legacy payload both
 * degrade to `null` rather than failing the diagnostic route; the
 * malformed-`data` cases are pinned by the tests in `diagnosticCost.test.ts`.
 */
export async function estimateDiagnosticCost(
  cache: OpenRouterModelCache | undefined,
  rowProvider: string,
  payload: unknown,
  requestId: string
): Promise<EstimatedCost | null> {
  if (cache === undefined) {
    return null;
  }
  // rowProvider is a plain `string` (the Prisma row column), not a typed
  // `AIProvider` — cast the enum side so the comparison isn't flagged as
  // comparing unrelated types; the value semantics are unaffected since
  // AIProvider is a string enum.
  if (rowProvider !== (AIProvider.OpenRouter as string)) {
    return null;
  }

  if (!isPricablePayload(payload)) {
    return null;
  }

  const modelId = payload.llmResponse.routedModel ?? payload.llmResponse.modelUsed;
  if (modelId === '') {
    return null;
  }

  let models: OpenRouterModel[];
  try {
    models = await cache.getModels();
  } catch (error) {
    logger.warn({ err: error, requestId, model: modelId }, 'Diagnostic cost lookup failed');
    return null;
  }

  const entry = models.find(m => m.id === modelId);
  if (entry === undefined) {
    return null;
  }

  const { promptTokens, completionTokens, cachedPromptTokens, cachedWriteTokens } =
    payload.llmResponse;
  const tier = resolveTierPricing(entry.pricing, promptTokens);
  // A catalog price that is non-finite (NaN from an unparseable string,
  // ±Infinity) or negative cannot produce a meaningful estimate, so the
  // whole cost degrades to null rather than surfacing a nonsense figure.
  const promptPricePerToken = parseUsablePrice(tier.prompt);
  const completionPricePerToken = parseUsablePrice(tier.completion);
  if (promptPricePerToken === undefined || completionPricePerToken === undefined) {
    return null;
  }

  // The TTL keys on the REQUESTED id (`modelUsed`, what ai-worker gated on),
  // while the catalog lookup above keys on the id that served the call.
  const cacheWriteTtl = cacheWriteTtlFor(payload.llmResponse.modelUsed);
  return computeEstimatedCost({
    promptTokens,
    completionTokens,
    promptPricePerToken,
    completionPricePerToken,
    model: modelId,
    cachedReadTokens: cachedPromptTokens,
    cachedWriteTokens,
    cacheReadPricePerToken: parseUsablePrice(tier.input_cache_read),
    cacheWritePricePerToken: parseUsablePrice(
      cacheWriteTtl === '1h' ? tier.input_cache_write_1h : tier.input_cache_write
    ),
    cacheWriteTtl,
  });
}
