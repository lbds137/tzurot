/**
 * OpenRouterModelCache
 *
 * Caches the list of available models from OpenRouter API.
 * Fetches from https://openrouter.ai/api/v1/models and caches in Redis with 24h TTL.
 *
 * Features:
 * - Flexible modality filtering (text, image, audio, video)
 * - Supports filtering by input and/or output modalities
 * - Transforms raw API data into simplified autocomplete format
 */

import type { Redis } from 'ioredis';
import { REDIS_KEY_PREFIXES } from '@tzurot/common-types/constants/queue';
import { INTERVALS } from '@tzurot/common-types/constants/timing';
import {
  type OpenRouterModel,
  type OpenRouterModelsResponse,
  type ModelAutocompleteOption,
  type ModelModality,
} from '@tzurot/common-types/types/ai';
import { createLogger } from '@tzurot/common-types/utils/logger';

const logger = createLogger('OpenRouterModelCache');

const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';

/**
 * A 200 carrying no models. Distinct from a fetch failure so the generic
 * catch can skip re-logging it — the accurate cause is already on the record
 * at the throw site, and "Failed to fetch" would send triage the wrong way.
 */
class EmptyCatalogError extends Error {
  constructor() {
    super('OpenRouter API returned an empty model catalog');
    this.name = 'EmptyCatalogError';
  }
}

/**
 * Tagged result of a single-model lookup, distinguishing a genuine catalog
 * miss from an unreachable catalog — `getModelById` collapses both to
 * `null`, which is correct for its own callers (display-only, fail-closed by
 * omission) but wrong for a caller that needs to tell a user why their save
 * was rejected. See `lookupModelById`.
 */
export type ModelLookup =
  | { kind: 'resolved'; model: ModelAutocompleteOption }
  | { kind: 'unavailable' }
  | { kind: 'absent' };

/**
 * Filter options for querying models
 */
interface ModelFilterOptions {
  /** Filter to models that accept this input modality */
  inputModality?: ModelModality;
  /** Filter to models that produce this output modality */
  outputModality?: ModelModality;
  /** Search query to filter by model name or ID */
  search?: string;
  /** Maximum number of results to return */
  limit?: number;
}

export class OpenRouterModelCache {
  /** In-memory cache for faster repeated access within the same request cycle */
  private memoryCache: OpenRouterModel[] | null = null;
  private memoryCacheTimestamp = 0;
  /** Memory cache TTL - 5 minutes (much shorter than Redis to catch updates) */
  private readonly memoryCacheTTL = 5 * 60 * 1000;
  /** Shared promise for an in-flight cold fetch — coalesces concurrent callers. */
  private inFlight: Promise<OpenRouterModel[]> | null = null;

  constructor(private redis: Redis) {}

  /**
   * Get all cached models, fetching from OpenRouter if cache is expired
   */
  async getModels(): Promise<OpenRouterModel[]> {
    // Check memory cache first (avoids Redis round-trip for rapid requests)
    if (this.memoryCache && Date.now() - this.memoryCacheTimestamp < this.memoryCacheTTL) {
      logger.debug('Memory cache HIT');
      return this.memoryCache;
    }

    // Coalesce concurrent cold callers onto a single Redis-read + fetch. A cold
    // cache request fans out ~N parallel supportsVision() lookups (one per row in
    // a config-list enrich), which would otherwise each fire their own OpenRouter
    // fetch; the shared in-flight promise collapses them to one.
    const inFlight = (this.inFlight ??= this.loadModels());
    try {
      return await inFlight;
    } finally {
      // Clear on settle (incl. failure → next cold call retries), but ONLY if the
      // field still points at OUR promise. The finally runs once per waiter, so a
      // sibling waiter must not null a newer in-flight that a later caller started
      // after this one was queued — that would break dedup and fire a redundant
      // fetch.
      if (this.inFlight === inFlight) {
        this.inFlight = null;
      }
    }
  }

  /**
   * Cold-path resolution: Redis cache, else fetch from OpenRouter, then populate
   * both cache tiers. Wrapped by getModels()'s in-flight guard so concurrent
   * cold callers share one execution.
   */
  private async loadModels(): Promise<OpenRouterModel[]> {
    // Check Redis cache
    try {
      const cached = await this.redis.get(REDIS_KEY_PREFIXES.OPENROUTER_MODELS);
      if (cached !== null && cached.length > 0) {
        const models = JSON.parse(cached) as OpenRouterModel[];
        logger.debug({ modelCount: models.length }, 'Redis cache HIT');
        // Update memory cache
        this.memoryCache = models;
        this.memoryCacheTimestamp = Date.now();
        return models;
      }
    } catch (error) {
      logger.warn({ err: error }, 'Failed to read Redis cache');
    }

    // Cache miss - fetch from OpenRouter
    logger.info('Cache MISS, fetching from OpenRouter API');
    const models = await this.fetchFromOpenRouter();

    // Store in Redis with TTL
    try {
      await this.redis.setex(
        REDIS_KEY_PREFIXES.OPENROUTER_MODELS,
        INTERVALS.OPENROUTER_MODELS_TTL,
        JSON.stringify(models)
      );
      logger.info({ modelCount: models.length, ttlHours: 24 }, 'Cached models in Redis');
    } catch (error) {
      logger.warn({ err: error }, 'Failed to write Redis cache');
    }

    // Update memory cache
    this.memoryCache = models;
    this.memoryCacheTimestamp = Date.now();

    return models;
  }

  /**
   * Get models filtered by modality and search query
   */
  async getFilteredModels(options: ModelFilterOptions = {}): Promise<ModelAutocompleteOption[]> {
    const allModels = await this.getModels();

    let filtered = allModels;

    // Filter by input modality (e.g., "image" for vision models)
    const inputModality = options.inputModality;
    if (inputModality !== undefined) {
      filtered = filtered.filter(m => m.architecture.input_modalities.includes(inputModality));
    }

    // Filter by output modality (e.g., "text" for text generation, "image" for image generation)
    const outputModality = options.outputModality;
    if (outputModality !== undefined) {
      filtered = filtered.filter(m => m.architecture.output_modalities.includes(outputModality));
    }

    // Filter by search query (matches name or ID)
    const searchQuery = options.search;
    if (searchQuery !== undefined && searchQuery.length > 0) {
      const searchLower = searchQuery.toLowerCase();
      filtered = filtered.filter(
        m => m.id.toLowerCase().includes(searchLower) || m.name.toLowerCase().includes(searchLower)
      );
    }

    // Transform to autocomplete format
    const autocompleteOptions = filtered.map(m => this.toAutocompleteOption(m));

    // Sort by name for consistent ordering
    autocompleteOptions.sort((a, b) => a.name.localeCompare(b.name));

    // Apply limit
    const limit = options.limit;
    if (limit !== undefined && limit > 0) {
      return autocompleteOptions.slice(0, limit);
    }

    return autocompleteOptions;
  }

  /**
   * Get text generation models (output modality includes "text")
   */
  async getTextModels(search?: string, limit?: number): Promise<ModelAutocompleteOption[]> {
    return this.getFilteredModels({ outputModality: 'text', search, limit });
  }

  /**
   * Get vision models (input modality includes "image")
   */
  async getVisionModels(search?: string, limit?: number): Promise<ModelAutocompleteOption[]> {
    return this.getFilteredModels({ inputModality: 'image', search, limit });
  }

  /**
   * Get image generation models (output modality includes "image")
   */
  async getImageGenerationModels(
    search?: string,
    limit?: number
  ): Promise<ModelAutocompleteOption[]> {
    return this.getFilteredModels({ outputModality: 'image', search, limit });
  }

  /**
   * Look up a single model by ID, tagging the result so a caller can tell a
   * genuine catalog miss (`absent`) apart from an unreachable catalog
   * (`unavailable`) — the two collapse to the same `null` in `getModelById`,
   * which is fine for display-only callers but wrong for anything that must
   * report the difference to a user (e.g. the save-validation error message).
   */
  async lookupModelById(modelId: string): Promise<ModelLookup> {
    try {
      const allModels = await this.getModels();
      const model = allModels.find(m => m.id === modelId);
      if (model === undefined) {
        return { kind: 'absent' };
      }
      return { kind: 'resolved', model: this.toAutocompleteOption(model) };
    } catch (error) {
      // The error is logged here rather than carried on the result: no caller
      // needs to re-handle it, and an unread `cause` field is dead surface.
      logger.warn({ err: error, modelId }, 'Cache unavailable for lookup');
      return { kind: 'unavailable' };
    }
  }

  /**
   * Look up a single model by ID.
   * Returns the autocomplete option if found, null if not found.
   * Returns null (no error) if the cache is unavailable.
   *
   * Built on `lookupModelById` so the two cannot drift — this collapses
   * `absent` and `unavailable` to the same `null`, which is correct for this
   * method's existing callers (display-only enrichment, badge computation)
   * but loses the distinction; use `lookupModelById` directly when the
   * caller needs to report WHY a model didn't resolve.
   */
  async getModelById(modelId: string): Promise<ModelAutocompleteOption | null> {
    const result = await this.lookupModelById(modelId);
    return result.kind === 'resolved' ? result.model : null;
  }

  /**
   * Whether OpenRouter's catalog entry for `modelId` lists `reasoning` among its
   * `supported_parameters`.
   *
   * Reads the RAW cached entry rather than going through `getModelById`:
   * `toAutocompleteOption` projects the catalog down to the display fields and
   * drops `supported_parameters`, so the autocomplete shape cannot answer this.
   *
   * Three-state on purpose. `undefined` means "no authoritative answer" and
   * covers BOTH a model absent from the catalog and an unreachable catalog — the
   * save-time thinking warnings must fire only on a present entry that genuinely
   * lacks reasoning support, never on a lookup that simply failed. Covered by
   * the reasoning-support cases in `OpenRouterModelCache.test.ts`.
   */
  async supportsReasoning(modelId: string): Promise<boolean | undefined> {
    try {
      const allModels = await this.getModels();
      return allModels.find(m => m.id === modelId)?.supported_parameters.includes('reasoning');
    } catch (error) {
      logger.warn({ err: error, modelId }, 'Cache unavailable for reasoning-support lookup');
      return undefined;
    }
  }

  /**
   * Fetch the catalog from OpenRouter and overwrite both cache tiers,
   * bypassing every read path — the only way to reset the Redis TTL, since a
   * plain `getModels()` that HITs Redis returns without rewriting the key and
   * lets it expire on schedule.
   *
   * Overwrites rather than deleting first: a `del` followed by a failing fetch
   * would leave no catalog at all, turning a transient OpenRouter outage into
   * a hard one. On failure the previous entry keeps serving until its own TTL.
   * Pinned by "leaves the existing cache intact when the fetch fails" in
   * `OpenRouterModelCache.test.ts`.
   *
   * @returns The number of models written
   */
  async refreshFromSource(): Promise<number> {
    // Deliberately NOT routed through getModels()'s `inFlight` dedup. That
    // promise resolves from `loadModels`, which returns early on a Redis HIT
    // without fetching — joining it would let a concurrent reader satisfy the
    // refresh with the very entry the refresh exists to replace, leaving the
    // TTL untouched. The cost is a narrow double-fetch window when a tick and
    // a genuine cold miss coincide; both write the same shape, last one wins.
    const models = await this.fetchFromOpenRouter();

    await this.redis.setex(
      REDIS_KEY_PREFIXES.OPENROUTER_MODELS,
      INTERVALS.OPENROUTER_MODELS_TTL,
      JSON.stringify(models)
    );

    this.memoryCache = models;
    this.memoryCacheTimestamp = Date.now();

    logger.info({ modelCount: models.length }, 'Refreshed model catalog from source');
    return models.length;
  }

  /**
   * Fetch models from OpenRouter API
   */
  private async fetchFromOpenRouter(): Promise<OpenRouterModel[]> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout

    try {
      const response = await fetch(OPENROUTER_MODELS_URL, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`OpenRouter API returned ${response.status}: ${response.statusText}`);
      }

      const data = (await response.json()) as OpenRouterModelsResponse;

      if (data.data === undefined || data.data === null || !Array.isArray(data.data)) {
        throw new Error('Invalid response format from OpenRouter API');
      }

      // An empty catalog is a failure wearing a 200 — a truncated body, a bad
      // gateway response, a rate-limit served as success. Treating it as valid
      // would let the scheduled refresh overwrite a good catalog with nothing,
      // which is the absent-catalog state the refresher exists to prevent.
      // Throwing here routes it through the same path as a network error, so
      // the previous entry serves out its TTL.
      //
      // Deliberately SHARED with the read path, not refresh-only: this method
      // also backs loadModels(), so a cold miss (fresh deploy, flushed Redis)
      // that coincides with an empty 200 now fails the request instead of
      // returning an empty list. That is the same class as an OpenRouter 500
      // through this path today — asyncHandler turns it into a request error —
      // and failing loudly beats serving "no models exist" as though it were
      // an answer. Both paths are pinned: "refuses an empty catalog served as
      // a 200" (refresh) and "rejects a cold getModels() on an empty 200
      // instead of caching nothing" (read).
      if (data.data.length === 0) {
        // Tagged so the generic catch below can skip its own line: the request
        // SUCCEEDED and only the payload was empty, so 'Failed to fetch from
        // OpenRouter' would misdirect triage toward a network fault — and
        // emitting both lines would just double the noise on a path the
        // refresher reaches three times a day.
        logger.error(
          { bodyBytes: JSON.stringify(data).length },
          'OpenRouter returned a successful response with an empty model catalog'
        );
        throw new EmptyCatalogError();
      }

      logger.info({ modelCount: data.data.length }, 'Fetched models from OpenRouter');
      return data.data;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error && error.name === 'AbortError') {
        logger.error({ err: error }, 'Request to OpenRouter timed out');
        throw new Error('OpenRouter API request timed out', { cause: error });
      }

      // Already logged at its throw site with the accurate cause.
      if (!(error instanceof EmptyCatalogError)) {
        logger.error({ err: error }, 'Failed to fetch from OpenRouter');
      }
      throw error;
    }
  }

  /**
   * Transform raw OpenRouter model to simplified autocomplete format
   */
  private toAutocompleteOption(model: OpenRouterModel): ModelAutocompleteOption {
    // Convert string prices to numbers (per million tokens)
    const promptPrice = parseFloat(model.pricing.prompt) * 1_000_000;
    const completionPrice = parseFloat(model.pricing.completion) * 1_000_000;

    return {
      id: model.id,
      name: model.name,
      contextLength: model.context_length,
      supportsVision: model.architecture.input_modalities.includes('image'),
      supportsImageGeneration: model.architecture.output_modalities.includes('image'),
      supportsAudioInput: model.architecture.input_modalities.includes('audio'),
      supportsAudioOutput: model.architecture.output_modalities.includes('audio'),
      promptPricePerMillion: isNaN(promptPrice) ? 0 : promptPrice,
      completionPricePerMillion: isNaN(completionPrice) ? 0 : completionPrice,
      created: model.created,
      // Meta-routers (openrouter/auto, fusion, …) report a null top-provider
      // context length — their effective context depends on what they route to.
      isRouter: model.top_provider.context_length === null,
    };
  }
}
