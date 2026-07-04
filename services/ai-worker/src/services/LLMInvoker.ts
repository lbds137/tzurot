/**
 * LLM Invoker
 *
 * Handles language model invocation with retry logic, timeout handling, and model caching.
 * Extracted from ConversationalRAGService for better modularity and testability.
 *
 * Reasoning Model Support:
 * - Detects and handles reasoning/thinking models (o1, Claude 3.7+, Gemini Thinking)
 * - Transforms messages for models that don't support system messages
 * - Thinking tag extraction delegated to ResponsePostProcessor
 */

import { BaseMessage } from '@langchain/core/messages';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import {
  ERROR_MESSAGES,
  ApiErrorType,
  ApiErrorCategory,
  USER_ERROR_MESSAGES,
} from '@tzurot/common-types/constants/error';
import {
  FINISH_REASONS,
  isNaturalStop,
  resolveFinishReason,
} from '@tzurot/common-types/constants/finishReasons';
import { RETRY_CONFIG, TIMEOUTS } from '@tzurot/common-types/constants/timing';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { calculateJobTimeout } from '@tzurot/common-types/utils/timeout';
import {
  createChatModel,
  getModelCacheKey,
  type ChatModelResult,
  type ModelConfig,
} from './ModelFactory.js';
import { extractAndPopulateOpenRouterReasoning } from './modelFactory/extractOpenRouterReasoning.js';
import { withRetry, RetryError } from '../utils/retry.js';
import {
  shouldRetryError,
  getErrorLogContext,
  parseApiError,
  ApiError,
} from '../utils/apiErrorParser.js';
import { type RateLimitCache, assertValidCacheKeyId } from './RateLimitCache.js';
import type { CreditExhaustionCache } from './CreditExhaustionCache.js';
import { rateLimitCache, creditExhaustionCache } from '../redis.js';
import {
  getReasoningModelConfig,
  transformMessagesForReasoningModel,
  ReasoningModelType,
} from '../utils/reasoningModelUtils.js';

const logger = createLogger('LLMInvoker');

/**
 * Default cooldown applied when a 429 lacks a usable `X-RateLimit-Reset`
 * header. 15 minutes is the middle ground between two failure modes:
 *
 *   - Too short → cache expires before the real upstream limit resets,
 *     and the next request burns another ~80s retry cycle. With a 5-minute
 *     default and a 1-hour real reset, the overhead is ~27%.
 *   - Too long → users stay blocked past the real reset window. With a
 *     1-hour default and a 1-minute real reset, they wait 59 unnecessary
 *     minutes.
 *
 * 15 minutes caps the retry-storm overhead at ~6% in the worst case while
 * keeping shorter-than-15-min flaps from accumulating real user wait.
 * Tune in either direction once we have prod logs of actual reset windows.
 */
const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 15 * 60 * 1000;

/**
 * Default reset timestamp for a 429 whose response didn't include a usable
 * `X-RateLimit-Reset` header. Returns `null` if the category doesn't qualify
 * for default caching (caller should skip the cache write).
 *
 * Currently both RATE_LIMIT and QUOTA_EXCEEDED qualify — they both indicate
 * the upstream is refusing requests until something resets, and we don't
 * have header signal to distinguish duration. QUOTA_EXCEEDED routing is
 * defensive: under current `classifyHttpStatus`, a 429 always lands in
 * RATE_LIMIT, but `detectSpecialCases` or future routing could escalate.
 */
function defaultRateLimitResetMs(category: ApiErrorCategory): number | null {
  return category === ApiErrorCategory.RATE_LIMIT || category === ApiErrorCategory.QUOTA_EXCEEDED
    ? Date.now() + DEFAULT_RATE_LIMIT_COOLDOWN_MS
    : null;
}

/**
 * Options for invoking an LLM with retry logic
 */
interface InvokeWithRetryOptions {
  /** LangChain chat model to invoke */
  model: BaseChatModel;
  /** Message array to send to the model */
  messages: BaseMessage[];
  /** Model name for logging */
  modelName: string;
  /**
   * Opaque scope identifier for the rate-limit cache bucket. Typically
   * `user:<discordUserId>` for BYOK callers, or `system` for guest mode /
   * system-key fallback. Chosen by the caller to correctly isolate
   * rate-limit state per (account, model) pair without being derived from
   * any credential value. Optional with an empty-string default to keep
   * legacy test fixtures compiling; production callers
   * (e.g., `ConversationalRAGService`) always pass an explicit value.
   *
   * Empty string skips both cache read and cache write — the LLM call runs
   * unguarded and any 429 follows the original retry path.
   */
  cacheKeyId?: string;
  /** Number of images in the request (for timeout calculation) */
  imageCount?: number;
  /** Number of audio attachments in the request (for timeout calculation) */
  audioCount?: number;
  /**
   * Override for the transient-retry attempt count. Defaults to
   * `RETRY_CONFIG.MAX_ATTEMPTS`. Callers set this to 1 to fail fast on the first
   * error when a higher-level fallback (e.g. ProviderRouter's OpenRouter
   * passthrough) is the intended recovery path rather than in-place retry.
   */
  maxAttempts?: number;
}

export class LLMInvoker {
  private models = new Map<string, ChatModelResult>();

  /**
   * Get or create a chat model for a specific configuration.
   * This supports BYOK (Bring Your Own Key) - different users can use different keys.
   * Returns both the model and the validated model name.
   *
   * @param config - Model configuration including sampling params
   */
  getModel(config: ModelConfig): ChatModelResult {
    const cacheKey = getModelCacheKey(config);

    if (!this.models.has(cacheKey)) {
      this.models.set(cacheKey, createChatModel(config));
    }

    const model = this.models.get(cacheKey);
    if (model === undefined) {
      throw new Error(`Model not found for cache key: ${cacheKey}`);
    }
    return model;
  }

  /**
   * Invoke LLM with timeout and retry logic for transient errors
   *
   * Features:
   * - Retries on all errors (network errors, timeouts, empty responses)
   * - Exponential backoff between retries (1s, 2s, 4s, ...)
   * - Dynamic global timeout based on attachment count
   * - Per-attempt timeout using LLM_PER_ATTEMPT constant
   * - Reasoning model support (o1, Claude 3.7+, Gemini Thinking)
   */
  async invokeWithRetry(options: InvokeWithRetryOptions): Promise<BaseMessage> {
    const {
      model,
      messages,
      modelName,
      cacheKeyId = '',
      imageCount = 0,
      audioCount = 0,
      maxAttempts = RETRY_CONFIG.MAX_ATTEMPTS,
    } = options;

    if (cacheKeyId.length === 0) {
      // An empty `cacheKeyId` skips both caches entirely — currently used by
      // legacy test fixtures and any production caller that forgets to thread
      // the value through. Surface it as a debug log so the silent opt-out is
      // at least visible in local dev when wiring up a new caller. (Promoting
      // the field to required in the type is tracked in `backlog/cold/follow-ups.md`.)
      logger.debug(
        { modelName },
        'Empty cacheKeyId — rate-limit + credit-exhaustion caches skipped'
      );
    } else {
      // Validate the caller-supplied `cacheKeyId` shape before it flows into
      // Redis key construction. The check is also applied inside
      // `deriveCacheKeyId` (the canonical producer), but `cacheKeyId` is typed
      // as optional on `InvokeWithRetryOptions` and callers can pass any
      // string without going through `deriveCacheKeyId`. This second guard
      // catches future callers that bypass the producer — without it a
      // colon-bearing scope (e.g., `org:my-team:special`) would silently
      // corrupt the `<prefix>:<id>:<model>` key shape with no log signal.
      // Warn-only contract: assertion never throws, so cache short-circuit
      // continues unchanged for currently-valid shapes.
      assertValidCacheKeyId(cacheKeyId);
      // Credit-exhaustion cache short-circuit runs FIRST: a 402 is a permanent
      // account state until top-up, while a 429 is a time-bounded transient
      // block. If both cache hits exist, surface the worse one — credit
      // exhaustion blocks all OpenRouter calls regardless of model, so a
      // CREDIT_EXHAUSTION error is more informative than a per-model RATE_LIMIT.
      await this.shortCircuitOnCreditExhaustion(creditExhaustionCache, cacheKeyId);
      // Rate-limit cache short-circuit — when a previous 429 told us the
      // (cacheKeyId, model) pair is in a known rate-limit window, fail fast
      // instead of burning ~80s × 3 retry attempts to land on the same result.
      await this.shortCircuitOnCachedRateLimit(rateLimitCache, cacheKeyId, modelName);
    }

    // Calculate job timeout for logging (attachments processed in separate jobs)
    const jobTimeout = calculateJobTimeout(imageCount, audioCount);
    // LLM always gets full independent timeout budget (480s = 8 minutes)
    const globalTimeoutMs = TIMEOUTS.LLM_INVOCATION;

    // Get reasoning model config for special handling
    const reasoningConfig = getReasoningModelConfig(modelName);
    const isReasoningModel = reasoningConfig.type !== ReasoningModelType.Standard;

    if (isReasoningModel) {
      logger.info(
        {
          modelName,
          reasoningType: reasoningConfig.type,
          allowsSystemMessage: reasoningConfig.allowsSystemMessage,
        },
        'Detected reasoning model, applying special handling'
      );
    }

    // Transform messages for reasoning models (e.g., convert system to user for o1)
    const transformedMessages = transformMessagesForReasoningModel(messages, reasoningConfig);

    logger.info(
      {
        modelName,
        imageCount,
        audioCount,
        jobTimeout,
        globalTimeoutMs,
        isReasoningModel,
        originalMessageCount: messages.length,
        transformedMessageCount: transformedMessages.length,
      },
      `Dynamic timeout calculated: ${globalTimeoutMs}ms (job: ${jobTimeout}ms)`
    );

    // Use retryService for consistent retry behavior
    // Fast-fail on permanent errors (auth, quota, content policy, etc.)
    let result;
    try {
      result = await withRetry(
        () => this.invokeSingleAttempt(model, transformedMessages, modelName),
        {
          maxAttempts,
          globalTimeoutMs,
          logger,
          operationName: `LLM invocation (${modelName})`,
          shouldRetry: shouldRetryError,
          getErrorContext: getErrorLogContext,
        }
      );
    } catch (err) {
      // Cache rate-limit state on 429 with a usable reset header so the next
      // call in the same window short-circuits at the top of this function.
      // No-throw failure mode: marker write errors are swallowed inside the
      // cache itself (degraded write logs warn, returns void).
      if (cacheKeyId.length > 0) {
        await this.cacheRateLimitOnFailure(rateLimitCache, cacheKeyId, modelName, err);
        await this.cacheCreditExhaustionOnFailure(creditExhaustionCache, cacheKeyId, err);
      }
      throw err;
    }

    // Note: Thinking tag extraction is handled by ResponsePostProcessor downstream.
    // We do NOT strip tags here to avoid losing reasoning content before it can be
    // extracted and displayed to users (when showThinking is enabled).

    return result.value;
  }

  /**
   * Throw a synthetic ApiError when the rate-limit cache says this
   * (cacheKeyId, model) pair is in a known rate-limit window. The thrown
   * error has the same shape downstream consumers see for real 429s, so
   * error handling in `ConversationalRAGService` and friends works unchanged.
   */
  private async shortCircuitOnCachedRateLimit(
    cache: RateLimitCache,
    cacheKeyId: string,
    modelName: string
  ): Promise<void> {
    const result = await cache.isRateLimited({ cacheKeyId, model: modelName });
    if (!result.rateLimited) {
      return;
    }
    logger.info(
      {
        cacheKeyId,
        model: modelName,
        category: result.category,
        ttlSeconds: result.ttlSeconds,
        resetIso: new Date(result.resetMs).toISOString(),
      },
      'Skipped LLM call — rate-limit cache hit'
    );
    // Use the cached category + userMessage + technicalMessage directly
    // instead of re-parsing through a stub message. This preserves the
    // user-facing distinction between RATE_LIMIT and QUOTA_EXCEEDED that
    // the original 429 had — pre-cache, the user saw a category-specific
    // message; collapsing everything to a generic "too many requests"
    // string at synthetic-error construction would silently drop the
    // QUOTA_EXCEEDED routing (which carries actionable wording about
    // credits + the limit-reset window).
    //
    // `shouldRetry: false` + `type: PERMANENT`: a synthetic short-circuit
    // represents a KNOWN rate-limit window with a reset time, not a
    // transient error worth retrying. Without these, a future caller using
    // `shouldRetryError()` on the thrown error would re-enter
    // `invokeWithRetry` → cache hits → throws → loops until exhausted.
    //
    // `referenceId: 'rate-limit-cache-hit'`: stable sentinel since there's
    // no real upstream call to trace. Makes it unambiguous in logs/UX
    // that the reference traces to cache logic, not an upstream call.
    throw new ApiError('Rate limit cached', {
      type: ApiErrorType.PERMANENT,
      category: result.category,
      statusCode: 429,
      userMessage: result.userMessage,
      technicalMessage: result.technicalMessage,
      referenceId: 'rate-limit-cache-hit',
      shouldRetry: false,
      rateLimitResetMs: result.resetMs,
    });
  }

  /**
   * Inspect a thrown error from `withRetry` and, if it's a 429, mark the
   * (cacheKeyId, model) pair as rate-limited in the cache. Subsequent calls
   * during the window will short-circuit.
   *
   * `withRetry` wraps the underlying provider error in a `RetryError` whose
   * `lastError` field holds the original 429. Parsing the wrapper directly
   * loses the status code + headers, so unwrap when present before parsing.
   *
   * **Reset timestamp resolution**:
   *
   *   1. If the parsed error carries a usable `rateLimitResetMs` (from a
   *      well-formed `X-RateLimit-Reset` header), use it verbatim.
   *   2. If the 429's category is `RATE_LIMIT` or `QUOTA_EXCEEDED` and no
   *      header is present, default to a flat cooldown (see
   *      `DEFAULT_RATE_LIMIT_COOLDOWN_MS` for the duration + cost analysis).
   *   3. Otherwise (non-429 or unexpected category), don't cache.
   *
   * Without the fallback, upstream 429s that lack a reset header (e.g.,
   * Google AI Studio free-tier through OpenRouter) burned three full retry
   * attempts every time, with each retry hitting a fresh 429.
   *
   * **Clock semantics**: `defaultRateLimitResetMs` calls `Date.now()` at the
   * moment this method runs — which is *after* all retries exhaust. The
   * effective cooldown window from the original 429 is therefore
   * `DEFAULT_RATE_LIMIT_COOLDOWN_MS + retry-loop overhead` (~80s on the
   * 3-attempt path). Slightly conservative, not loose.
   */
  private async cacheRateLimitOnFailure(
    cache: RateLimitCache,
    cacheKeyId: string,
    modelName: string,
    err: unknown
  ): Promise<void> {
    // `withRetry` wraps the original provider error in `RetryError.lastError`.
    // Use `instanceof` rather than a duck-type check on `'lastError' in err`
    // so the dependency on RetryError's shape is compiler-checked.
    const underlying = err instanceof RetryError ? err.lastError : err;
    const errorInfo = parseApiError(underlying);
    if (errorInfo.statusCode !== 429) {
      return;
    }
    const resetTimestampMs =
      errorInfo.rateLimitResetMs ?? defaultRateLimitResetMs(errorInfo.category);
    if (resetTimestampMs === null) {
      return;
    }
    await cache.markRateLimited({
      cacheKeyId,
      model: modelName,
      resetTimestampMs,
      // Persist category + messages so the synthetic short-circuit at read
      // time can replay the same user-facing message the user would have
      // seen on a real upstream call. Without these, every cache hit
      // collapsed to the generic RATE_LIMIT message even when the original
      // 429 routed to QUOTA_EXCEEDED (different actionable wording about
      // credits + limit-reset windows).
      //
      // `technicalMessage` is optional on `errorInfo` (parseApiError's
      // post-truncation `?.substring` can produce undefined); fall back to
      // empty string rather than persist `undefined` (which would JSON-
      // serialize to absent and trip the read-side schema check).
      category: errorInfo.category,
      userMessage: errorInfo.userMessage,
      technicalMessage: errorInfo.technicalMessage ?? '',
    });
  }

  /**
   * Throw a synthetic ApiError when the credit-exhaustion cache says this
   * `cacheKeyId` is known to be out of credits. The thrown error has the
   * same shape downstream consumers see for real 402s, with a stable
   * sentinel `referenceId` that traces unambiguously to cache logic.
   */
  private async shortCircuitOnCreditExhaustion(
    cache: CreditExhaustionCache,
    cacheKeyId: string
  ): Promise<void> {
    const result = await cache.isCreditExhausted({ cacheKeyId });
    if (!result.exhausted) {
      return;
    }
    logger.info(
      {
        cacheKeyId,
        ttlSeconds: result.ttlSeconds,
        exhaustedAtIso: new Date(result.exhaustedAtMs).toISOString(),
      },
      'Skipped LLM call — credit-exhaustion cache hit'
    );
    // The synthetic message carries "Insufficient credits" so
    // `isAccountCreditExhaustion` routes it to CREDIT_EXHAUSTION inside
    // parseApiError; the explicit `category` + `userMessage` overrides
    // below are belt-and-suspenders against any future change to either
    // the synthetic message text or the pattern-matching helper.
    const errorInfo = parseApiError(
      Object.assign(
        new Error('Insufficient credits. This account has no credits — top up to continue.'),
        { status: 402 }
      )
    );
    throw new ApiError('Credit exhaustion cached', {
      ...errorInfo,
      shouldRetry: false,
      type: ApiErrorType.PERMANENT,
      category: ApiErrorCategory.CREDIT_EXHAUSTION,
      // Explicit override: don't rely on the spread carrying the right
      // userMessage from parseApiError's category-routing. If the synthetic
      // message ever stops matching `isAccountCreditExhaustion` (e.g., a
      // future text edit), the spread would inherit the generic
      // QUOTA_EXCEEDED message even with the explicit category override —
      // category and userMessage would silently disagree.
      userMessage: USER_ERROR_MESSAGES[ApiErrorCategory.CREDIT_EXHAUSTION],
      referenceId: 'credit-exhaustion-cache-hit',
    });
  }

  /**
   * Inspect a thrown error from `withRetry` and, if it parses as
   * `CREDIT_EXHAUSTION` (account-level 402), mark the `cacheKeyId` account as
   * out of credits in the cache. Subsequent calls during the TTL window will
   * short-circuit at the top of `invokeWithRetry`.
   *
   * Single source of truth: keys on `errorInfo.category` rather than
   * `statusCode === 402 + isAccountCreditExhaustion`. The category routing in
   * `parseApiError` already encodes the account-vs-request-level distinction.
   */
  private async cacheCreditExhaustionOnFailure(
    cache: CreditExhaustionCache,
    cacheKeyId: string,
    err: unknown
  ): Promise<void> {
    const underlying = err instanceof RetryError ? err.lastError : err;
    const errorInfo = parseApiError(underlying);
    if (errorInfo.category !== ApiErrorCategory.CREDIT_EXHAUSTION) {
      return;
    }
    await cache.markCreditExhausted({ cacheKeyId });
  }

  /**
   * Execute a single LLM invocation attempt with timeout and validation
   *
   * @param model - LangChain chat model to invoke
   * @param messages - Message array to send to the model
   * @param modelName - Model name for logging
   * @throws Error on timeout, network errors, empty responses, or censored responses
   * @private
   */
  private async invokeSingleAttempt(
    model: BaseChatModel,
    messages: BaseMessage[],
    modelName: string
  ): Promise<BaseMessage> {
    const invokeOptions: { timeout: number } = {
      timeout: TIMEOUTS.LLM_PER_ATTEMPT,
    };

    // Invoke with per-attempt timeout (3 minutes per attempt)
    const response = await model.invoke(messages, invokeOptions);

    // Extract OpenRouter reasoning from additional_kwargs.__raw_response and
    // populate the standard fields downstream consumers expect. Mutates response
    // in place — the return value is intentionally discarded; the in-place
    // mutation IS the contract that ResponsePostProcessor / DiagnosticRecorders
    // observe. See extractOpenRouterReasoning.ts header for full rationale.
    extractAndPopulateOpenRouterReasoning(response);

    // Log finish_reason for completion quality diagnostics
    // This helps identify models that fail to emit stop tokens (hallucinated turn bug)
    const finishReason = this.logFinishReason(response, modelName);

    // A provider failure inside an HTTP 200: OpenRouter surfaces upstream
    // mid-generation errors as finish_reason 'error', typically with partial
    // (often single-character) content that would pass the emptiness guard
    // below, reach delivery, and be stored to LTM. Throw retryable instead —
    // a retry re-enters OpenRouter's provider routing, which usually lands on
    // a DIFFERENT upstream host than the one that just failed. Scoped
    // strictly to 'error': other non-standard reasons (content_filter,
    // length) carry their own semantics and stay observability-only. The
    // thrown message is STABLE (see ERROR_MESSAGES.PROVIDER_ERROR_FINISH);
    // the provider's own failure detail rides this warn log.
    if (finishReason === FINISH_REASONS.ERROR) {
      const providerErrorFailure = new Error(ERROR_MESSAGES.PROVIDER_ERROR_FINISH);
      logger.warn(
        {
          err: providerErrorFailure,
          modelName,
          providerErrorDetail: this.extractProviderErrorDetail(response),
          ...this.extractResponseDiagnostics(response),
        },
        'Provider reported an error finish_reason, treating as retryable error'
      );
      throw providerErrorFailure;
    }

    // Guard against empty responses (treat as retryable error)
    // Handle both string content and multimodal array content
    const content = Array.isArray(response.content)
      ? response.content
          .map(c => (typeof c === 'object' && 'text' in c ? c.text : ''))
          .join('')
          .trim()
      : typeof response.content === 'string'
        ? response.content.trim()
        : '';

    if (!content) {
      const emptyResponseError = new Error(ERROR_MESSAGES.EMPTY_RESPONSE);
      logger.warn(
        {
          err: emptyResponseError,
          modelName,
          ...this.extractResponseDiagnostics(response),
        },
        'Empty response detected, treating as retryable error'
      );
      throw emptyResponseError;
    }

    // Guard against censored responses (Gemini models sometimes return just "ext")
    // Treat this as a retryable error - it may succeed on retry
    if (content === ERROR_MESSAGES.CENSORED_RESPONSE_TEXT) {
      const censoredResponseError = new Error(ERROR_MESSAGES.CENSORED_RESPONSE);
      // Extract provider from modelName (format: "provider/model-name")
      const provider = modelName.includes('/') ? modelName.split('/')[0] : 'unknown';
      logger.warn(
        {
          err: censoredResponseError,
          modelName,
          provider,
          responseContent: content,
        },
        'LLM censored response detected, treating as retryable error'
      );
      throw censoredResponseError;
    }

    return response;
  }

  /**
   * Log finish_reason and token usage for completion-quality diagnostics,
   * returning the resolved reason so the caller can act on it (the
   * error-finish guard in invokeSingleAttempt keys on the return value).
   *
   * This helps identify:
   * - Models that hit token limits (finish_reason: "length") - may truncate responses
   * - Models that completed naturally (finish_reason: "stop") - the ideal case
   */
  private logFinishReason(response: BaseMessage, modelName: string): string {
    const metadata = (response as { response_metadata?: Record<string, unknown> })
      .response_metadata;

    if (!metadata) {
      logger.debug({ modelName }, 'No response_metadata available for finish_reason');
      return FINISH_REASONS.UNKNOWN;
    }

    const finishReason = resolveFinishReason(metadata);
    const usage = metadata.usage as
      { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined;

    const logContext: Record<string, unknown> = { modelName, finishReason };
    if (usage !== undefined) {
      logContext.promptTokens = usage.prompt_tokens;
      logContext.completionTokens = usage.completion_tokens;
      logContext.totalTokens = usage.total_tokens;
    }

    if (finishReason === FINISH_REASONS.LENGTH) {
      logger.info(
        logContext,
        'WARNING: Model hit token limit (finish_reason: length) - response may be truncated'
      );
    } else if (isNaturalStop(finishReason)) {
      logger.debug(logContext, 'Model completed naturally');
    } else {
      logger.info(logContext, 'Model completion with non-standard finish_reason');
    }
    return finishReason;
  }

  /**
   * Provider-failure detail for an error finish_reason, read from the
   * diagnostic metadata the OpenRouter extractor captured before deleting
   * `__raw_response` (response_metadata.openrouter.providerError). Log-only:
   * the thrown error's message stays stable for classification safety.
   */
  private extractProviderErrorDetail(response: BaseMessage): string | undefined {
    const metadata = (response as { response_metadata?: Record<string, unknown> })
      .response_metadata;
    const openrouter = metadata?.openrouter as
      { providerError?: { message?: string; code?: number | string } } | undefined;
    const providerError = openrouter?.providerError;
    if (providerError === undefined) {
      return undefined;
    }
    const parts: string[] = [];
    if (providerError.code !== undefined) {
      parts.push(`code ${providerError.code}`);
    }
    if (providerError.message !== undefined) {
      parts.push(providerError.message);
    }
    return parts.length > 0 ? parts.join(': ') : undefined;
  }

  /**
   * Extract diagnostic metadata from a response for enriched error logging.
   * Pulls finish_reason, token usage, refusal, and key inventories from
   * LangChain's response_metadata and additional_kwargs.
   */
  private extractResponseDiagnostics(response: BaseMessage): Record<string, unknown> {
    const metadata = (response as { response_metadata?: Record<string, unknown> })
      .response_metadata;
    const additionalKwargs = (response as { additional_kwargs?: Record<string, unknown> })
      .additional_kwargs;
    const finishReason = resolveFinishReason(metadata);
    const usage = metadata?.usage as
      { prompt_tokens?: number; completion_tokens?: number } | undefined;

    return {
      responseType: Array.isArray(response.content) ? 'array' : typeof response.content,
      contentLength: Array.isArray(response.content) ? response.content.length : 0,
      finishReason,
      promptTokens: usage?.prompt_tokens,
      completionTokens: usage?.completion_tokens,
      refusal:
        (response as unknown as Record<string, unknown>).refusal ??
        additionalKwargs?.refusal ??
        null,
      responseMetadataKeys: metadata !== undefined ? Object.keys(metadata) : [],
      additionalKwargsKeys: additionalKwargs !== undefined ? Object.keys(additionalKwargs) : [],
    };
  }
}
