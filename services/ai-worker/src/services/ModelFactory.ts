/**
 * Model Factory - Creates appropriate LangChain chat models based on environment configuration
 *
 * Supports:
 * - OpenRouter - via AI_PROVIDER=openrouter or OPENROUTER_API_KEY
 *
 * Note: OpenAI API key is used internally for embeddings/whisper, but not for chat models.
 * All chat/generation goes through OpenRouter which can route to any provider including OpenAI models.
 */

import { ChatOpenAI } from '@langchain/openai';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import {
  createLogger,
  getConfig,
  AIProvider,
  AI_ENDPOINTS,
  type ConvertedLlmParams,
} from '@tzurot/common-types';

const logger = createLogger('ModelFactory');
const config = getConfig();

/**
 * OpenRouter-specific parameters that need to be injected into the request body.
 * The OpenAI SDK v4+ strips unknown top-level keys from the params, so we need
 * to inject these after SDK validation via a custom fetch wrapper.
 */
export interface OpenRouterExtraParams {
  include_reasoning?: boolean;
  transforms?: string[];
  route?: 'fallback';
  verbosity?: 'low' | 'medium' | 'high';
}

/**
 * Inject reasoning content from OpenRouter response into the content field.
 *
 * Problem: The OpenAI SDK strips the `reasoning` field from responses before
 * LangChain can preserve it in additional_kwargs.
 *
 * Solution: Intercept the response and prepend reasoning to content with
 * `<reasoning>` tags. Our existing thinkingExtraction.ts will extract it.
 *
 * @internal Exported for testing
 * @returns Modified Response with reasoning injected into content, or original if no reasoning
 */
export async function injectReasoningIntoContent(response: Response): Promise<Response> {
  try {
    const responseBody = (await response.json()) as Record<string, unknown>;
    const choices = responseBody.choices as Record<string, unknown>[] | undefined;
    const firstChoice = choices?.[0];
    const message = firstChoice?.message as Record<string, unknown> | undefined;

    if (!message) {
      // No message - return a fresh Response with the same body
      return new Response(JSON.stringify(responseBody), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    }

    // Check for reasoning content (OpenRouter uses `reasoning` field for DeepSeek R1)
    const reasoning = message.reasoning;

    logger.debug(
      {
        hasReasoning: reasoning !== undefined,
        hasReasoningContent: message.reasoning_content !== undefined,
        messageKeys: Object.keys(message),
      },
      '[ModelFactory] OpenRouter response structure'
    );

    if (typeof reasoning !== 'string' || reasoning.length === 0) {
      // No reasoning to inject - return fresh Response
      return new Response(JSON.stringify(responseBody), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    }

    // Inject reasoning into content with <reasoning> tags
    // Our thinkingExtraction.ts already handles this tag pattern
    const originalContent = typeof message.content === 'string' ? message.content : '';
    message.content = `<reasoning>\n${reasoning}\n</reasoning>\n\n${originalContent}`;

    // Remove the reasoning field to avoid confusion
    delete message.reasoning;

    logger.info(
      {
        reasoningLength: reasoning.length,
        originalContentLength: originalContent.length,
        newContentLength: (message.content as string).length,
      },
      '[ModelFactory] Injected reasoning into content with <reasoning> tags'
    );

    // Return new Response with modified body
    return new Response(JSON.stringify(responseBody), {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } catch (err) {
    // On error, try to return a fresh response
    // Note: we've already consumed the body, so create a minimal error response
    logger.warn({ err }, '[ModelFactory] Failed to process response for reasoning injection');
    throw err; // Let the SDK handle the error
  }
}

/**
 * Inject OpenRouter-specific parameters into the request body.
 * Mutates the init object in place.
 */
function injectOpenRouterParams(
  url: string | URL | Request,
  init: RequestInit,
  extraParams: OpenRouterExtraParams
): void {
  try {
    const body = JSON.parse(init.body as string) as Record<string, unknown>;

    // Inject OpenRouter-specific parameters
    if (extraParams.include_reasoning === true) {
      body.include_reasoning = true;
    }
    if (extraParams.transforms !== undefined && extraParams.transforms.length > 0) {
      body.transforms = extraParams.transforms;
    }
    if (extraParams.route !== undefined) {
      body.route = extraParams.route;
    }
    if (extraParams.verbosity !== undefined) {
      body.verbosity = extraParams.verbosity;
    }

    const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.href : '[Request]';
    logger.info(
      {
        url: urlStr,
        injectedParams: extraParams,
        hasIncludeReasoning: body.include_reasoning,
      },
      '[ModelFactory] Custom fetch injecting OpenRouter params'
    );

    init.body = JSON.stringify(body);
  } catch {
    // If body isn't JSON, pass through unchanged
  }
}

/**
 * Create a custom fetch function that injects OpenRouter-specific parameters
 * into the request body after SDK validation.
 *
 * The OpenAI SDK v4+ requires extra_body as a separate options argument,
 * but LangChain.js doesn't expose this. This workaround intercepts the
 * fetch call and modifies the body before sending.
 */
function createOpenRouterFetch(
  extraParams: OpenRouterExtraParams
): (url: string | URL | Request, init?: RequestInit) => Promise<Response> {
  return async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    if (init?.method === 'POST' && init.body !== undefined && init.body !== null) {
      injectOpenRouterParams(url, init, extraParams);
    }

    const response = await fetch(url, init);

    // Inject reasoning content into response before SDK strips it
    // The SDK removes unknown fields like `reasoning`, so we move it to content
    if (extraParams.include_reasoning === true && init?.method === 'POST') {
      return injectReasoningIntoContent(response);
    }

    return response;
  };
}

/**
 * Validate and normalize model name
 */
function validateModelName(requestedModel: string | undefined): string {
  return requestedModel !== undefined && requestedModel.length > 0
    ? requestedModel
    : config.DEFAULT_AI_MODEL;
}

/**
 * Model configuration for creating chat models.
 * Extends ConvertedLlmParams to include ALL parameters from advancedParameters JSONB.
 *
 * Parameter categories:
 * - Sampling (basic): temperature, topP, topK, frequencyPenalty, presencePenalty, repetitionPenalty
 * - Sampling (advanced): minP, topA, seed
 * - Output: maxTokens, stop, logitBias, responseFormat, showThinking
 * - Reasoning: reasoning object (for thinking models: o1/o3, Claude, Gemini, DeepSeek R1)
 * - OpenRouter-specific: transforms, route, verbosity
 */
export interface ModelConfig extends ConvertedLlmParams {
  modelName?: string;
  apiKey?: string; // User-provided key (BYOK)
}

/**
 * Result of creating a chat model
 */
export interface ChatModelResult {
  model: BaseChatModel;
  modelName: string;
}

/**
 * Add a value to kwargs if defined
 */
function addIfDefined<T>(kwargs: Record<string, unknown>, key: string, value: T | undefined): void {
  if (value !== undefined) {
    kwargs[key] = value;
  }
}

/**
 * Add an array to kwargs if non-empty
 */
function addIfNonEmpty(
  kwargs: Record<string, unknown>,
  key: string,
  value: unknown[] | undefined
): void {
  if (value !== undefined && value.length > 0) {
    kwargs[key] = value;
  }
}

/**
 * Add an object to kwargs if it has keys
 */
function addIfHasKeys(
  kwargs: Record<string, unknown>,
  key: string,
  value: Record<string, unknown> | undefined
): void {
  if (value !== undefined && Object.keys(value).length > 0) {
    kwargs[key] = value;
  }
}

/**
 * Build reasoning params object from ModelConfig reasoning.
 *
 * IMPORTANT: OpenRouter only accepts ONE of `effort` OR `max_tokens`, not both.
 * When both are specified, we prefer `effort` since it's the simpler user-friendly option.
 *
 * @see https://openrouter.ai/docs/parameters#reasoning-effort
 */
function buildReasoningParams(
  reasoning: ModelConfig['reasoning']
): Record<string, unknown> | undefined {
  if (reasoning === undefined) {
    return undefined;
  }

  const params: Record<string, unknown> = {};

  // OpenRouter constraint: only ONE of effort or max_tokens can be specified
  // Prefer effort (simpler) over maxTokens (precise) when both are set
  if (reasoning.effort !== undefined) {
    params.effort = reasoning.effort;
    if (reasoning.maxTokens !== undefined) {
      logger.warn(
        { effort: reasoning.effort, maxTokens: reasoning.maxTokens },
        '[ModelFactory] Both reasoning.effort and reasoning.maxTokens set, using effort (maxTokens ignored - OpenRouter constraint)'
      );
    }
  } else if (reasoning.maxTokens !== undefined) {
    params.max_tokens = reasoning.maxTokens;
  }

  addIfDefined(params, 'exclude', reasoning.exclude);
  addIfDefined(params, 'enabled', reasoning.enabled);

  return Object.keys(params).length > 0 ? params : undefined;
}

/**
 * Build model kwargs for provider-specific parameters.
 * These are params that LangChain doesn't have first-class support for,
 * but OpenRouter/OpenAI accept via the API.
 *
 * Handles:
 * - Sampling (advanced): top_k, repetition_penalty, min_p, top_a, seed
 * - Output: stop, logit_bias, response_format
 * - Reasoning: reasoning object (CRITICAL for thinking models)
 * - OpenRouter-specific: transforms, route, verbosity
 *
 * @see https://openrouter.ai/docs/parameters for full parameter documentation
 */
function buildModelKwargs(modelConfig: ModelConfig): Record<string, unknown> {
  const kwargs: Record<string, unknown> = {};

  // Sampling (advanced) - OpenRouter-specific
  addIfDefined(kwargs, 'top_k', modelConfig.topK);
  addIfDefined(kwargs, 'repetition_penalty', modelConfig.repetitionPenalty);
  addIfDefined(kwargs, 'min_p', modelConfig.minP);
  addIfDefined(kwargs, 'top_a', modelConfig.topA);
  addIfDefined(kwargs, 'seed', modelConfig.seed);

  // Output control
  addIfNonEmpty(kwargs, 'stop', modelConfig.stop);
  addIfHasKeys(kwargs, 'logit_bias', modelConfig.logitBias);
  addIfDefined(kwargs, 'response_format', modelConfig.responseFormat);

  // Reasoning (CRITICAL for thinking models: o1/o3, Claude, Gemini, DeepSeek R1)
  // The 'reasoning' object configures effort/tokens (OpenAI o1/o3 style)
  addIfHasKeys(kwargs, 'reasoning', buildReasoningParams(modelConfig.reasoning));

  // Note: OpenRouter-specific params (include_reasoning, transforms, route, verbosity)
  // are injected via custom fetch wrapper, not modelKwargs, because the OpenAI SDK v4+
  // strips unknown top-level keys from the params object.

  return kwargs;
}

/**
 * Build OpenRouter-specific parameters that need to be injected via custom fetch.
 * These can't go in modelKwargs because the OpenAI SDK strips unknown keys.
 */
function buildOpenRouterExtraParams(modelConfig: ModelConfig): OpenRouterExtraParams {
  const params: OpenRouterExtraParams = {};

  // include_reasoning: opt-in flag for OpenRouter to return thinking content
  // Without this, reasoning models' thinking is stripped from the response
  if (modelConfig.reasoning !== undefined && modelConfig.reasoning.exclude !== true) {
    params.include_reasoning = true;
  }

  // OpenRouter-specific routing/transform options
  if (modelConfig.transforms !== undefined && modelConfig.transforms.length > 0) {
    params.transforms = modelConfig.transforms;
  }
  if (modelConfig.route !== undefined) {
    params.route = modelConfig.route;
  }
  if (modelConfig.verbosity !== undefined) {
    params.verbosity = modelConfig.verbosity;
  }

  return params;
}

/**
 * Create a chat model based on configured AI provider
 *
 * Currently only OpenRouter is supported. OpenRouter can route to any provider
 * including OpenAI, Anthropic, Google, etc. models.
 */
export function createChatModel(modelConfig: ModelConfig = {}): ChatModelResult {
  const provider = config.AI_PROVIDER;

  // Extract sampling parameters (NO DEFAULTS - let model/API decide)
  // See: https://openrouter.ai/docs - different models have different optimal defaults
  const temperature = modelConfig.temperature;
  const topP = modelConfig.topP;
  const frequencyPenalty = modelConfig.frequencyPenalty;
  const presencePenalty = modelConfig.presencePenalty;
  const maxTokens = modelConfig.maxTokens;

  // Build kwargs for provider-specific params (top_k, repetition_penalty)
  const modelKwargs = buildModelKwargs(modelConfig);
  const hasModelKwargs = Object.keys(modelKwargs).length > 0;

  switch (provider) {
    case AIProvider.OpenRouter: {
      const apiKey =
        modelConfig.apiKey !== undefined && modelConfig.apiKey.length > 0
          ? modelConfig.apiKey
          : config.OPENROUTER_API_KEY;
      if (apiKey === undefined || apiKey.length === 0) {
        throw new Error('OPENROUTER_API_KEY is required for AI generation');
      }

      const modelName = validateModelName(modelConfig.modelName);

      // Build OpenRouter-specific params that need custom fetch injection
      const extraParams = buildOpenRouterExtraParams(modelConfig);
      const hasExtraParams = Object.keys(extraParams).length > 0;

      logger.debug(
        {
          provider,
          modelName,
          temperature,
          topP,
          frequencyPenalty,
          presencePenalty,
          maxTokens,
          modelKwargs: hasModelKwargs ? modelKwargs : undefined,
          extraParams: hasExtraParams ? extraParams : undefined,
        },
        '[ModelFactory] Creating model'
      );

      return {
        model: new ChatOpenAI({
          modelName,
          apiKey,
          temperature,
          topP,
          frequencyPenalty,
          presencePenalty,
          maxTokens,
          modelKwargs: hasModelKwargs ? modelKwargs : undefined,
          configuration: {
            baseURL: AI_ENDPOINTS.OPENROUTER_BASE_URL,
            // Use custom fetch to inject OpenRouter-specific params that
            // the OpenAI SDK would otherwise strip from the request body
            fetch: hasExtraParams ? createOpenRouterFetch(extraParams) : undefined,
          },
        }),
        modelName,
      };
    }

    default: {
      // Type guard for exhaustive check - add new providers above
      const _exhaustive: never = provider;
      throw new Error(`Unsupported AI provider: ${String(_exhaustive)}`);
    }
  }
}

/** Serialize a value for cache key, using '-' for undefined/null */
function cacheVal<T>(value: T | undefined | null, defaultVal?: T): string {
  if (value === undefined || value === null) {
    return defaultVal !== undefined ? String(defaultVal) : '-';
  }
  return String(value);
}

/** Serialize an array for cache key */
function cacheArr(value: unknown[] | undefined): string {
  return value !== undefined && value.length > 0 ? value.join(',') : '-';
}

/**
 * Get a cache key for model instances.
 * Includes ALL params so different configs get different cached instances.
 *
 * Important: Different reasoning/sampling configs should produce different model instances
 * to ensure correct behavior for each user's configuration.
 */
export function getModelCacheKey(modelConfig: ModelConfig): string {
  const provider = config.AI_PROVIDER;

  // Resolve model name with fallback chain
  const modelName = modelConfig.modelName ?? (config.DEFAULT_AI_MODEL || 'default');

  // Use API key prefix for cache isolation (different keys = different instances)
  const apiKey = modelConfig.apiKey;
  const apiKeyPrefix =
    apiKey !== undefined && apiKey.length >= 10 ? apiKey.substring(0, 10) : 'env';

  // Build params key from all config values (no defaults - undefined is a valid state)
  const paramsKey = [
    // Basic sampling
    cacheVal(modelConfig.temperature),
    cacheVal(modelConfig.topP),
    cacheVal(modelConfig.topK),
    cacheVal(modelConfig.frequencyPenalty),
    cacheVal(modelConfig.presencePenalty),
    cacheVal(modelConfig.repetitionPenalty),
    // Advanced sampling
    cacheVal(modelConfig.minP),
    cacheVal(modelConfig.topA),
    cacheVal(modelConfig.seed),
    // Output
    cacheVal(modelConfig.maxTokens),
    cacheArr(modelConfig.stop),
    cacheVal(modelConfig.responseFormat?.type),
    // Reasoning
    cacheVal(modelConfig.reasoning?.effort),
    cacheVal(modelConfig.reasoning?.maxTokens),
    // OpenRouter
    cacheArr(modelConfig.transforms),
    cacheVal(modelConfig.route),
  ].join(':');

  return `${provider}-${modelName}-${apiKeyPrefix}-${paramsKey}`;
}
