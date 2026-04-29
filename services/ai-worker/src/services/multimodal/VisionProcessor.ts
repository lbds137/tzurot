/**
 * Vision Processor
 *
 * Processes images to extract text descriptions using vision models.
 * Supports personality's configured vision model, main LLM with vision support,
 * or fallback to default vision model (Qwen3-VL).
 *
 * Vision capability detection uses OpenRouter's cached model data from Redis
 * for accurate, dynamic capability checking rather than hardcoded model lists.
 */

import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import {
  createLogger,
  getConfig,
  AI_DEFAULTS,
  TIMEOUTS,
  MODEL_DEFAULTS,
  ERROR_MESSAGES,
  ApiErrorCategory,
  AIProvider,
  type AttachmentMetadata,
  type LoadedPersonality,
} from '@tzurot/common-types';
import { createChatModel } from '../ModelFactory.js';
import { parseApiError } from '../../utils/apiErrorParser.js';
import { checkModelVisionSupport, visionDescriptionCache } from '../../redis.js';
import { isDataUrl } from '../../utils/attachmentFetch.js';

const logger = createLogger('VisionProcessor');
const config = getConfig();

/**
 * User-friendly labels for the ATTACHMENT-BOUND error categories that actually reach
 * `FAILURE_LABELS` via `buildFailureFallback`. Other categories (auth, quota, rate-limit,
 * server-error, timeout, network, etc.) return the generic "temporarily unavailable"
 * fallback before ever consulting this map, so listing them here would be dead code.
 *
 * **Invariant**: every member of `ATTACHMENT_BOUND_FAILURE_CATEGORIES` MUST have an entry
 * here. The two structures encode the same "this category gets a specific label" decision
 * and must stay in sync — adding a new attachment-bound category to the set without an
 * entry here would surface raw enum strings to users (e.g. `[Image unavailable: new_thing]`).
 * Enforced by an invariant test in `VisionProcessor.test.ts`.
 *
 * Exported for the invariant test only — call sites should use `buildFailureFallback`.
 */
export const FAILURE_LABELS: Partial<Record<ApiErrorCategory, string>> = {
  [ApiErrorCategory.CONTENT_POLICY]: 'content filtered',
  [ApiErrorCategory.MODEL_NOT_FOUND]: 'model unavailable',
  [ApiErrorCategory.MEDIA_NOT_FOUND]: 'image unavailable',
  [ApiErrorCategory.CENSORED]: 'content filtered',
};

/** Minimum length for a vision description to be considered valid for caching */
const VISION_MIN_DESCRIPTION_LENGTH = 10;

/**
 * Patterns that indicate a vision model returned an error message as text content
 * rather than an actual image description. These bypass HTTP error handling and
 * would otherwise be cached as "valid" descriptions, blocking retries permanently.
 */
const ERROR_DESCRIPTION_PATTERNS = [
  'cannot access',
  'unable to access',
  'unable to view',
  'unable to process',
  'not accessible',
  'cannot be accessed',
  'cannot view',
  'cannot process',
  'cannot see the image',
  'cannot see this image',
  'failed to load',
  'error loading',
  'url has expired',
  'url is expired',
  'url is invalid',
  'image is not available',
  'image is unavailable',
  'image url',
  'provided url',
];

/** Check if a description looks like an error message from the vision model */
function isLikelyErrorDescription(description: string): boolean {
  const lower = description.toLowerCase();
  return ERROR_DESCRIPTION_PATTERNS.some(pattern => lower.includes(pattern));
}

/**
 * Validate that a vision description is a genuine image description, not an error message.
 * Used both when storing new descriptions and when reading cached ones.
 */
function isValidVisionDescription(description: string): boolean {
  const trimmed = description.trim();
  return (
    trimmed.length >= VISION_MIN_DESCRIPTION_LENGTH &&
    !trimmed.startsWith('[Image') &&
    !isLikelyErrorDescription(trimmed)
  );
}

/**
 * Diagnostic context for failure logging — answers "whose request was this, on what key,
 * for what attachment" without forcing the caller to grep across multiple log lines.
 *
 * All fields are optional because callers have different subsets of context available
 * at scope: `ImageDescriptionJob` has the full set; pipeline-inline callers
 * (`ConversationalRAGService`, `DependencyStep`) have user/source but not jobId; the
 * referenced-message formatter path has only personality info.
 */
export interface VisionLoggingContext {
  /** Discord user ID of the request invoker */
  userId?: string;
  /** Whether the API key in use is the user's BYOK or the system fallback */
  apiKeySource?: 'user' | 'system';
  /** BullMQ job ID when invoked from `ImageDescriptionJob` */
  jobId?: string;
  /**
   * AI provider routing the request. Typed as `AIProvider` (not `string`) to
   * catch typos at compile time — a `loggingContext.provider = 'openroter'`
   * silently passes a free-form string check but fails the enum check.
   */
  provider?: AIProvider;
}

/**
 * Options for describeImage behavior + logging context.
 * Bundling these reduces param count (was 6 with separate `loggingContext`).
 */
export interface DescribeImageOptions {
  /** Skip negative cache check — set to true when called within a retry loop */
  skipNegativeCache?: boolean;
  /** Skip positive cache check — set to true to force re-processing */
  skipCache?: boolean;
  /** Diagnostic context for failure logging + source-aware fallback strings */
  loggingContext?: VisionLoggingContext;
  /**
   * Explicit provider for the vision call, derived from the vision model name
   * by the caller (typically via `detectVisionProvider` in `ProviderRouter`).
   *
   * **WARNING — all new callers MUST provide this.** Omitting it makes
   * `createChatModel` fall back to the env-default `config.AI_PROVIDER`,
   * which silently misroutes cross-provider personalities (e.g., main=z.ai-coding
   * + vision=OpenRouter) and reproduces the exact 401 bug this resolver exists
   * to prevent. The `?` is retained ONLY for backward compat with legacy tests
   * predating the cross-provider fix; tracked in `backlog/inbox.md` as
   * "Make `visionProvider` required in vision-pipeline option bags."
   */
  provider?: AIProvider;
}

/**
 * Derive the `apiKeySource` discriminator from the auth context available at a vision
 * call site. `userApiKey !== undefined` alone is insufficient — for guest users, the
 * resolved key passed through `auth.apiKey` is the SYSTEM OpenRouter key, not a BYOK.
 * The discriminator must be `'system'` for guests so they don't see "your API key was
 * rejected" wording on AUTH failures (they have no key to fix).
 */
export function deriveApiKeySource(
  isGuestMode: boolean,
  userApiKey: string | undefined
): 'user' | 'system' {
  return !isGuestMode && userApiKey !== undefined ? 'user' : 'system';
}

/**
 * Check if a model has vision support using OpenRouter's cached model data.
 *
 * This queries the Redis cache populated by api-gateway's OpenRouterModelCache,
 * which contains accurate capability information from OpenRouter's /models API.
 *
 * @param modelName - The model ID to check (e.g., "google/gemma-3-27b-it:free")
 * @returns true if the model supports image input
 */
export async function hasVisionSupport(modelName: string): Promise<boolean> {
  return checkModelVisionSupport(modelName);
}

/**
 * Internal options for `invokeVisionModel`.
 */
interface InvokeVisionModelOptions {
  systemPrompt?: string;
  userApiKey?: string;
  /**
   * Explicit provider for the vision call. When provided, overrides the
   * `config.AI_PROVIDER` env-default lookup inside `createChatModel`. Required
   * for cross-provider personalities (e.g., main=z.ai-coding, vision=OpenRouter)
   * where the env-default would route to the wrong provider's API.
   */
  provider?: AIProvider;
  loggingContext: VisionLoggingContext;
  personalityName: string;
}

/**
 * Invoke a vision model with the given attachment and optional system prompt.
 * Uses ModelFactory's createChatModel for consistent API key routing,
 * parameter filtering, and OpenRouter integration.
 */
async function invokeVisionModel(
  attachment: AttachmentMetadata,
  modelName: string,
  options: InvokeVisionModelOptions
): Promise<string> {
  const { systemPrompt, userApiKey, provider, loggingContext, personalityName } = options;
  const { model } = createChatModel({
    modelName,
    apiKey: userApiKey,
    provider,
    temperature: AI_DEFAULTS.VISION_TEMPERATURE,
  });

  const messages = [];

  if (systemPrompt !== undefined && systemPrompt.length > 0) {
    messages.push(new SystemMessage(systemPrompt));
  }

  // The URL flows through LangChain to the upstream LLM provider, which fetches
  // it on their server with their own SSRF defenses. We don't make the network
  // request here — only the provider does. Apply minimal well-formedness so a
  // literally-malformed URL fails fast in our stack instead of theirs; full
  // SSRF defense for URLs WE fetch lives in DownloadAttachmentsStep
  // (LLM-generation pipeline) and is bypassed here precisely because the
  // bytes never enter our process. Data URLs short-circuit unchanged.
  //
  // ImageDescriptionJob path: this function is also reached from the
  // preprocessing job, which receives raw user-controlled URLs from
  // jobChainOrchestrator.createImageDescriptionJob (api-gateway, line ~181)
  // WITHOUT prior DownloadAttachmentsStep validation. We deliberately accept
  // the residual side-channel risk (provider error responses could echo back
  // internal-IP probes if an attacker submitted such a URL) because (a) we
  // do not initiate the fetch — the provider does, on their hardened infra —
  // so there is no SSRF execution surface on our stack; and (b) the only
  // attacker-controlled URL injection vector is via Discord embed/attachment
  // shapes, which limits practical exploitation. Council-reviewed 2026-04-25.
  //
  // Behavior note: `new URL().toString()` is NOT equivalent to
  // `validateAttachmentUrl` minus the allowlist — that helper also stripped
  // DNS absolute-form trailing dots via `hostname.replace(/\.{1,16}$/, '')`.
  // `new URL()` preserves them. In practice neither LLM providers nor Discord
  // CDN ever emit trailing-dot hostnames, so the difference is academic, but
  // it's a real semantic divergence worth noting if either ever changes.
  const imageUrl = isDataUrl(attachment.url) ? attachment.url : new URL(attachment.url).toString();

  // Redact data URLs in logs: after DownloadAttachmentsStep runs, attachment.url
  // is a 1-2 MiB base64 string. Emitting that at info level saturates log
  // aggregators and buries other messages. Remote URLs are log-safe (short,
  // useful forensically).
  const logUrl = isDataUrl(attachment.url) ? '<data-url>' : imageUrl;

  logger.info({ url: logUrl, modelName }, 'Invoking vision model');

  messages.push(
    new HumanMessage({
      content: [
        {
          type: 'image_url',
          image_url: {
            url: imageUrl,
          },
        },
        {
          type: 'text',
          text: 'Provide a detailed, objective description of this image for archival purposes. Focus on visual details without making value judgments. Describe what you see clearly and thoroughly.',
        },
      ],
    })
  );

  try {
    const response = await model.invoke(messages, { timeout: TIMEOUTS.VISION_MODEL });
    const content =
      typeof response.content === 'string' ? response.content : JSON.stringify(response.content);

    // Guard: empty response (matches LLMInvoker pattern)
    if (content.trim().length === 0) {
      throw new Error(ERROR_MESSAGES.EMPTY_RESPONSE);
    }

    // Guard: censored response — Gemini "ext" bug (matches LLMInvoker pattern)
    if (content.trim() === ERROR_MESSAGES.CENSORED_RESPONSE_TEXT) {
      throw new Error(ERROR_MESSAGES.CENSORED_RESPONSE);
    }

    // Warn on suspiciously short descriptions (don't throw — some images may be simple)
    if (content.trim().length < VISION_MIN_DESCRIPTION_LENGTH) {
      logger.warn(
        { modelName, contentLength: content.trim().length, content: content.trim() },
        'Vision model returned suspiciously short description'
      );
    }

    return content;
  } catch (error) {
    const errorInfo = parseApiError(error);
    logger.error(
      {
        err: error,
        modelName,
        errorCategory: errorInfo.category,
        errorType: errorInfo.type,
        statusCode: errorInfo.statusCode,
        shouldRetry: errorInfo.shouldRetry,
        technicalMessage: errorInfo.technicalMessage,
        attachmentId: attachment.id,
        personalityName,
        userId: loggingContext.userId,
        apiKeySource: loggingContext.apiKeySource,
        jobId: loggingContext.jobId,
        provider: loggingContext.provider,
      },
      'Vision model invocation failed'
    );

    // Store failure in negative cache; per-category TTL is selected via
    // `VISION_FAILURE_CACHE_POLICY` (see common-types/constants/error.ts).
    await visionDescriptionCache.storeFailure({
      attachmentId: attachment.id,
      url: attachment.url,
      category: errorInfo.category,
    });

    throw error;
  }
}

/**
 * Categories whose failures are bound to attachment properties (URL, content, model
 * availability) and unlikely to recover for the same attachment. The user-facing
 * fallback for these uses the specific `FAILURE_LABELS` wording; other categories
 * (auth, quota, rate-limit, etc.) get the generic "temporarily unavailable" wording.
 *
 * **Invariant**: every member of this set MUST also have its `l1TtlSeconds` set to
 * `INTERVALS.VISION_FAILURE_TTL_LONG` in `VISION_FAILURE_CACHE_POLICY`. The two
 * structures encode the same "this failure is attachment-bound" decision in different
 * shapes (one drives cache TTL, the other drives the user-facing message) and must
 * stay in sync. Enforced by the invariant test in `VisionProcessor.test.ts` so that
 * adding a category to one but not the other fails CI.
 *
 * Exported for the invariant test only — call sites should use
 * `buildFailureFallback` / `VISION_FAILURE_CACHE_POLICY` rather than reading this set
 * directly.
 */
// eslint-disable-next-line @tzurot/no-singleton-export -- Intentional: immutable lookup set used as a constant. Exported only to enable the cache-policy/fallback-set invariant test in VisionProcessor.test.ts.
export const ATTACHMENT_BOUND_FAILURE_CATEGORIES: ReadonlySet<ApiErrorCategory> = new Set([
  ApiErrorCategory.CONTENT_POLICY,
  ApiErrorCategory.MEDIA_NOT_FOUND,
  ApiErrorCategory.MODEL_NOT_FOUND,
  // CENSORED is also image-bound in practice — the model refuses based on what's
  // depicted, not on transient state. Mirrors the LONG cooldown classification in
  // VISION_FAILURE_CACHE_POLICY.
  ApiErrorCategory.CENSORED,
]);

/**
 * Build a user-facing fallback string for a cached vision failure.
 *
 * AUTH gets a source-aware variant: a system-key failure shouldn't blame the user
 * for "API key issue" wording (they'd think their Discord account is broken),
 * while a user-key failure points them at `/wallet` to fix the underlying key.
 * Other categories use either `FAILURE_LABELS` (attachment-bound) or the generic
 * "temporarily unavailable" message.
 */
function buildFailureFallback(
  category: ApiErrorCategory,
  apiKeySource: 'user' | 'system' | undefined
): string {
  if (category === ApiErrorCategory.AUTHENTICATION) {
    if (apiKeySource === 'user') {
      return '[Image unavailable: your API key was rejected — check /wallet]';
    }
    // Unknown source defaults to the system-side wording (same as `apiKeySource === 'system'`):
    // a user can't act on "API key issue" if they don't know whose key. Defaulting to the
    // service-unavailable phrasing is the conservative choice — it doesn't blame the user
    // when we can't be sure whose key failed, and the user has nothing to do anyway because
    // any actionable wallet-level remediation only applies when source is definitely 'user'.
    return '[Image unavailable: vision service temporarily unavailable, please retry shortly]';
  }
  if (ATTACHMENT_BOUND_FAILURE_CATEGORIES.has(category)) {
    // `?? category` is a defensive safety net: every member of
    // ATTACHMENT_BOUND_FAILURE_CATEGORIES has an entry in FAILURE_LABELS, so the
    // fallback shouldn't be reachable. Kept in case the two collections drift apart.
    const label = FAILURE_LABELS[category] ?? category;
    return `[Image unavailable: ${label}]`;
  }
  return '[Image temporarily unavailable]';
}

/**
 * Check negative cache for a previous failure.
 * Returns a fallback string if a failure is cached, or null to proceed with the API call.
 */
async function checkNegativeCache(
  cacheKeyOptions: { attachmentId?: string; url: string },
  attachmentId: string | undefined,
  apiKeySource: 'user' | 'system' | undefined
): Promise<string | null> {
  const failureEntry = await visionDescriptionCache.getFailure(cacheKeyOptions);
  if (failureEntry === null) {
    return null;
  }
  logger.info(
    {
      attachmentId,
      category: failureEntry.category,
      cachedAt: failureEntry.cachedAt,
      apiKeySource,
    },
    'Skipping vision API call - failure cooldown active'
  );
  return buildFailureFallback(failureEntry.category, apiKeySource);
}

/**
 * Select the vision model to use based on personality config and model capabilities.
 * Priority: personality.visionModel > main model with vision > fallback model.
 *
 * Exported so callers (e.g., `DependencyStep`) can pre-compute the effective
 * vision model name and pass it to `resolveVisionAuth.effectiveVisionModel` —
 * keeps provider detection and model selection consistent. Without that
 * pre-computation, a personality whose main model lacks native vision (so
 * `selectVisionModel` falls through to `VISION_FALLBACK_MODEL`) would have
 * its provider detected against the main model name, not the actual model
 * used at request time.
 */
export async function selectVisionModel(
  personality: LoadedPersonality,
  isGuestMode: boolean
): Promise<string> {
  // Priority 1: Use personality's configured vision model if specified
  if (
    personality.visionModel !== undefined &&
    personality.visionModel !== null &&
    personality.visionModel.length > 0
  ) {
    logger.info(
      { visionModel: personality.visionModel },
      'Using configured vision model (personality override)'
    );
    return personality.visionModel;
  }

  // Priority 2: Use personality's main model if it has native vision support
  const mainModelHasVision = await hasVisionSupport(personality.model);
  if (mainModelHasVision) {
    logger.info(
      { model: personality.model, source: 'main-model-vision' },
      'Using main LLM for vision (native vision support detected via cache/pattern)'
    );
    return personality.model;
  }

  // Priority 3: Use fallback vision model
  // Guest users (no BYOK API key) use VISION_FALLBACK_FREE, BYOK users use VISION_FALLBACK (paid)
  const fallback = isGuestMode ? MODEL_DEFAULTS.VISION_FALLBACK_FREE : config.VISION_FALLBACK_MODEL;
  logger.info(
    { mainModel: personality.model, fallbackModel: fallback, isGuestMode, source: 'fallback' },
    'Using fallback vision model - main LLM lacks vision support'
  );
  return fallback;
}

/**
 * Describe an image using vision model
 * Uses personality's model if it has vision, otherwise uses uncensored fallback
 * Throws errors to allow retry logic to handle them
 *
 * @param attachment - Image attachment to describe
 * @param personality - Personality configuration for vision model selection
 * @param isGuestMode - Whether the user is in guest mode (no BYOK API key)
 *                      Guest users use free vision models, BYOK users use paid models
 * @param userApiKey - Optional user's BYOK API key (for BYOK users, this should be passed
 *                     so their API key is used instead of the bot's primary key)
 * @param options - Cache-skip flags + `loggingContext` for diagnostic enrichment and
 *                  source-aware fallback strings (only `apiKeySource` is consumed for
 *                  fallback variants — other context fields are log-only)
 */
export async function describeImage(
  attachment: AttachmentMetadata,
  personality: LoadedPersonality,
  isGuestMode = false,
  userApiKey?: string,
  options: DescribeImageOptions = {}
): Promise<string> {
  const loggingContext: VisionLoggingContext = options.loggingContext ?? {};
  logger.info(
    {
      personalityName: personality.name,
      mainModel: personality.model,
      visionModel: personality.visionModel,
      visionModelType: typeof personality.visionModel,
    },
    'describeImage called - checking vision model configuration'
  );

  // Check cache first to avoid duplicate vision API calls
  const cacheKeyOptions = { attachmentId: attachment.id, url: attachment.url };
  if (options?.skipCache !== true) {
    const cachedDescription = await visionDescriptionCache.get(cacheKeyOptions);
    if (cachedDescription !== null) {
      // Validate cached description quality — some models cache error text
      // (e.g., "I cannot access the image URL") that looks valid but isn't useful.
      // Re-processing gives the vision model a chance to succeed with a fresh attempt.
      if (isValidVisionDescription(cachedDescription)) {
        logger.info(
          { attachmentName: attachment.name, attachmentId: attachment.id },
          'Using cached vision description - avoiding duplicate API call'
        );
        return cachedDescription;
      }
      logger.warn(
        {
          attachmentId: attachment.id,
          cachedLength: cachedDescription.length,
          preview: cachedDescription.substring(0, 80),
        },
        'Cached vision description appears invalid — re-processing image'
      );
    }
  }

  // Check negative cache to avoid re-hammering failed images
  // Skip when called within a retry loop — the negative cache would defeat retries
  if (options?.skipNegativeCache !== true) {
    const failureFallback = await checkNegativeCache(
      cacheKeyOptions,
      attachment.id,
      loggingContext.apiKeySource
    );
    if (failureFallback !== null) {
      return failureFallback;
    }
  }

  const systemPrompt =
    personality.systemPrompt !== undefined && personality.systemPrompt.length > 0
      ? personality.systemPrompt
      : undefined;

  const usedModel = await selectVisionModel(personality, isGuestMode);
  const description = await invokeVisionModel(attachment, usedModel, {
    systemPrompt,
    userApiKey,
    provider: options.provider,
    loggingContext,
    personalityName: personality.name,
  });

  // Cache the description for future use (Redis L1 only).
  // Uses shared validation to prevent error-like descriptions from polluting the cache.
  if (isValidVisionDescription(description)) {
    await visionDescriptionCache.store(
      { attachmentId: attachment.id, url: attachment.url },
      description
    );
  }

  return description;
}
