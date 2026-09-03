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
import { AI_DEFAULTS, isFreeModel, type AIProvider } from '@tzurot/common-types/constants/ai';
import { ERROR_MESSAGES, ApiErrorCategory } from '@tzurot/common-types/constants/error';
import { TIMEOUTS } from '@tzurot/common-types/constants/timing';
import { type AttachmentMetadata } from '@tzurot/common-types/types/schemas/discord';
import { type AttachmentDescriptionAttribution } from '@tzurot/common-types/types/diagnostic';
import {
  type LoadedPersonality,
  type VisionTierParams,
} from '@tzurot/common-types/types/schemas/personality';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { getSystemSetting } from '@tzurot/common-types/services/SystemSettingsService';
import { getFreeVisionFloor } from '../freeFloors.js';
import { createChatModel } from '../ModelFactory.js';
import { detectVisionProvider } from '../ProviderRouter.js';
import { parseApiError } from '../../utils/apiErrorParser.js';
import { invokeModelGuarded } from '../../utils/invokeModelGuarded.js';
import { checkModelVisionSupport, visionDescriptionCache } from '../../redis.js';
import { exitSingleFlight } from './visionSingleFlight.js';
import { isDataUrl } from '../../utils/attachmentFetch.js';
import { resolveVisionImageUrl } from './visionImageResolver.js';
import { readRoutedModel } from './readRoutedModel.js';
import { getDescriptionPrompt } from '../DescriptionPromptService.js';
import {
  isValidVisionDescription,
  VISION_MIN_DESCRIPTION_LENGTH,
} from './visionDescriptionValidity.js';
import {
  VisionModelError,
  buildFailureFallback,
  runDescribeImageGates,
} from './visionDescribeGates.js';

const logger = createLogger('VisionProcessor');

// Attribution is optional for most callers, so binding a no-op once keeps the
// notify call sites unconditional.
const noopAttribution = (): void => undefined;

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
  /**
   * Fires exactly once with the model that produced (or, on a cache hit,
   * already cached) the returned description — never on a placeholder. Lets
   * the fallback loop surface which vision model actually answered without
   * widening `describeImage`'s return type.
   * `describeImageWithFallback` replaces this field with its own capture and
   * exposes the result on its return value instead, so a handler passed
   * through the chain is never invoked.
   */
  onAttribution?: (attribution: AttachmentDescriptionAttribution) => void;
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
   * Explicitly-set call params of the TIER's vision config (gateway-stamped,
   * looked up by resolved model in describeImage). Absent → system defaults
   * (`AI_DEFAULTS.VISION_TEMPERATURE`).
   */
  visionParams?: VisionTierParams;
  /**
   * Provider for the vision call — deliberately non-optional. Every vision
   * call across every upstream path (DependencyStep, ConversationalRAGService,
   * ConversationInputProcessor, ImageDescriptionJob) reaches invokeVisionModel,
   * and an absent provider would make `createChatModel` fall back to the
   * env-default `AI_PROVIDER`, silently misrouting cross-provider
   * personalities (e.g., main=z.ai-coding, vision=OpenRouter → 401 Missing
   * Authentication). Callers derive it from the resolved vision model:
   * `options.provider ?? detectVisionProvider(usedModel)`.
   */
  provider: AIProvider;
  /**
   * The image to send to the provider — a `data:` URL of worker-fetched bytes,
   * or (on download-fallback) the original remote URL. Kept SEPARATE from
   * `attachment` so cache keys + the negative cache stay on the original URL
   * while the provider receives the bytes. Defaults to `attachment.url`.
   * A Discord-CDN URL proven dead (expired signature, or a 403/404 from our
   * own fetch) never reaches this field at all — `describeImage` short-circuits
   * before invoking the provider in that case; see `resolveVisionImageUrl`.
   */
  imageUrl?: string;
  loggingContext: VisionLoggingContext;
  personalityName: string;
  /** Forwarded from `DescribeImageOptions.onAttribution` — see there. */
  onAttribution?: (attribution: AttachmentDescriptionAttribution) => void;
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
  const { systemPrompt, userApiKey, provider, loggingContext, personalityName, visionParams } =
    options;

  // Explicitly-set vision-config params win; the low factual-captioning
  // temperature stays the default for anything unset (descriptions feed
  // memory + search, where creative sampling harms). maxTokens is defaulted
  // for a different reason — an uncapped captioning request lets the provider
  // reserve the routed model's whole output budget; see VISION_MAX_TOKENS.
  // createChatModel's per-model filtering sanitizes any param the model
  // can't take.
  const { model } = createChatModel({
    modelName,
    apiKey: userApiKey,
    provider,
    ...visionParams,
    temperature: visionParams?.temperature ?? AI_DEFAULTS.VISION_TEMPERATURE,
    maxTokens: visionParams?.maxTokens ?? AI_DEFAULTS.VISION_MAX_TOKENS,
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

  // Hoisted so the catch below can name it too: an empty-content response is
  // the prod failure shape this is here to attribute, and it throws from inside
  // the try after the metadata is already in hand.
  let routedModel: string | undefined;

  try {
    const response = await invokeModelGuarded(model, messages, { timeout: TIMEOUTS.VISION_MODEL });
    routedModel = readRoutedModel(response.response_metadata);
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

    logger.info({ modelName, routedModel, attachmentId: attachment.id }, 'Vision model responded');
    options.onAttribution?.({ model: modelName, routedModel, fromCache: false });

    return content;
  } catch (error) {
    const errorInfo = parseApiError(error);
    logger.error(
      {
        err: error,
        modelName,
        routedModel,
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
      routedModel,
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
 * `selectVisionModel` falls through to the fallbackVisionModel floor) would have
 * its provider detected against the main model name, not the actual model
 * used at request time.
 */
export async function selectVisionModel(
  personality: LoadedPersonality,
  isGuestMode: boolean
): Promise<string> {
  // Priority 1: Use personality's configured vision model if specified.
  // Guest mode free-forces a PAID configured model — the same cost-leak class
  // the fallback tiers already guard: a guest hunting paid-vision personas
  // must not burn the system key on the primary tier either.
  if (
    personality.visionModel !== undefined &&
    personality.visionModel !== null &&
    personality.visionModel.length > 0
  ) {
    if (isGuestMode && !isFreeModel(personality.visionModel)) {
      logger.info(
        { configuredVisionModel: personality.visionModel },
        'Guest mode: free-forcing paid configured vision model'
      );
      return getFreeVisionFloor();
    }
    logger.debug({ visionModel: personality.visionModel }, 'Using configured vision model');
    return personality.visionModel;
  }

  // Priority 2: Use personality's main model if it has native vision support.
  // Same guest free-force as Priority 1 — a vision-capable PAID main model
  // (gpt-4o, gemini-pro, ...) is the more common config than an explicit
  // visionModel override; guarding at this seam needs no caller-by-caller
  // reachability proof and cannot affect non-guests.
  const mainModelHasVision = await hasVisionSupport(personality.model);
  if (mainModelHasVision) {
    if (isGuestMode && !isFreeModel(personality.model)) {
      logger.info(
        { mainModel: personality.model },
        'Guest mode: free-forcing paid vision-capable main model'
      );
      return getFreeVisionFloor();
    }
    logger.debug(
      { model: personality.model, source: 'main-model-vision' },
      'Using main LLM for vision (native vision support detected via cache/pattern)'
    );
    return personality.model;
  }

  // Priority 3: Use fallback vision model
  // Guests (no BYOK key) get the free floor (fallbackVisionModelFree); BYOK users the paid floor
  const fallback = isGuestMode ? getFreeVisionFloor() : getSystemSetting('fallbackVisionModel');
  logger.debug(
    { mainModel: personality.model, fallbackModel: fallback, isGuestMode, source: 'fallback' },
    'Using fallback vision model - main LLM lacks vision support'
  );
  return fallback;
}

/**
 * Handle a `kind: 'dead'` vision-image resolution: log the skip, write the
 * negative cache entry (so a permanently-dead URL doesn't re-storm across
 * providers on every later turn it sits in context — mirrors what the
 * provider-failure catch in `invokeVisionModel` writes on a real failure),
 * then return the same failure contract as the negative-cache-hit branch
 * above it in `describeImage`.
 */
async function handleDeadVisionImage(
  attachment: AttachmentMetadata,
  usedModel: string,
  reason: string,
  loggingContext: VisionLoggingContext,
  throwOnFailure: boolean
): Promise<string> {
  logger.warn(
    {
      jobId: loggingContext.jobId,
      attachmentId: attachment.id,
      model: usedModel,
      reason,
      deadImageSkip: true,
    },
    'Skipping vision call: image URL is unreachable'
  );
  await visionDescriptionCache.storeFailure({
    attachmentId: attachment.id,
    url: attachment.url,
    model: usedModel,
    category: ApiErrorCategory.MEDIA_NOT_FOUND,
  });
  if (throwOnFailure) {
    throw new VisionModelError(ApiErrorCategory.MEDIA_NOT_FOUND, reason);
  }
  return buildFailureFallback(
    ApiErrorCategory.MEDIA_NOT_FOUND,
    loggingContext.apiKeySource,
    attachment.name
  );
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
  const notifyAttribution = options.onAttribution ?? noopAttribution;
  logger.debug(
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

  const cacheKeyOptions = { attachmentId: attachment.id, url: attachment.url, model: usedModel };
  const gate = await runDescribeImageGates({
    cacheKeyOptions,
    attachment,
    apiKeySource: loggingContext.apiKeySource,
    skipCache: options.skipCache === true,
    skipNegativeCache: options.skipNegativeCache === true,
    throwOnFailure: options.throwOnFailure === true,
    notifyAttribution,
  });
  if (gate.kind === 'resolved') {
    return gate.description;
  }
  const flight = gate.flight;

  try {
    // The INSTANCE's prompt, not this personality's. A description is cached
    // model-agnostically (1h TTL) and reused by every personality that later
    // sees the same image, so framing it with the triggering character bakes
    // one character's voice into a shared artifact — and for a sticker, whose
    // key is an immutable snowflake, the same entry is reused indefinitely.
    // Note this is NOT solved by system prompts being a shared table: the
    // loader substitutes {{char}} with the personality's NAME, so one row still
    // resolves differently per character.
    // Undefined → no system message, which is correct rather than degraded:
    // the "objective description for archival purposes" instruction is in the
    // user message and stands alone.
    const systemPrompt = getDescriptionPrompt();

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
    const resolution = await resolveVisionImageUrl(attachment, loggingContext);
    if (resolution.kind === 'dead') {
      return await handleDeadVisionImage(
        attachment,
        usedModel,
        resolution.reason,
        loggingContext,
        options.throwOnFailure === true
      );
    }
    const description = await invokeVisionModelForDescribe(
      attachment,
      usedModel,
      {
        systemPrompt,
        userApiKey,
        provider,
        imageUrl: resolution.imageUrl,
        loggingContext,
        personalityName: personality.name,
        // Per-TIER params: the fallback chain re-enters describeImage with each
        // tier's model forced via options.model, so this lookup naturally gives
        // every tier ITS OWN config's params.
        visionParams: personality.visionConfigParams?.[usedModel],
        onAttribution: options.onAttribution,
      },
      options.throwOnFailure === true
    );

    // Cache the description for future use (Redis L1 only).
    // Uses shared validation to prevent error-like descriptions from polluting the cache.
    if (isValidVisionDescription(description)) {
      await visionDescriptionCache.store(cacheKeyOptions, description);
    }

    return description;
  } finally {
    await exitSingleFlight(flight, cacheKeyOptions);
  }
}
