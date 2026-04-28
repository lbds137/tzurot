/**
 * Provider Router
 *
 * Resolves the effective routing decision for an LLM generation request based
 * on the configured provider in `LlmConfig.provider`, the model name, and the
 * API keys the user has stored.
 *
 * Routing rules (evaluated in order):
 *
 * - **Auto-promotion** (`provider === 'openrouter'` + model is `z-ai/<model>`
 *   in z.ai's coding-plan catalog + user has zai-coding key):
 *   Promote the OpenRouter request to z.ai-direct. Strips the `z-ai/` prefix
 *   so z.ai's API receives the bare model name (`z-ai/glm-5.1` → `glm-5.1`).
 *   Lets a single preset (configured for OpenRouter, the broadly-compatible
 *   default) automatically use the user's z.ai-coding subscription quota when
 *   they have one.
 *
 * - **Passthrough** (any other `provider !== 'zai-coding'`):
 *   Pass through to `ApiKeyResolver.resolveApiKey(provider)` — same behavior
 *   as before this layer existed.
 *
 * - **Direct z.ai** (`provider === 'zai-coding'` AND user has zai-coding key):
 *   Route directly to z.ai's coding endpoint with the configured model name.
 *
 * - **Auto-fallthrough** (`provider === 'zai-coding'` AND user has NO key):
 *   Rewrite the model name to OpenRouter's namespaced form (`glm-4.7` →
 *   `z-ai/glm-4.7`) and resolve via OpenRouter (user key OR system fallback).
 *   The inverse symmetric of auto-promotion — keeps the single-preset UX
 *   working when the preset is configured `provider: 'zai-coding'` instead.
 *
 * The router is the single seam where this decision lives — `AuthStep` calls
 * it for the LLM provider; downstream code (ModelFactory) receives the
 * `effectiveProvider`/`effectiveModel`/`apiKey` triple and routes
 * deterministically without needing to know about the routing logic.
 */

import { createLogger, AIProvider, isZaiCodingPlanModel } from '@tzurot/common-types';
import type { ApiKeyResolver } from './ApiKeyResolver.js';

const ZAI_PREFIX = 'z-ai/';

const logger = createLogger('ProviderRouter');

/**
 * Pre-computed fallback route attached to `ResolvedRoute.fallback` (and
 * propagated as `ResolvedAuth.fallback`) when ProviderRouter auto-promotes a
 * request to z.ai-direct. If the promoted request fails, GenerationStep swaps
 * to this route and retries via OpenRouter.
 *
 * `provider` is typed as `string` rather than `AIProvider` to match the
 * downstream `ResolvedAuth.fallback.provider` shape — the value is always
 * `AIProvider.OpenRouter` at the producer site, but consumers receive it as
 * a free-form string after passing through GenerationContext.
 */
export interface FallbackRoute {
  apiKey: string;
  provider: string;
  model: string;
  isGuestMode: boolean;
}

/**
 * Resolved routing decision for a single LLM generation request.
 */
export interface ResolvedRoute {
  /**
   * The provider whose endpoint will actually receive the request after any
   * fallthrough has been applied. May differ from the configured provider
   * when fallthrough fires (e.g., configured `zai-coding` → effective
   * `openrouter` for users without a z.ai key).
   */
  effectiveProvider: AIProvider;

  /**
   * The model name as it should appear in the API request body. May differ
   * from the configured model when fallthrough fires (e.g., configured
   * `glm-4.7` → effective `z-ai/glm-4.7` when routing to OpenRouter).
   */
  effectiveModel: string;

  /** API key to use for the resolved endpoint. */
  apiKey: string;

  /**
   * Whether the resolution landed on a system fallback key (restricting the
   * request to free models). Always `false` for the z.ai-direct path since
   * z.ai has no system fallback.
   */
  isGuestMode: boolean;

  /**
   * `true` when the configured `zai-coding` provider was redirected to
   * OpenRouter because the user has no z.ai-coding key. Used by callers
   * (telemetry, log fields) to surface the fallthrough rate.
   *
   * Mutually exclusive with `wasAutoPromoted` — exactly one of these may be
   * true for a given route, never both.
   */
  fallthroughTriggered: boolean;

  /**
   * `true` when an OpenRouter `z-ai/<model>` request was auto-promoted to
   * z.ai-direct because the user has a zai-coding key. Used by callers to
   * decide whether to retry-with-fallback on a 404 from z.ai (catalog drift
   * defense in depth) and for telemetry on the auto-promotion rate.
   *
   * Mutually exclusive with `fallthroughTriggered` — exactly one of these
   * may be true for a given route, never both.
   */
  wasAutoPromoted: boolean;

  /**
   * Pre-computed OpenRouter passthrough route, populated when (and only
   * when) `wasAutoPromoted` is true. Contains the apiKey/provider/model
   * triple that GenerationStep should swap to if the promoted z.ai request
   * fails — defense in depth against catalog drift (the whitelist may go
   * stale if z.ai deprecates a model without us noticing).
   *
   * Pre-computing here rather than re-resolving on retry keeps the retry
   * path synchronous + decoupled from ProviderRouter; the cost is one
   * extra `apiKeyResolver.resolveApiKey('openrouter')` call per promoted
   * request, which is cheap (cached after first hit per user).
   */
  fallback?: FallbackRoute;
}

export class ProviderRouter {
  constructor(private readonly apiKeyResolver: ApiKeyResolver) {}

  /**
   * Resolve the effective routing decision for a request.
   *
   * @param configuredProvider - String value from `LlmConfig.provider` (typed
   *   as string because the DB column is permissive; routing only branches on
   *   the known `'zai-coding'` value).
   * @param configuredModel - Model name from `LlmConfig.model` (e.g., `glm-4.7`,
   *   `anthropic/claude-sonnet-4.5`).
   * @param userId - Discord user ID, if known.
   */
  async resolveRoute(
    configuredProvider: string,
    configuredModel: string,
    userId: string | undefined
  ): Promise<ResolvedRoute> {
    // The `as string` cast on enum compares is required by
    // @typescript-eslint/no-unsafe-enum-comparison: configuredProvider is
    // typed as string (DB column carries free-form values that may exceed the
    // AIProvider enum), so a direct enum compare would lint-error.

    // Auto-promotion: an OpenRouter `z-ai/<model>` request, if the user has a
    // zai-coding key AND the bare model is on z.ai's coding-plan catalog,
    // promotes to z.ai-direct (strip the `z-ai/` prefix). The whitelist guards
    // against catalog drift — if z.ai ships a `z-ai/foo` to OpenRouter that
    // isn't on the coding plan, promoting would 404 silently, so we skip it.
    if (configuredProvider === (AIProvider.OpenRouter as string)) {
      const promoted = await this.tryAutoPromoteToZai(configuredModel, userId);
      if (promoted !== null) {
        return promoted;
      }
      // Whitelist miss or no key → fall through to OpenRouter passthrough below.
    }

    // Default path — pass through for any provider that doesn't have a
    // routing rule defined here. Preserves existing behavior for OpenRouter
    // and any future providers that don't need fallthrough.
    if (configuredProvider !== (AIProvider.ZaiCoding as string)) {
      const result = await this.apiKeyResolver.resolveApiKey(
        userId,
        configuredProvider as AIProvider
      );
      return {
        effectiveProvider: configuredProvider as AIProvider,
        effectiveModel: configuredModel,
        apiKey: result.apiKey,
        isGuestMode: result.isGuestMode,
        fallthroughTriggered: false,
        wasAutoPromoted: false,
      };
    }

    // z.ai-coding path: prefer user's key, fall back to OpenRouter on absence.
    const userZaiKey = await this.apiKeyResolver.tryResolveUserKey(userId, AIProvider.ZaiCoding);
    if (userZaiKey !== null) {
      logger.debug(
        { userId, model: configuredModel },
        'Routing direct to z.ai coding plan with user key'
      );
      return {
        effectiveProvider: AIProvider.ZaiCoding,
        effectiveModel: configuredModel,
        apiKey: userZaiKey,
        isGuestMode: false,
        fallthroughTriggered: false,
        wasAutoPromoted: false,
      };
    }

    // Auto-fallthrough: rewrite model name and resolve via OpenRouter.
    // Guard against double-prefix when a preset configures `provider: 'zai-coding'`
    // with an already-namespaced model like `z-ai/glm-4.7` — concatenating would
    // produce `z-ai/z-ai/glm-4.7` and fail silently at the API. If the model is
    // already prefixed, use it verbatim.
    const fallthroughModel = configuredModel.startsWith(ZAI_PREFIX)
      ? configuredModel
      : `${ZAI_PREFIX}${configuredModel}`;
    const fallthroughResult = await this.apiKeyResolver.resolveApiKey(
      userId,
      AIProvider.OpenRouter
    );
    logger.info(
      {
        userId,
        configuredModel,
        fallthroughModel,
        source: fallthroughResult.source,
        isGuestMode: fallthroughResult.isGuestMode,
      },
      'z.ai-coding fallthrough → OpenRouter (no user z.ai key)'
    );
    return {
      effectiveProvider: AIProvider.OpenRouter,
      effectiveModel: fallthroughModel,
      apiKey: fallthroughResult.apiKey,
      isGuestMode: fallthroughResult.isGuestMode,
      fallthroughTriggered: true,
      wasAutoPromoted: false,
    };
  }

  /**
   * Inspect an OpenRouter request and, if it's a `z-ai/<model>` in z.ai's
   * coding-plan catalog AND the user has a zai-coding key, return a promoted
   * route (z.ai-direct, bare model name). Returns `null` when promotion isn't
   * applicable — caller falls back to the OpenRouter passthrough path.
   *
   * Case-normalizes the bare model to lowercase before the whitelist lookup,
   * so user-typed variations (`z-ai/GLM-5.1` vs `z-ai/glm-5.1`) both promote
   * correctly. The promoted `effectiveModel` uses the lowercased form because
   * z.ai's documented model names are lowercase.
   */
  private async tryAutoPromoteToZai(
    configuredModel: string,
    userId: string | undefined
  ): Promise<ResolvedRoute | null> {
    if (!configuredModel.startsWith(ZAI_PREFIX)) {
      return null;
    }
    const bareModel = configuredModel.slice(ZAI_PREFIX.length).toLowerCase();
    if (!isZaiCodingPlanModel(bareModel)) {
      logger.debug(
        { userId, configuredModel, reason: 'whitelist-miss' },
        'Auto-promotion skipped — model not in z.ai coding-plan catalog'
      );
      return null;
    }
    const userZaiKey = await this.apiKeyResolver.tryResolveUserKey(userId, AIProvider.ZaiCoding);
    if (userZaiKey === null) {
      logger.debug(
        { userId, configuredModel, reason: 'no-key' },
        'Auto-promotion skipped — user has no z.ai-coding key'
      );
      return null;
    }
    // Pre-compute the OpenRouter fallback route alongside the promotion.
    // GenerationStep uses this to retry-with-fallback if the z.ai request
    // fails (catalog drift defense). Computed even on the happy path so the
    // retry decision stays synchronous — cheap one-time cost per request.
    //
    // Failure of the fallback resolution must NOT kill the promotion: the
    // z.ai route is independently viable (we already have userZaiKey), so
    // we proceed with promotion sans-fallback rather than throwing. Worst
    // case: a future z.ai 404 surfaces directly to the user (same UX as
    // pre-PR-#928), which is strictly no worse than the previous behavior.
    const promotedRoute: ResolvedRoute = {
      effectiveProvider: AIProvider.ZaiCoding,
      effectiveModel: bareModel,
      apiKey: userZaiKey,
      isGuestMode: false,
      fallthroughTriggered: false,
      wasAutoPromoted: true,
    };
    try {
      const orFallback = await this.apiKeyResolver.resolveApiKey(userId, AIProvider.OpenRouter);
      promotedRoute.fallback = {
        apiKey: orFallback.apiKey,
        provider: AIProvider.OpenRouter,
        model: configuredModel, // original z-ai/-prefixed model name
        isGuestMode: orFallback.isGuestMode,
      };
    } catch (err) {
      logger.warn(
        { userId, configuredModel, err },
        'Failed to pre-compute OpenRouter fallback during z.ai promotion — proceeding without retry-with-fallback safety net'
      );
    }
    logger.info(
      {
        userId,
        configuredModel,
        promotedModel: bareModel,
        fallbackAvailable: promotedRoute.fallback !== undefined,
      },
      'Auto-promoting OpenRouter z-ai/ model to z.ai-direct (user has zai-coding key)'
    );
    return promotedRoute;
  }
}
