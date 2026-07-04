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
import { getConfig } from '@tzurot/common-types/config/config';
import { AI_DEFAULTS, MODEL_DEFAULTS, type AIProvider } from '@tzurot/common-types/constants/ai';
import { ERROR_MESSAGES, ApiErrorCategory } from '@tzurot/common-types/constants/error';
import { TIMEOUTS } from '@tzurot/common-types/constants/timing';
import { type AttachmentMetadata } from '@tzurot/common-types/types/schemas/discord';
import { type LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { createChatModel } from '../ModelFactory.js';
import { detectVisionProvider } from '../ProviderRouter.js';
import { parseApiError } from '../../utils/apiErrorParser.js';
import { checkModelVisionSupport, visionDescriptionCache } from '../../redis.js';
import { isDataUrl } from '../../utils/attachmentFetch.js';
import { downloadImageToDataUrl } from '../../utils/imageToDataUrl.js';
import {
  isValidVisionDescription,
  VISION_MIN_DESCRIPTION_LENGTH,
} from './visionDescriptionValidity.js';

const logger = createLogger('VisionProcessor');
const config = getConfig();

/**
 * Typed vision-invocation failure. Carries the `ApiErrorCategory` so the fallback loop
 * (`describeImageWithFallback`) can decide terminate-vs-advance without re-parsing the
 * error. `describeImage` throws this on ANY single-model failure — a fresh API error OR
 * a negative-cache hit — and the loop is the only thing that turns it into a user-facing
 * `[Image unavailable: …]` placeholder (on a terminate category, or once all tiers exhaust).
 */
export class VisionModelError extends Error {
  constructor(
    readonly category: ApiErrorCategory,
    message: string,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = 'VisionModelError';
  }
}

/**
 * Vision failure categories where the IMAGE ITSELF is the problem (a provider examined
 * it and refused, or it's unreadable) — retrying with a different model won't help, so
 * the fallback loop terminates immediately rather than burning tiers/latency/quota.
 *
 * Deliberately a STRICT SUBSET of `LONG_TTL_FAILURE_CATEGORIES`: it excludes
 * `MODEL_NOT_FOUND`, which is attachment-bound for negative-cache-TTL purposes (a missing
 * model won't reappear for THIS attachment on a retry of the SAME model) but is exactly
 * what the fallback loop routes around — a different tier is a different model. The subset
 * invariant (and that `MODEL_NOT_FOUND` is the sole difference) is pinned by a test.
 */
// eslint-disable-next-line @tzurot/no-singleton-export -- Intentional: immutable lookup set used as a constant (mirrors LONG_TTL_FAILURE_CATEGORIES). Exported for the fallback loop + the terminate-set/attachment-bound-set invariant test in VisionProcessor.test.ts.
export const VISION_TERMINATE_CATEGORIES: ReadonlySet<ApiErrorCategory> = new Set([
  ApiErrorCategory.CONTENT_POLICY,
  ApiErrorCategory.CENSORED,
  ApiErrorCategory.MEDIA_NOT_FOUND,
]);

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
  /**
   * Skip the negative-cache check for TRANSIENT failures — set when called within a retry
   * loop / on the reference path, so a just-cached transient failure can't defeat the
   * retry. ATTACHMENT-BOUND failures (dead URL, removed model, content-policy, censored)
   * are STILL honored even when this is true, so a permanently-dead image is suppressed
   * instead of re-storming across providers every turn it sits in context.
   */
  skipNegativeCache?: boolean;
  /** Skip positive cache check — set to true to force re-processing */
  skipCache?: boolean;
  /** Diagnostic context for failure logging + source-aware fallback strings */
  loggingContext?: VisionLoggingContext;
  /**
   * Explicit provider for the vision call. When omitted, `describeImage` derives
   * it from the RESOLVED vision model via `detectVisionProvider`, so an omitted
   * provider no longer misroutes — the derivation is the safety net that keeps
   * cross-provider personalities (e.g. main=z.ai-coding + vision=OpenRouter) on
   * the right route instead of the env-default `config.AI_PROVIDER`. Still prefer
   * passing it when the caller already knows the provider (e.g. a registry/
   * resolver that also drives BYOK key routing); an explicit value wins over the
   * derivation.
   */
  provider?: AIProvider;
  /**
   * Pre-resolved vision model name. When provided, `describeImage` uses it
   * directly and SKIPS the internal `selectVisionModel` call. This lets the
   * unified `resolveVisionConfig` decision flow through — critically, when an
   * authenticated user is downgraded to the free vision model, that forced
   * model must reach `createChatModel` rather than being re-selected (which
   * would pick the PAID fallback for `isGuestMode === false` and bill the
   * system key for it). Optional for backward compat; omitting it preserves the
   * legacy self-selection behavior.
   */
  model?: string;
  /**
   * When true, a failure (fresh API error OR negative-cache hit) THROWS a typed
   * `VisionModelError` instead of returning a `[Image unavailable: …]` placeholder string.
   * The fallback loop sets this so it can catch the category and decide
   * terminate-vs-advance; every legacy caller omits it and keeps the string-returning
   * behavior. (A fresh invocation error already propagates as `VisionModelError` in both
   * modes — this flag only governs the negative-cache-hit path's throw-vs-return.)
   */
  throwOnFailure?: boolean;
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
 * @param modelName - The model ID to check (e.g., "google/gemma-4-31b-it:free")
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
  /**
   * The image to send to the provider — a `data:` URL of worker-fetched bytes,
   * or (on download-fallback) the original remote URL. Kept SEPARATE from
   * `attachment` so cache keys + the negative cache stay on the original URL
   * while the provider receives the bytes. Defaults to `attachment.url`.
   */
  imageUrl?: string;
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

  // Single-chokepoint silent-fallback signal: every vision call across every
  // upstream path (DependencyStep, ConversationalRAGService, ConversationInput-
  // Processor, ImageDescriptionJob) eventually reaches here. A warn here
  // captures any caller that didn't thread `visionProvider` through, which
  // means `createChatModel` will fall back to the env-default `AI_PROVIDER`.
  // For cross-provider personalities (main=z.ai, vision=OpenRouter) that
  // silently misroutes the request and reproduces the exact 401 the upstream
  // resolver fix exists to prevent. Will be promoted to a hard error once
  // a few weeks of clean Railway logs confirm no upstream caller fires this.
  if (provider === undefined) {
    logger.warn(
      {
        personalityName,
        modelName,
        apiKeySource: loggingContext.apiKeySource,
      },
      'invokeVisionModel called without explicit provider — misrouting risk for cross-provider personalities'
    );
  }

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
  // shapes, which limits practical exploitation. Council-reviewed.
  //
  // Behavior note: `new URL().toString()` is NOT equivalent to
  // `validateAttachmentUrl` minus the allowlist — that helper also stripped
  // DNS absolute-form trailing dots via `hostname.replace(/\.{1,16}$/, '')`.
  // `new URL()` preserves them. In practice neither LLM providers nor Discord
  // CDN ever emit trailing-dot hostnames, so the difference is academic, but
  // it's a real semantic divergence worth noting if either ever changes.
  // The provider receives the resolved image (a data: URL of worker-fetched
  // bytes, or the original remote URL on download-fallback). Everything else in
  // this function — the negative cache below, attachmentId, logging — stays on
  // the ORIGINAL attachment so cache keys never become the (huge, unstable)
  // data: URL. describeImage's resolveVisionImageUrl now owns the fetch (with
  // SSRF guards), so for that path the bytes DO pass through our process first.
  const sourceUrl = options.imageUrl ?? attachment.url;
  const imageUrl = isDataUrl(sourceUrl) ? sourceUrl : new URL(sourceUrl).toString();

  // Redact data URLs in logs: a materialized image is a 1-2 MiB base64 string.
  // Emitting that at info level saturates log aggregators and buries other
  // messages. Remote URLs are log-safe (short, useful forensically).
  const logUrl = isDataUrl(sourceUrl) ? '<data-url>' : imageUrl;

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
      model: modelName,
      category: errorInfo.category,
    });

    // Re-throw as a typed error so the fallback loop can decide terminate-vs-advance
    // on the category without re-parsing. `cause` preserves the original for logging.
    throw new VisionModelError(errorInfo.category, errorInfo.technicalMessage ?? String(error), {
      cause: error,
    });
  }
}

/**
 * Invoke the vision model, adapting its typed throw to the caller's error contract.
 * The fallback loop (`throwOnFailure`) wants the typed `VisionModelError` so it can decide
 * terminate-vs-advance on the category. Legacy callers instead re-parse the thrown error via
 * `shouldRetryError` / `parseApiError`, so they get the RAW error back (`cause`, which is
 * `unknown`-typed but an Error in every practical case) — keeping their retry + category
 * behavior identical to the raw throw. The one non-identical edge: if the upstream client
 * ever threw a NON-Error value, the legacy caller sees the (always-Error) `VisionModelError`
 * wrapper rather than the raw thrown value — practically unreachable (provider/LangChain
 * clients throw Errors), and strictly safer for the re-parse path.
 */
async function invokeVisionModelForDescribe(
  attachment: AttachmentMetadata,
  modelName: string,
  options: InvokeVisionModelOptions,
  throwOnFailure: boolean
): Promise<string> {
  try {
    return await invokeVisionModel(attachment, modelName, options);
  } catch (error) {
    if (error instanceof VisionModelError && !throwOnFailure) {
      throw error.cause instanceof Error ? error.cause : error;
    }
    throw error;
  }
}

/**
 * Categories whose failures are bound to attachment properties (URL, content, model
 * availability) and unlikely to recover for the same attachment. The prompt-facing
 * placeholder for these uses the permanent "can't see its contents" wording; other
 * categories (auth, quota, rate-limit, etc.) get the transient "may succeed later" wording.
 *
 * **Invariant**: every member of this set MUST also have its `l1TtlSeconds` set to
 * `INTERVALS.VISION_FAILURE_TTL_LONG` in `VISION_FAILURE_CACHE_POLICY`. The two
 * structures encode the same "this failure is attachment-bound" decision in different
 * shapes (one drives cache TTL, the other drives the user-facing message) and must
 * stay in sync. Enforced by the invariant test in `VisionProcessor.test.ts` so that
 * adding a category to one but not the other fails CI.
 *
 * Exported for the invariant test only — EXTERNAL call sites should use
 * `buildFailureFallback` / `VISION_FAILURE_CACHE_POLICY` rather than reading this set
 * directly. (The in-module `checkNegativeCache` reads it as a membership predicate to
 * decide which cached failures the retry-loop / reference path honors.)
 */
// eslint-disable-next-line @tzurot/no-singleton-export -- Intentional: immutable lookup set used as a constant. Exported only to enable the cache-policy/fallback-set invariant test in VisionProcessor.test.ts.
export const LONG_TTL_FAILURE_CATEGORIES: ReadonlySet<ApiErrorCategory> = new Set([
  // The axis here is CACHE LIFETIME (mirror of VISION_FAILURE_CACHE_POLICY's
  // LONG cooldowns), NOT "the image itself is doomed" — MODEL_NOT_FOUND is
  // long-cacheable per (model, attachment) yet retryable across models, which
  // is exactly why VISION_TERMINATE_CATEGORIES excludes it (invariant-tested).
  ApiErrorCategory.CONTENT_POLICY,
  ApiErrorCategory.MEDIA_NOT_FOUND,
  ApiErrorCategory.MODEL_NOT_FOUND,
  // CENSORED is also image-bound in practice — the model refuses based on what's
  // depicted, not on transient state. Mirrors the LONG cooldown classification in
  // VISION_FAILURE_CACHE_POLICY.
  ApiErrorCategory.CENSORED,
]);

/**
 * Build the placeholder injected into the prompt when an image couldn't be described.
 *
 * Written for the LLM reading the prompt, not as a status code: the previous
 * `[Image unavailable: <reason-label>]` shape read like UI jargon and personas
 * narrated it verbatim ("the image description is still showing as unavailable").
 * The placeholder keeps the failure SIGNAL (the model should know an image was
 * there) and the filename (often has semantic content worth acknowledging), and
 * tells the model how to behave instead of reporting an internal state.
 *
 * Two load-bearing constraints on the wording:
 * - It MUST start with `[Image` — `isValidVisionDescription` uses that prefix to
 *   keep failure placeholders out of the positive description cache.
 * - It must NOT contain any `ERROR_DESCRIPTION_PATTERNS` substring (e.g. "cannot
 *   process") — those mark error-shaped text, and matching one would make cached
 *   reads treat every placeholder as a poisoned entry.
 *
 * AUTH keeps a source-aware variant: a user-key failure points at
 * `/settings apikey set`; a system-key (or unknown-source) failure uses the
 * non-blaming transient wording — the user can't act on a key they don't own.
 */
export function buildFailureFallback(
  category: ApiErrorCategory,
  apiKeySource: 'user' | 'system' | undefined,
  filename?: string
): string {
  const subject = filename !== undefined && filename.length > 0 ? `[Image "${filename}"` : '[Image';
  if (category === ApiErrorCategory.AUTHENTICATION) {
    if (apiKeySource === 'user') {
      return `${subject} was shared but couldn't be processed — the vision API key was rejected; it can be fixed with /settings apikey set]`;
    }
    return `${subject} was shared but couldn't be processed right now — the vision service had a temporary problem; it may work again shortly]`;
  }
  if (LONG_TTL_FAILURE_CATEGORIES.has(category)) {
    return `${subject} was shared but couldn't be processed — you can acknowledge it if relevant, but can't see its contents]`;
  }
  return `${subject} was shared but couldn't be processed right now — it may succeed later; you can acknowledge it, but can't see its contents]`;
}

/**
 * Check negative cache for a previous failure.
 * Returns a fallback string if a failure is cached, or null to proceed with the API call.
 *
 * `longTtlOnly` (the retry-loop / reference path) honors ONLY failures bound to
 * the attachment itself (dead URL, removed model, content-policy, censored) — those can't
 * recover for this attachment, so re-attempting every turn the image sits in context just
 * re-storms across providers (observed adding ~100s of latency per turn). Transient
 * failures (rate-limit, quota, server) are NOT honored in this mode: they may have
 * cleared, and short-circuiting them would defeat the retry that exists to catch recovery.
 */
async function checkNegativeCache(
  cacheKeyOptions: { attachmentId?: string; url: string; model?: string },
  attachmentId: string | undefined,
  apiKeySource: 'user' | 'system' | undefined,
  options: { longTtlOnly?: boolean } = {}
): Promise<ApiErrorCategory | null> {
  const failureEntry = await visionDescriptionCache.getFailure(cacheKeyOptions);
  if (failureEntry === null) {
    return null;
  }
  if (options.longTtlOnly === true && !LONG_TTL_FAILURE_CATEGORIES.has(failureEntry.category)) {
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
  // Return the CATEGORY (not the rendered string) so `describeImage` can throw a typed
  // VisionModelError and the fallback loop can decide terminate-vs-advance. The user-facing
  // `[Image unavailable: …]` render happens once, in the loop, via `buildFailureFallback`.
  return failureEntry.category;
}

/**
 * Select the vision model to use based on personality config and model capabilities.
 * Priority: personality.visionModel > main model with vision > fallback model.
 *
 * NOTE (vision-config epic): `personality.visionModel` (priority 1) is no longer the
 * old per-preset LlmConfig column — it's the carrier the gateway stamps from the
 * VisionConfigResolver cascade (user → personality → global vision default). So on the
 * main job-chain path priority 1 reflects the resolved vision config; priorities 2/3
 * remain the fallback for paths that don't stamp (e.g. direct ImageDescriptionJob).
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
    logger.info({ visionModel: personality.visionModel }, 'Using configured vision model');
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
 * Resolve the image URL the vision provider should receive: a `data:` URL of
 * worker-fetched bytes for remote images, so the provider never has to fetch a
 * URL it might be unable to reach. OpenRouter can't fetch Discord's external-
 * image proxy (`images-ext-1.discordapp.net`, 403s on its datacenter egress),
 * and signed Discord-CDN URLs expire — but our own SSRF-guarded fetcher pulls
 * both. Already-inlined images (a `data:` URL, e.g. from DownloadAttachmentsStep)
 * are returned untouched.
 *
 * On download failure, falls back to the ORIGINAL remote URL so the provider can
 * try hosts our egress can't reach — logged so the fallback rate is observable.
 * Returns only the URL; the caller keeps the original `attachment` for cache keys.
 */
async function resolveVisionImageUrl(
  attachment: AttachmentMetadata,
  loggingContext: VisionLoggingContext
): Promise<string> {
  if (isDataUrl(attachment.url)) {
    return attachment.url;
  }
  try {
    const { dataUrl } = await downloadImageToDataUrl(attachment.url, {
      contentType: attachment.contentType,
      name: attachment.name,
      jobId: loggingContext.jobId,
    });
    return dataUrl;
  } catch (error) {
    // Broad by design: ANY download failure — including AttachmentTooLargeError —
    // degrades to handing the provider the original URL. Unlike
    // DownloadAttachmentsStep, where an over-size image is a hard fail, the vision
    // provider may accept larger images than our own fetch cap, so we let it try
    // rather than rethrow. Do NOT add an `instanceof AttachmentTooLargeError`
    // rethrow here thinking it closes a gap; the fallback rate is observable via
    // the imageFetchFallback log field below.
    logger.warn(
      {
        jobId: loggingContext.jobId,
        attachmentId: attachment.id,
        name: attachment.name,
        err: error,
        imageFetchFallback: true,
      },
      'Vision image download failed; falling back to provider URL fetch'
    );
    return attachment.url;
  }
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

  // Resolve the vision model FIRST — the success cache is model-agnostic (canonical),
  // but the NEGATIVE cache is per-model ("has this model failed on this image?") and
  // the canonical store needs the model's tier, so it's needed before any cache write.
  // Honor a caller-supplied model (from the gateway's VisionConfigResolver stamping /
  // resolveVisionConfig) over internal selection — the resolver may have forced a
  // free-tier downgrade selectVisionModel wouldn't reproduce.
  const usedModel =
    options.model !== undefined && options.model.length > 0
      ? options.model
      : await selectVisionModel(personality, isGuestMode);

  // Check the canonical cache first — model-agnostic, so a description ANY model
  // produced (e.g. a paid model on an earlier turn) is reused here, including by
  // free-tier requests that could never produce one themselves.
  const cacheKeyOptions = { attachmentId: attachment.id, url: attachment.url, model: usedModel };
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

  // Check the negative cache to avoid re-hammering failed images. On the retry-loop /
  // reference path (`skipNegativeCache`) we still honor ATTACHMENT-BOUND failures (a dead
  // URL / removed model won't recover for this attachment, so re-attempting every turn it
  // sits in context just re-storms across providers) but skip transient ones so the retry
  // can still catch recovery.
  const cachedCategory = await checkNegativeCache(
    cacheKeyOptions,
    attachment.id,
    loggingContext.apiKeySource,
    { longTtlOnly: options?.skipNegativeCache === true }
  );
  if (cachedCategory !== null) {
    // A cached failure for this (model, attachment). The fallback loop
    // (throwOnFailure) wants the typed error so it can advance tiers / render the terminal
    // placeholder; legacy single-model callers get the rendered placeholder string as before.
    if (options?.throwOnFailure === true) {
      throw new VisionModelError(cachedCategory, 'vision negative-cache hit');
    }
    return buildFailureFallback(cachedCategory, loggingContext.apiKeySource, attachment.name);
  }

  const systemPrompt =
    personality.systemPrompt !== undefined && personality.systemPrompt.length > 0
      ? personality.systemPrompt
      : undefined;

  // Derive the provider from the RESOLVED vision model when the caller didn't
  // supply one. An undefined provider makes createChatModel fall back to the
  // env-default AI_PROVIDER, which misroutes cross-provider personalities (e.g.
  // an OpenRouter vision model paired with a z.ai-coding main model) → wrong
  // route → 401 Missing Authentication. detectVisionProvider maps the actual
  // model name to its route, so key resolution and routing stay aligned.
  const provider = options.provider ?? detectVisionProvider(usedModel);
  // Resolve the image to inline bytes so the vision PROVIDER never has to fetch
  // a URL it may be unable to reach (Discord's external-image proxy 403s
  // OpenRouter; signed Discord-CDN URLs expire). We pass the ORIGINAL attachment
  // (for cache keys) plus the resolved imageUrl separately.
  const imageUrl = await resolveVisionImageUrl(attachment, loggingContext);
  const description = await invokeVisionModelForDescribe(
    attachment,
    usedModel,
    {
      systemPrompt,
      userApiKey,
      provider,
      imageUrl,
      loggingContext,
      personalityName: personality.name,
    },
    options.throwOnFailure === true
  );

  // Cache the description for future use (Redis L1 only).
  // Uses shared validation to prevent error-like descriptions from polluting the cache.
  if (isValidVisionDescription(description)) {
    await visionDescriptionCache.store(cacheKeyOptions, description);
  }

  return description;
}
