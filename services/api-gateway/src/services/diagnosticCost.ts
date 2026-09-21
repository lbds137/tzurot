/**
 * Estimated USD cost for a diagnostic log's LLM call, priced off the
 * OpenRouter model catalog's LIST price at read time.
 *
 * This is an ESTIMATE, not a billed amount: the catalog price can differ
 * from the price actually charged for the historical request (OpenRouter
 * repriced the model since, the request was served by a non-default
 * upstream provider with different pricing, etc). `cachedPromptTokens` is
 * deliberately NOT modelled here: the catalog's `OpenRouterModelPricing`
 * type (`packages/common-types/src/types/ai.ts`) declares only `prompt`,
 * `completion`, `request`, `image`, `web_search` and `internal_reasoning` —
 * there is no cached-prompt-token rate in it, so the catalog supplies no
 * price to apply to them. Every prompt token, cached or not, is priced
 * here at the full `prompt` rate.
 *
 * The provider gate is the diagnostic ROW's `provider` column
 * (`AIProvider`, written from `context.auth?.provider` in the ai-worker
 * pipeline), never `payload.llmConfig.provider` — that field is only the
 * model id's vendor namespace (`modelName.split('/')[0]`, e.g. `anthropic`
 * or `z-ai`), not the dispatch provider, and cannot gate an OpenRouter-only
 * lookup.
 */

import type { OpenRouterModel } from '@tzurot/common-types/types/ai';
import { AIProvider } from '@tzurot/common-types/constants/ai';
import { type EstimatedCost } from '@tzurot/common-types/schemas/api/diagnostic';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { OpenRouterModelCache } from './OpenRouterModelCache.js';

const logger = createLogger('diagnostic-cost');

const USD_PER_MILLION = 1_000_000;

/** Pure USD math for a token count against a per-token catalog price. */
export function computeEstimatedCost(input: {
  promptTokens: number;
  completionTokens: number;
  promptPricePerToken: number;
  completionPricePerToken: number;
  model: string;
}): EstimatedCost {
  const { promptTokens, completionTokens, promptPricePerToken, completionPricePerToken, model } =
    input;
  const promptUsd = promptTokens * promptPricePerToken;
  const completionUsd = completionTokens * completionPricePerToken;
  return {
    model,
    promptUsd,
    completionUsd,
    totalUsd: promptUsd + completionUsd,
    promptPricePerMillion: promptPricePerToken * USD_PER_MILLION,
    completionPricePerMillion: completionPricePerToken * USD_PER_MILLION,
    source: 'openrouter-list',
  };
}

/**
 * Narrows an unknown diagnostic `data` payload to the shape this module can
 * price: a non-null, non-array `llmResponse` object with finite, non-negative
 * token counts and a string `modelUsed` (and, if present, a string
 * `routedModel`). A
 * legacy or minimal diagnostic row (e.g. the conformance-harness fixtures,
 * which carry only `{ meta: {...} }`) fails this guard and is not an error.
 */
function isPricablePayload(payload: unknown): payload is {
  llmResponse: {
    promptTokens: number;
    completionTokens: number;
    modelUsed: string;
    routedModel?: string;
  };
} {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return false;
  }
  const llmResponse = (payload as { llmResponse?: unknown }).llmResponse;
  if (typeof llmResponse !== 'object' || llmResponse === null || Array.isArray(llmResponse)) {
    return false;
  }
  const { promptTokens, completionTokens, modelUsed, routedModel } = llmResponse as {
    promptTokens?: unknown;
    completionTokens?: unknown;
    modelUsed?: unknown;
    routedModel?: unknown;
  };
  return (
    typeof promptTokens === 'number' &&
    Number.isFinite(promptTokens) &&
    promptTokens >= 0 &&
    typeof completionTokens === 'number' &&
    Number.isFinite(completionTokens) &&
    completionTokens >= 0 &&
    typeof modelUsed === 'string' &&
    (routedModel === undefined || typeof routedModel === 'string')
  );
}

/**
 * Resolve an estimated cost for a diagnostic log, or `null` when no
 * confident estimate can be produced (non-OpenRouter provider, no cache
 * wired, model absent from the current catalog, an unpriced entry, or a
 * `data` payload without a pricable `llmResponse`). Never throws for any
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

  const promptPricePerToken = parseFloat(entry.pricing.prompt);
  const completionPricePerToken = parseFloat(entry.pricing.completion);
  // A catalog price that is non-finite (NaN from an unparseable string,
  // ±Infinity) or negative cannot produce a meaningful estimate, so the
  // whole cost degrades to null rather than surfacing a nonsense figure.
  const pricesUsable =
    Number.isFinite(promptPricePerToken) &&
    promptPricePerToken >= 0 &&
    Number.isFinite(completionPricePerToken) &&
    completionPricePerToken >= 0;
  if (!pricesUsable) {
    return null;
  }

  return computeEstimatedCost({
    promptTokens: payload.llmResponse.promptTokens,
    completionTokens: payload.llmResponse.completionTokens,
    promptPricePerToken,
    completionPricePerToken,
    model: modelId,
  });
}
