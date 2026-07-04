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
   * Look up a single model by ID.
   * Returns the autocomplete option if found, null if not found.
   * Returns null (no error) if the cache is unavailable.
   */
  async getModelById(modelId: string): Promise<ModelAutocompleteOption | null> {
    try {
      const allModels = await this.getModels();
      const model = allModels.find(m => m.id === modelId);
      if (model === undefined) {
        return null;
      }
      return this.toAutocompleteOption(model);
    } catch (error) {
      logger.warn({ err: error, modelId }, 'Cache unavailable for lookup');
      return null;
    }
  }

  /**
   * Force refresh the cache (e.g., for admin purposes)
   */
  async refreshCache(): Promise<number> {
    // Clear caches
    this.memoryCache = null;
    this.memoryCacheTimestamp = 0;
    await this.redis.del(REDIS_KEY_PREFIXES.OPENROUTER_MODELS);

    // Fetch fresh data
    const models = await this.getModels();
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

      logger.info({ modelCount: data.data.length }, 'Fetched models from OpenRouter');
      return data.data;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error && error.name === 'AbortError') {
        logger.error({ err: error }, 'Request to OpenRouter timed out');
        throw new Error('OpenRouter API request timed out', { cause: error });
      }

      logger.error({ err: error }, 'Failed to fetch from OpenRouter');
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
