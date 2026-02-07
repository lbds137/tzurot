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
  AI_DEFAULTS,
  AI_ENDPOINTS,
  type ConvertedLlmParams,
} from '@tzurot/common-types';
import { isReasoningModel } from '../utils/reasoningModelUtils.js';

const logger = createLogger('ModelFactory');
const config = getConfig();

/**
 * OpenRouter-specific parameters injected into the request body via custom fetch.
 *
 * Note: The OpenAI SDK does NOT strip unknown keys at runtime (it just
 * JSON.stringify's the body). These could go in modelKwargs instead, but we
 * already need the custom fetch wrapper for response interception (see below),
 * so we inject them there for consistency.
 */
export interface OpenRouterExtraParams {
  transforms?: string[];
  route?: 'fallback';
  verbosity?: 'low' | 'medium' | 'high';
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
      },
      '[ModelFactory] Custom fetch injecting OpenRouter params'
    );

    init.body = JSON.stringify(body);
  } catch {
    // If body isn't JSON, pass through unchanged
  }
}

/**
 * Extract reasoning text from OpenRouter's reasoning_details array.
 * Handles multiple detail types: reasoning.text, reasoning.summary.
 * Encrypted blocks (reasoning.encrypted) are skipped (unreadable).
 */
function extractReasoningFromDetails(details: unknown[]): string | null {
  const texts: string[] = [];
  for (const item of details) {
    if (typeof item !== 'object' || item === null) {
      continue;
    }
    const detail = item as Record<string, unknown>;
    if (detail.type === 'reasoning.text' && typeof detail.text === 'string') {
      texts.push(detail.text);
    } else if (detail.type === 'reasoning.summary' && typeof detail.summary === 'string') {
      texts.push(detail.summary);
    }
  }
  return texts.length > 0 ? texts.join('\n') : null;
}

/**
 * Extract reasoning from a single response message and inject it into content.
 * Returns true if reasoning was found and injected.
 *
 * Handles two response formats:
 * - message.reasoning (string) — DeepSeek R1, Kimi K2, QwQ, GLM
 * - message.reasoning_details (array) — Claude Extended Thinking, Gemini, o-series
 */
function injectReasoningIntoMessage(message: Record<string, unknown>): boolean {
  // Log what keys the message has for debugging
  logger.info(
    {
      messageKeys: Object.keys(message),
      hasReasoning: typeof message.reasoning === 'string',
      reasoningLength: typeof message.reasoning === 'string' ? message.reasoning.length : 0,
      hasReasoningDetails: Array.isArray(message.reasoning_details),
    },
    '[ModelFactory] Inspecting response message for reasoning content'
  );

  let reasoning: string | null = null;

  // Source 1: message.reasoning (string — DeepSeek R1, Kimi K2, QwQ)
  if (typeof message.reasoning === 'string' && message.reasoning.length > 0) {
    reasoning = message.reasoning;
  }
  // Source 2: message.reasoning_details (array — Claude, Gemini, o-series)
  else if (Array.isArray(message.reasoning_details)) {
    reasoning = extractReasoningFromDetails(message.reasoning_details);
  }

  if (reasoning === null) {
    return false;
  }

  const content = typeof message.content === 'string' ? message.content : '';
  message.content = `<reasoning>${reasoning}</reasoning>\n${content}`;

  logger.debug(
    { reasoningLength: reasoning.length, contentLength: content.length },
    '[ModelFactory] Injected reasoning from API response into content'
  );

  return true;
}

/**
 * Intercept OpenRouter API response to preserve reasoning content.
 *
 * LangChain's Chat Completions converter only extracts function_call, tool_calls,
 * and audio from the response message — reasoning fields are silently dropped.
 * We intercept the raw response to extract reasoning and inject it into the
 * message content as <reasoning> tags, which thinkingExtraction.ts then processes.
 */
function interceptReasoningResponse(responseBody: Record<string, unknown>): boolean {
  const choices = responseBody.choices;
  if (!Array.isArray(choices)) {
    return false;
  }

  let modified = false;
  for (const choice of choices) {
    if (typeof choice !== 'object' || choice === null) {
      continue;
    }
    const msg = (choice as Record<string, unknown>).message;
    if (typeof msg !== 'object' || msg === null) {
      continue;
    }
    if (injectReasoningIntoMessage(msg as Record<string, unknown>)) {
      modified = true;
    }
  }
  return modified;
}

/**
 * Try to recover valid content from a 400-class error response.
 *
 * Some models (free-tier GLM, etc.) return HTTP 400 with usable content in
 * choices[].message.content that would otherwise be lost when LangChain throws
 * on the error status code. If content is found, returns a synthetic 200 Response.
 *
 * @returns Synthetic 200 Response with recovered content, or null if not recoverable
 */
async function tryRecoverErrorContent(response: Response): Promise<Response | null> {
  try {
    const clone = response.clone();
    const body = (await clone.json()) as Record<string, unknown>;
    const choices = body.choices;
    if (!Array.isArray(choices) || choices.length === 0) {
      return null;
    }
    const firstChoice = choices[0] as Record<string, unknown> | undefined;
    const msg = firstChoice?.message as Record<string, unknown> | undefined;
    const content = msg?.content;
    if (typeof content !== 'string' || content.length === 0) {
      return null;
    }

    logger.warn(
      { status: response.status, contentLength: content.length },
      '[ModelFactory] Recovered valid content from error response — synthesizing 200'
    );
    interceptReasoningResponse(body);
    return new Response(JSON.stringify(body), {
      status: 200,
      statusText: 'OK',
      headers: response.headers,
    });
  } catch {
    return null;
  }
}

/**
 * Create a custom fetch function for OpenRouter requests.
 *
 * Two responsibilities:
 * 1. REQUEST: Inject OpenRouter-specific params (transforms, route, verbosity)
 * 2. RESPONSE: Extract reasoning content that LangChain would otherwise drop
 *
 * Response interception is necessary because LangChain's Chat Completions
 * converter only preserves function_call/tool_calls/audio from the message
 * object — the `reasoning` and `reasoning_details` fields are silently lost.
 * We inject reasoning into message.content as <reasoning> tags before LangChain
 * parses the response.
 */
function createOpenRouterFetch(
  extraParams: OpenRouterExtraParams
): (url: string | URL | Request, init?: RequestInit) => Promise<Response> {
  return async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    // REQUEST: Inject OpenRouter-specific params
    const hasExtraParams = Object.keys(extraParams).length > 0;
    if (
      hasExtraParams &&
      init?.method === 'POST' &&
      init.body !== undefined &&
      init.body !== null
    ) {
      injectOpenRouterParams(url, init, extraParams);
    }

    const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.href : '[Request]';
    logger.info(
      { url: urlStr, method: init?.method },
      '[ModelFactory] Custom fetch intercepting request'
    );

    const response = await fetch(url, init);

    // RESPONSE: Intercept to preserve reasoning content
    // Only process successful JSON responses (non-streaming)
    const contentType = response.headers.get('content-type');
    logger.info(
      {
        status: response.status,
        ok: response.ok,
        contentType,
      },
      '[ModelFactory] Custom fetch received response'
    );

    // For 400-class errors with JSON body, try to recover valid content
    if (!response.ok) {
      const isJsonClientError =
        response.status >= 400 &&
        response.status < 500 &&
        contentType?.includes('application/json') === true;
      if (isJsonClientError) {
        const recovered = await tryRecoverErrorContent(response);
        if (recovered !== null) {
          return recovered;
        }
      }
      return response;
    }
    if (contentType === null) {
      return response;
    }
    if (!contentType.includes('application/json')) {
      return response;
    }

    // Clone before consuming so the original body stays intact on parse failure
    const clone = response.clone();
    try {
      const body = (await clone.json()) as Record<string, unknown>;
      const modified = interceptReasoningResponse(body);

      logger.info({ reasoningInjected: modified }, '[ModelFactory] Response interception complete');

      // Re-create the response from the parsed (possibly modified) body
      return new Response(JSON.stringify(body), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } catch (err) {
      logger.warn(
        { err },
        '[ModelFactory] Failed to parse response JSON for reasoning interception'
      );
      // Clone was consumed, but original response body is intact — return it
      return response;
    }
  };
}

/**
 * Models with restricted parameter sets.
 * Some providers only support a subset of sampling parameters.
 * Sending unsupported params causes 400 "Provider returned error" from OpenRouter.
 *
 * Maps model patterns to sets of unsupported parameter names (snake_case API keys).
 * Filtering covers both first-class ChatOpenAI params and modelKwargs.
 */
const RESTRICTED_PARAM_MODELS: { pattern: RegExp; unsupported: ReadonlySet<string> }[] = [
  {
    // GLM 4.5 Air supports only: temperature, top_p, top_k, max_tokens,
    // repetition_penalty, reasoning, tools, tool_choice
    // frequency_penalty confirmed to cause 400 errors in production
    pattern: /glm-4\.5-air/i,
    unsupported: new Set(['frequency_penalty', 'presence_penalty', 'seed']),
  },
];

/**
 * Filter unsupported sampling params for models with restricted parameter sets.
 * Mutates modelKwargs in place and returns cleaned first-class params.
 *
 * @returns Object with filtered first-class params (frequency_penalty, presence_penalty)
 */
function filterRestrictedParams(
  modelName: string,
  firstClassParams: { frequencyPenalty?: number; presencePenalty?: number },
  modelKwargs: Record<string, unknown>
): { frequencyPenalty?: number; presencePenalty?: number } {
  // Find restricted param set for this model
  let unsupported: ReadonlySet<string> | null = null;
  for (const entry of RESTRICTED_PARAM_MODELS) {
    if (entry.pattern.test(modelName)) {
      unsupported = entry.unsupported;
      break;
    }
  }
  if (unsupported === null) {
    return firstClassParams;
  }

  const filtered: string[] = [];
  let { frequencyPenalty, presencePenalty } = firstClassParams;

  if (frequencyPenalty !== undefined && unsupported.has('frequency_penalty')) {
    frequencyPenalty = undefined;
    filtered.push('frequency_penalty');
  }
  if (presencePenalty !== undefined && unsupported.has('presence_penalty')) {
    presencePenalty = undefined;
    filtered.push('presence_penalty');
  }
  // Filter from modelKwargs (keys are already snake_case)
  for (const key of Object.keys(modelKwargs)) {
    if (unsupported.has(key)) {
      delete modelKwargs[key];
      filtered.push(key);
    }
  }
  if (filtered.length > 0) {
    logger.warn(
      { modelName, filteredParams: filtered },
      '[ModelFactory] Filtered unsupported params for restricted model to prevent 400 errors'
    );
  }

  return { frequencyPenalty, presencePenalty };
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

  // Note: OpenRouter-specific params (transforms, route, verbosity) are injected via
  // custom fetch wrapper for consistency with the response interception logic.

  return kwargs;
}

/**
 * Build OpenRouter-specific parameters that are injected via custom fetch.
 * These could go in modelKwargs (the SDK doesn't strip keys), but since we
 * already need custom fetch for response interception, we inject them there.
 */
function buildOpenRouterExtraParams(modelConfig: ModelConfig): OpenRouterExtraParams {
  const params: OpenRouterExtraParams = {};

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
 * Type for reasoning effort levels (must match AI_DEFAULTS.REASONING_MODEL_MAX_TOKENS keys)
 */
type ReasoningEffort = 'xhigh' | 'high' | 'medium' | 'low' | 'minimal' | 'none';

/**
 * Calculate effective maxTokens for a model based on reasoning configuration.
 *
 * For reasoning models (o1, Claude 3.7+, DeepSeek R1, Kimi K2, etc.):
 * - Scales maxTokens based on reasoning.effort level
 * - Ensures thinking content isn't truncated
 * - Only applies when user hasn't explicitly set maxTokens
 *
 * For standard models:
 * - Uses the config maxTokens as-is (undefined = let API decide)
 *
 * @param modelName - The model identifier
 * @param configMaxTokens - User-configured maxTokens (undefined = not set)
 * @param reasoningEffort - Reasoning effort level from config
 * @returns Effective maxTokens to use
 */
function getEffectiveMaxTokens(
  modelName: string,
  configMaxTokens: number | undefined,
  reasoningEffort: ReasoningEffort | undefined
): number | undefined {
  // User-configured maxTokens always takes precedence
  if (configMaxTokens !== undefined) {
    return configMaxTokens;
  }

  // Only scale for reasoning models with effort configured
  if (!isReasoningModel(modelName) || reasoningEffort === undefined) {
    return configMaxTokens; // undefined = let API decide
  }

  // Get scaled token limit based on effort
  const scaledMaxTokens = AI_DEFAULTS.REASONING_MODEL_MAX_TOKENS[reasoningEffort];

  logger.info(
    {
      modelName,
      reasoningEffort,
      scaledMaxTokens,
      defaultMaxTokens: AI_DEFAULTS.MAX_TOKENS,
    },
    '[ModelFactory] Scaling maxTokens for reasoning model based on effort level'
  );

  return scaledMaxTokens;
}

/**
 * Create a chat model based on configured AI provider
 *
 * Currently only OpenRouter is supported. OpenRouter can route to any provider
 * including OpenAI, Anthropic, Google, etc. models.
 */
export function createChatModel(modelConfig: ModelConfig = {}): ChatModelResult {
  const provider = config.AI_PROVIDER;
  const modelName = validateModelName(modelConfig.modelName);

  // Extract sampling parameters (NO DEFAULTS - let model/API decide)
  // See: https://openrouter.ai/docs - different models have different optimal defaults
  const temperature = modelConfig.temperature;
  const topP = modelConfig.topP;

  // Calculate effective maxTokens - scaled for reasoning models with effort configured
  const maxTokens = getEffectiveMaxTokens(
    modelName,
    modelConfig.maxTokens,
    modelConfig.reasoning?.effort
  );

  // Build kwargs for provider-specific params (top_k, repetition_penalty)
  const modelKwargs = buildModelKwargs(modelConfig);

  // Filter unsupported params for restricted models (prevents 400 errors)
  const { frequencyPenalty, presencePenalty } = filterRestrictedParams(
    modelName,
    {
      frequencyPenalty: modelConfig.frequencyPenalty,
      presencePenalty: modelConfig.presencePenalty,
    },
    modelKwargs
  );

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

      // Build OpenRouter-specific params that need custom fetch injection
      const extraParams = buildOpenRouterExtraParams(modelConfig);
      const hasExtraParams = Object.keys(extraParams).length > 0;

      // Custom fetch is needed for:
      // 1. Injecting OpenRouter-specific request params (transforms, route, verbosity)
      // 2. Intercepting responses to preserve reasoning content (LangChain drops it)
      const hasReasoning = modelConfig.reasoning !== undefined;
      const needsCustomFetch = hasExtraParams || hasReasoning;

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
          reasoningEnabled: hasReasoning,
          customFetch: needsCustomFetch,
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
            // Custom fetch for OpenRouter param injection + reasoning response interception
            fetch: needsCustomFetch ? createOpenRouterFetch(extraParams) : undefined,
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
    cacheVal(modelConfig.showThinking),
    // Reasoning - all fields affect reasoning param in modelKwargs
    cacheVal(modelConfig.reasoning?.enabled),
    cacheVal(modelConfig.reasoning?.exclude),
    cacheVal(modelConfig.reasoning?.effort),
    cacheVal(modelConfig.reasoning?.maxTokens),
    // OpenRouter
    cacheArr(modelConfig.transforms),
    cacheVal(modelConfig.route),
  ].join(':');

  return `${provider}-${modelName}-${apiKeyPrefix}-${paramsKey}`;
}
