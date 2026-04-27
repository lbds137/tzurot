/**
 * Provider Router
 *
 * Resolves the effective routing decision for an LLM generation request based
 * on the configured provider in `LlmConfig.provider` and the API keys the
 * user has stored.
 *
 * Routing rules:
 *
 * - `provider !== 'zai-coding'` (existing default flow):
 *   Pass through to `ApiKeyResolver.resolveApiKey(provider)` — same behavior
 *   as before this layer existed.
 *
 * - `provider === 'zai-coding'` AND user has zai-coding key:
 *   Route directly to z.ai's coding endpoint with the configured model name
 *   (`glm-4.7`, `glm-4.5-flash`, etc.).
 *
 * - `provider === 'zai-coding'` AND user has NO zai-coding key:
 *   **Auto-fallthrough**: rewrite the model name to OpenRouter's namespaced
 *   form (`glm-4.7` → `z-ai/glm-4.7`) and resolve via OpenRouter (user key OR
 *   system fallback). Lets a single preset Just Work for all users — those
 *   with a z.ai-coding subscription pay nothing on OpenRouter; those without
 *   continue to work via the existing OpenRouter routing.
 *
 * The router is the single seam where this decision lives — `AuthStep` calls
 * it for the LLM provider; downstream code (ModelFactory) receives the
 * `effectiveProvider`/`effectiveModel`/`apiKey` triple and routes
 * deterministically without needing to know about the fallthrough.
 */

import { createLogger, AIProvider } from '@tzurot/common-types';
import type { ApiKeyResolver } from './ApiKeyResolver.js';

const logger = createLogger('ProviderRouter');

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
   */
  fallthroughTriggered: boolean;
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
    // Default path — pass through for any provider that doesn't have a
    // routing rule defined here. Preserves existing behavior for OpenRouter
    // and any future providers that don't need fallthrough.
    // The `as string` cast is required by @typescript-eslint/no-unsafe-enum-comparison:
    // configuredProvider is typed as string (DB column carries free-form values
    // that may exceed the AIProvider enum), so a direct enum compare would lint-error.
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
      };
    }

    // Auto-fallthrough: rewrite model name and resolve via OpenRouter.
    // Guard against double-prefix when a preset configures `provider: 'zai-coding'`
    // with an already-namespaced model like `z-ai/glm-4.7` — concatenating would
    // produce `z-ai/z-ai/glm-4.7` and fail silently at the API. If the model is
    // already prefixed, use it verbatim.
    const fallthroughModel = configuredModel.startsWith('z-ai/')
      ? configuredModel
      : `z-ai/${configuredModel}`;
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
    };
  }
}
