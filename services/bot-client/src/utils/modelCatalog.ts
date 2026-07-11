/**
 * Model Catalog
 *
 * Builds the unified model list behind the `/models` command by merging two
 * sources:
 *  1. The OpenRouter model list (via the gateway `/models` endpoints).
 *  2. The static z.ai coding-plan catalog (`listZaiCodingPlanModels`) — which
 *     includes z.ai-only models like `glm-5.2` that never appear in OpenRouter.
 *
 * It also annotates each model with whether the requesting user can actually
 * use it, computed client-side from their configured API-key providers (no
 * server round-trip beyond the wallet list the caller already fetched).
 */

import {
  AIProvider,
  ZAI_MODEL_PREFIX,
  isFreeModel,
  isZaiFreeTierModel,
  isZaiCodingPlanModel,
  listZaiCodingPlanModels,
} from '@tzurot/common-types/constants/ai';
import { type ModelAutocompleteOption } from '@tzurot/common-types/types/ai';
import { fetchModels } from './modelAutocomplete.js';

/** Where a catalog entry's data came from. */
export type ModelSource = 'openrouter' | 'zai-catalog' | 'both';

/** A model plus the metadata the `/models` card/list needs. */
export interface CatalogModel extends ModelAutocompleteOption {
  /** True if the model is on the z.ai coding plan (by prefix or catalog membership). */
  isZaiCoding: boolean;
  /** z.ai docs URL when known (z.ai models only); null otherwise. */
  docsUrl: string | null;
  /** Origin of the data — drives pricing display (zai-catalog has no $ figures). */
  source: ModelSource;
  /** Whether per-token pricing is known (false for z.ai-only catalog entries). */
  hasPricing: boolean;
}

/** Why a user can or can't use a model. */
export type ModelUsability =
  | 'free'
  | 'usable'
  | 'needs-openrouter-key'
  | 'needs-zai-key'
  | 'needs-either-key'
  // Couldn't determine the user's keys (wallet fetch failed/rate-limited) — we
  // genuinely don't know, so we show this rather than a misleading "needs key".
  | 'unknown';

export interface UsableCatalogModel extends CatalogModel {
  usability: ModelUsability;
  canUse: boolean;
}

/** Capability filter for browse/fetch — mirrors the `/models browse` choices. */
export type CapabilityFilter = 'all' | 'text' | 'vision' | 'image-gen';

export interface FetchCatalogOptions {
  capability?: CapabilityFilter;
  search?: string;
  /** OpenRouter fetch cap (gateway max is 1000). */
  limit?: number;
  /**
   * Propagated to the OpenRouter `fetchModels` call: when true, a transient/infra
   * failure THROWS (so a single-model lookup surfaces "try again") instead of
   * silently returning a partial catalog (z.ai-only) that reads as "model not
   * found". The z.ai static entries are still merged in; only the OpenRouter
   * fetch can fail. Used by {@link fetchCatalogModelById}; omit for autocomplete.
   */
  strict?: boolean;
}

/**
 * Conventional acronyms that should render fully upper-case in a z.ai display
 * name (vs. the default title-case). Only matters for z.ai-catalog-ONLY models;
 * on-OpenRouter models use OpenRouter's own `name`.
 */
const ZAI_NAME_ACRONYMS = new Set(['GLM', 'VL', 'VLM', 'R1', 'V1', 'MOE']);

/** Render a z.ai catalog key as a display name: `glm-5-turbo` → `GLM-5-Turbo`. */
export function zaiDisplayName(model: string): string {
  return model
    .split('-')
    .map(seg => {
      const upper = seg.toUpperCase();
      return ZAI_NAME_ACRONYMS.has(upper) ? upper : seg.charAt(0).toUpperCase() + seg.slice(1);
    })
    .join('-');
}

/**
 * Convert a catalog ISO release date to OpenRouter's `created` format (Unix
 * seconds). Returns undefined for a missing OR malformed date — a bad string
 * must NOT become `NaN`, which would corrupt the recency sort comparator.
 */
export function zaiReleasedToUnix(released: string | undefined): number | undefined {
  if (released === undefined) {
    return undefined;
  }
  const ms = Date.parse(released);
  return Number.isNaN(ms) ? undefined : Math.floor(ms / 1000);
}

/** Build a CatalogModel from an OpenRouter option. */
function fromOpenRouter(m: ModelAutocompleteOption): CatalogModel {
  // Meta/auto-routers (e.g. openrouter/auto) carry negative pricing because
  // their cost depends on what they route to — no concrete per-token figure.
  const hasPricing = m.promptPricePerMillion >= 0 && m.completionPricePerMillion >= 0;
  return {
    ...m,
    isZaiCoding: isZaiCodingPlanModel(m.id),
    docsUrl: null,
    source: 'openrouter',
    hasPricing,
  };
}

/**
 * Whether a z.ai catalog entry passes the active capability/search filter.
 * z.ai coding-plan models are text-only, so they're excluded from the
 * vision/image-gen capability views.
 */
function zaiPassesFilter(
  slug: string,
  displayName: string,
  capability: CapabilityFilter,
  searchLower: string
): boolean {
  if (capability === 'vision' || capability === 'image-gen') {
    return false;
  }
  if (searchLower.length === 0) {
    return true;
  }
  return (
    slug.toLowerCase().includes(searchLower) || displayName.toLowerCase().includes(searchLower)
  );
}

/**
 * Fetch the merged model catalog (OpenRouter + z.ai), deduped by slug.
 *
 * A z.ai model that ALSO appears in OpenRouter (e.g. a `z-ai/glm-*` mirror)
 * merges to `source: 'both'` — OpenRouter pricing/capabilities are kept and the
 * z.ai docs URL is attached. z.ai-only models become synthetic `zai-catalog`
 * entries with no per-token pricing.
 */
export async function fetchModelCatalog(
  options: FetchCatalogOptions = {}
): Promise<CatalogModel[]> {
  const capability = options.capability ?? 'all';
  const search = options.search;
  const openRouterModels = await fetchModels({
    textOnly: capability === 'text',
    visionOnly: capability === 'vision',
    imageGenOnly: capability === 'image-gen',
    search,
    limit: options.limit ?? 100,
    strict: options.strict,
  });

  const byKey = new Map<string, CatalogModel>();
  for (const m of openRouterModels) {
    byKey.set(m.id.toLowerCase(), fromOpenRouter(m));
  }

  const searchLower = (search ?? '').toLowerCase();
  for (const z of listZaiCodingPlanModels()) {
    const slug = `${ZAI_MODEL_PREFIX}${z.model}`;
    const key = slug.toLowerCase();
    const existing = byKey.get(key);
    if (existing !== undefined) {
      // Present in both sources — keep OpenRouter pricing/caps, add z.ai docs.
      byKey.set(key, { ...existing, isZaiCoding: true, docsUrl: z.docsUrl, source: 'both' });
      continue;
    }
    if (!zaiPassesFilter(slug, zaiDisplayName(z.model), capability, searchLower)) {
      continue;
    }
    byKey.set(key, {
      id: slug,
      name: zaiDisplayName(z.model),
      contextLength: z.contextLength,
      supportsVision: false,
      supportsImageGeneration: false,
      supportsAudioInput: false,
      supportsAudioOutput: false,
      promptPricePerMillion: 0,
      completionPricePerMillion: 0,
      // ISO release date → `created` (Unix seconds) so the recency sort ranks
      // z.ai-only models correctly. Undefined when unknown/malformed → sorts last.
      created: zaiReleasedToUnix(z.released),
      isRouter: false,
      isZaiCoding: true,
      docsUrl: z.docsUrl,
      source: 'zai-catalog',
      hasPricing: false,
    });
  }

  return [...byKey.values()];
}

/**
 * Look up a single model by its exact slug, across both sources. Returns null
 * ONLY when no model genuinely matches; THROWS `InfraError` / `GatewayClientError`
 * on a gateway failure, so the caller's try/catch can show "try again" rather
 * than a false "not found" (the OpenRouter half could be absent only because the
 * fetch failed). Used by `/models view` and the browse-select card.
 */
export async function fetchCatalogModelById(id: string): Promise<CatalogModel | null> {
  // The gateway `search` is a substring match over name/id, and the z.ai merge
  // filters its catalog by the same term, so searching the exact slug surfaces
  // the model from whichever source(s) it lives in. A high limit ensures the
  // exact match isn't truncated out when the slug is a substring of many models
  // (e.g. "gpt"). We then pin the exact id.
  const candidates = await fetchModelCatalog({ search: id, limit: 1000, strict: true });
  const target = id.toLowerCase();
  return candidates.find(m => m.id.toLowerCase() === target) ?? null;
}

/**
 * Annotate each model with the requesting user's usability, given the set of
 * provider strings they have an ACTIVE key for. The required key follows the
 * model's actual routing, keyed off `source` (NOT the `z-ai/` id prefix):
 *
 * - **free** (`:free`) — always usable on the system key.
 * - **zai-catalog** (z.ai-only, e.g. `glm-5.2`) — only reachable via z.ai-direct,
 *   so it needs a z.ai coding-plan key.
 * - **both** (a coding-plan model that ALSO lives on OpenRouter, e.g. `z-ai/glm-5`)
 *   — a z.ai key routes direct, an OpenRouter key routes via the OR fallthrough;
 *   either unlocks it.
 * - **openrouter** (everything else, including `z-ai/*` models NOT on the coding
 *   plan, which only route via OpenRouter) — needs an OpenRouter key.
 *
 * The system OpenRouter key is assumed present (bot-client can't probe it), so a
 * free model never reports "needs key".
 *
 * `activeProviders === null` means the wallet fetch FAILED (timeout, error,
 * rate-limit) — we couldn't determine the user's keys. Non-free models are then
 * marked `'unknown'` rather than falsely reporting "needs a key"; free models
 * stay usable (they need no key regardless).
 */
export function annotateUsability(
  models: CatalogModel[],
  activeProviders: ReadonlySet<string> | null
): UsableCatalogModel[] {
  const keysUnknown = activeProviders === null;
  const hasOpenRouter = activeProviders?.has(AIProvider.OpenRouter) ?? false;
  const hasZai = activeProviders?.has(AIProvider.ZaiCoding) ?? false;

  return models.map(model => {
    if (isFreeModel(model.id)) {
      return { ...model, usability: 'free', canUse: true };
    }
    // The conditionally-free piggyback model: a KEYLESS (guest) user runs it
    // via free-tier admission (denial degrades to the free router), so it
    // presents as free to them. Key-holders fall through to the key-based
    // verdicts below — they are billed on their own key.
    if (isZaiFreeTierModel(model.id) && activeProviders !== null && activeProviders.size === 0) {
      return { ...model, usability: 'free', canUse: true };
    }
    if (keysUnknown) {
      return { ...model, usability: 'unknown', canUse: false };
    }
    if (model.source === 'zai-catalog') {
      return { ...model, usability: hasZai ? 'usable' : 'needs-zai-key', canUse: hasZai };
    }
    if (model.source === 'both') {
      // Reachable via either an OpenRouter key (OR fallthrough) or a z.ai key
      // (direct), so when neither is present, name both paths — not just one.
      const canUse = hasOpenRouter || hasZai;
      return { ...model, usability: canUse ? 'usable' : 'needs-either-key', canUse };
    }
    return {
      ...model,
      usability: hasOpenRouter ? 'usable' : 'needs-openrouter-key',
      canUse: hasOpenRouter,
    };
  });
}

/** Emoji per capability, in display order. */
export const CAPABILITY_EMOJI = {
  text: '💬',
  vision: '👁️',
  imageGen: '🎨',
  audioIn: '🔊',
  audioOut: '🗣️',
} as const;

/** Render a model's capabilities as an emoji+label string (text is implicit/always present). */
export function formatCapabilities(model: ModelAutocompleteOption): string {
  const parts = [`${CAPABILITY_EMOJI.text} text`];
  if (model.supportsVision) {
    parts.push(`${CAPABILITY_EMOJI.vision} vision`);
  }
  if (model.supportsImageGeneration) {
    parts.push(`${CAPABILITY_EMOJI.imageGen} image-gen`);
  }
  if (model.supportsAudioInput) {
    parts.push(`${CAPABILITY_EMOJI.audioIn} audio-in`);
  }
  if (model.supportsAudioOutput) {
    parts.push(`${CAPABILITY_EMOJI.audioOut} audio-out`);
  }
  return parts.join('  ');
}
