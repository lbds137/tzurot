/**
 * Auto-promotion fallback retry orchestrator.
 *
 * Wraps a generate-attempt callback with a one-shot fallback retry for
 * auto-promoted z.ai requests. When ProviderRouter promotes an OpenRouter
 * `z-ai/<model>` request to z.ai-direct, AuthStep attaches a pre-computed
 * OpenRouter passthrough route (`auth.fallback`) ready to swap on failure —
 * defense in depth against the whitelist going stale (e.g., z.ai deprecates
 * a model without us noticing).
 *
 * Extracted from GenerationStep to keep that file under the 400-line cap.
 * Pure orchestration; doesn't know about RAG, only about the swap shape.
 */

import { AIProvider } from '@tzurot/common-types/constants/ai';
import { type ResolvedConfigOverrides } from '@tzurot/common-types/schemas/api/configOverrides';
import { type MessageContent } from '@tzurot/common-types/types/ai';
import { type SttDispatch } from '@tzurot/common-types/types/sttProvider';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { ConversationalRAGService } from '../../../../services/ConversationalRAGService.js';
import type {
  RAGResponse,
  ConversationContext,
} from '../../../../services/ConversationalRAGTypes.js';
import type { DiagnosticCollector } from '../../../../services/DiagnosticCollector.js';
import type { GenerationContext } from '../types.js';
import { RetryError } from '../../../../utils/retry.js';
import {
  classifyBillingQuotaFailure,
  logQuotaFallbackAudit,
  type QuotaFallbackInfo,
} from '../../../../services/quotaFallback.js';
import { deriveCacheKeyId } from '../../../../services/RateLimitCache.js';

const logger = createLogger('AutoPromotionFallback');

/**
 * Shape of a single generation attempt — matches the option object
 * `GenerationStep.generateWithDuplicateRetry` accepts. Kept locally rather
 * than imported because it's an internal contract between these two files.
 */
export interface GenerateAttemptOpts {
  personality: Parameters<ConversationalRAGService['generateResponse']>[0];
  message: MessageContent;
  conversationContext: ConversationContext;
  recentAssistantMessages: string[];
  apiKey: string | undefined;
  sttDispatch: SttDispatch | undefined;
  isGuestMode: boolean;
  jobId: string | undefined;
  diagnosticCollector?: DiagnosticCollector;
  configOverrides?: ResolvedConfigOverrides;
  /** Provider the attempt routes to — drives the context-window cap source. */
  effectiveProvider?: AIProvider;
  /** LLM transient-retry budget override; set to 1 on the fail-fast primary attempt. */
  maxLlmAttempts?: number;
}

export interface GenerateAttemptResult {
  response: RAGResponse;
  duplicateRetries: number;
  emptyRetries: number;
  leakedThinkingRetries: number;
  /**
   * The provider that actually served the request when it differs from the
   * configured/promoted provider — set to `OpenRouter` only when the fallback
   * swap fired. `undefined` on the happy path (no swap), where the caller's
   * resolved provider is already the effective one. Drives the response
   * footer's model-info link so an OpenRouter-served request links to the
   * OpenRouter model card, not the z.ai docs page.
   */
  effectiveProviderUsed?: AIProvider;
  /**
   * Footer announce info for a swap that SERVED the response, set only when
   * the promoted attempt's failure classifies as a quota-class category (the
   * three the footer renders). Without this, the FIRST fallback response of
   * a doom window showed "via OpenRouter" with no `from → to (reason)`
   * breadcrumb — only subsequent requests (proactive demotion off the doom
   * cache) carried it. Non-quota swap reasons (catalog drift) stay
   * unannotated: "via OpenRouter" is accurate and the annotation vocabulary
   * is quota-shaped.
   */
  autoPromotionFallback?: QuotaFallbackInfo;
}

type GenerateAttempt = (opts: GenerateAttemptOpts) => Promise<GenerateAttemptResult>;

/**
 * Run an attempt; if it fails AND `fallback` is set, swap personality + apiKey
 * to the fallback route and retry once. The fallback contains the original
 * (pre-promotion) `z-ai/<model>` form + OpenRouter key, so the retry hits
 * OpenRouter as if no promotion had occurred.
 *
 * Common case (`fallback === undefined`): straight passthrough, no overhead.
 * If the fallback retry also fails, the ORIGINAL error is propagated untouched
 * (class, category, AND message — `parseApiError` classifies via regex over the
 * message text, so appending the fallback's text there could flip the category
 * to whatever the fallback's wording happens to match first). The fallback's
 * failure rides a SEPARATE property (`attachFallbackFailure`) that the
 * error-result composer reads AFTER classification — the user must see the
 * whole picture, not just half of it. Observed shape: z.ai rate-limits, the
 * OpenRouter rescue then dies on a 402 credit check, and the surfaced "rate
 * limit" alone left the user unaware a fallback was even attempted.
 *
 * Worst-case LLM call count = 1 (z.ai initial) + ≤3 (OpenRouter inner-loop
 * retries on duplicate/empty responses). Inner `generateWithDuplicateRetry`
 * does NOT retry on HTTP errors — those rethrow immediately (see
 * GenerationStep.ts:147-161), so a z.ai HTTP failure escapes the inner loop
 * after a single call rather than consuming the 3-attempt retry budget.
 */
export async function runWithAutoPromotionFallback(
  attempt: GenerateAttempt,
  opts: GenerateAttemptOpts,
  fallback: NonNullable<GenerationContext['auth']>['fallback']
): Promise<GenerateAttemptResult> {
  if (fallback === undefined || fallback.isGuestMode) {
    // No fallback, or a guest-mode fallback that resolved onto the SYSTEM
    // OpenRouter key — rescuing would run the PAID z-ai/<model> on the
    // owner's key (owner-cost boundary). Let the failure propagate; the
    // reactive quota fallback downstream retargets guests to the free
    // default correctly.
    return attempt(opts);
  }

  try {
    // Fail fast on the primary attempt: a fallback exists, so a transient z.ai
    // failure (429/overload) should swap to OpenRouter immediately rather than
    // burning the full ~3×retry budget (a z.ai 429 can take ~110s per attempt).
    return await attempt({ ...opts, maxLlmAttempts: 1 });
  } catch (originalError) {
    logger.warn(
      {
        jobId: opts.jobId,
        err: originalError,
        promotedProvider: opts.personality.provider,
        promotedModel: opts.personality.model,
        fallbackProvider: fallback.provider,
        fallbackModel: fallback.model,
      },
      'Auto-promoted z.ai request failed; retrying via OpenRouter fallback (catalog drift defense)'
    );

    const fallbackPersonality = {
      ...opts.personality,
      provider: fallback.provider,
      model: fallback.model,
    };

    try {
      const fallbackResult = await attempt({
        ...opts,
        personality: fallbackPersonality,
        apiKey: fallback.apiKey,
        isGuestMode: fallback.isGuestMode,
        // The fallback route is, by construction, the OpenRouter passthrough —
        // so the context-window cap must now derive from OpenRouter, not z.ai.
        effectiveProvider: AIProvider.OpenRouter,
      });
      // OpenRouter actually served this request (the promoted z.ai call failed),
      // so report it as the effective provider for the footer model-info link —
      // and, for BILLING-class failures, the announce breadcrumb (same shape
      // the proactive demotion attaches from the doom cache). The narrow
      // billing classifier — not the wide D12 retargetable set — because this
      // swap is a same-model route recovery: a routing hiccup (catalog-drift
      // 404, flaky 5xx) deliberately stays unannotated. Classifier (not a
      // hand-rolled parseApiError) because it trusts an ApiError's own
      // .info.category — the rate-limit-cache short-circuit throws a synthetic
      // ApiError whose generic message would regex-parse to the WRONG category.
      const category = classifyBillingQuotaFailure(originalError);
      if (category === null) {
        return { ...fallbackResult, effectiveProviderUsed: AIProvider.OpenRouter };
      }
      const info: QuotaFallbackInfo = {
        fromModel: opts.personality.model,
        toModel: fallback.model,
        category,
        mode: 'reactive',
      };
      // Audit-log parity with the other two announce sources (module
      // invariant: every fire is announced AND audit-logged) — the fallback
      // route's key is the one that actually served the rescued request.
      logQuotaFallbackAudit(info, {
        jobId: opts.jobId,
        cacheKeyId: deriveCacheKeyId(fallback.apiKey, opts.conversationContext.userId),
      });
      return {
        ...fallbackResult,
        effectiveProviderUsed: AIProvider.OpenRouter,
        autoPromotionFallback: info,
      };
    } catch (fallbackError) {
      logger.error(
        { jobId: opts.jobId, err: originalError, fallbackErr: fallbackError },
        'Auto-promotion fallback retry also failed; propagating original error (summary attached)'
      );
      // Carry the fallback's failure on a separate property — NOT the message.
      // parseApiError classifies via regex over message text, so appending here
      // could flip the root-cause category to whatever the fallback's wording
      // matches first (e.g. MODEL_NOT_FOUND → RATE_LIMIT). The composer in
      // GenerationStep appends it to the user-facing string AFTER classification.
      // The attempted route rides along so the error footer can render the full
      // chain ("via Z.AI Coding Plan → OpenRouter") instead of just the primary.
      //
      // Summarize the UNWRAPPED error: the retry machinery rethrows a
      // RetryError whose own message is the generic wrapper ("LLM invocation
      // (<model>) failed with non-retryable error"), which buries the provider
      // detail the user actually needs (e.g. OpenRouter's 402 "requires more
      // credits, or fewer max_tokens"). Same unwrap the primary error gets
      // before classification in GenerationStep's composer.
      attachFallbackFailure(originalError, {
        summary: summarizeError(
          fallbackError instanceof RetryError ? fallbackError.lastError : fallbackError
        ),
        provider: fallback.provider,
      });
      throw originalError;
    }
  }
}

/**
 * Property key for the fallback-failure info carried on the propagated
 * original error. A registered symbol (not a string key) so it can't collide
 * with real error fields and won't leak into JSON/log serialization.
 */
const FALLBACK_FAILURE_INFO = Symbol.for('tzurot.fallbackFailureInfo');

/** What the both-fail path records about the failed fallback attempt. */
interface FallbackFailureInfo {
  /** Capped, user-renderable summary of the fallback's failure. */
  summary: string;
  /** Provider of the attempted fallback route (OpenRouter by construction). */
  provider: string;
}

/**
 * Attach the fallback attempt's failure info to the error about to be
 * rethrown. Exported for the quota-fallback runner, which has the same
 * both-fail shape (retry a different route once, propagate the pristine
 * original, carry the second failure out-of-band for the composer).
 */
export function attachFallbackFailure(error: unknown, info: FallbackFailureInfo): void {
  if (error !== null && typeof error === 'object') {
    (error as Record<PropertyKey, unknown>)[FALLBACK_FAILURE_INFO] = info;
  }
}

/** Read the fallback-failure info off a caught error, shape-checked. */
function getFallbackFailureInfo(error: unknown): FallbackFailureInfo | undefined {
  if (error === null || typeof error !== 'object') {
    return undefined;
  }
  const value = (error as Record<PropertyKey, unknown>)[FALLBACK_FAILURE_INFO];
  if (value === null || typeof value !== 'object') {
    return undefined;
  }
  const info = value as Partial<FallbackFailureInfo>;
  return typeof info.summary === 'string' && typeof info.provider === 'string'
    ? { summary: info.summary, provider: info.provider }
    : undefined;
}

/**
 * Read the fallback-failure summary off a caught error, if a failed
 * auto-promotion fallback attached one. Used by the error-result composer to
 * append the second half of the story AFTER classification has run on the
 * pristine message.
 */
export function getFallbackFailureSummary(error: unknown): string | undefined {
  return getFallbackFailureInfo(error)?.summary;
}

/**
 * Provider of the fallback route that was attempted and also failed, if any.
 * Feeds the error result's `fallbackProviderAttempted` metadata so the footer
 * can render the full route chain rather than mis-attributing the primary as
 * the only attempt.
 */
export function getAttemptedFallbackProvider(error: unknown): string | undefined {
  return getFallbackFailureInfo(error)?.provider;
}

/**
 * Compose the user-facing error string: the pristine original message plus the
 * fallback-failure summary when one was attached. MUST be called only after
 * classification (`parseApiError`) has run — that's the whole point of keeping
 * the summary off the message.
 */
export function composeFallbackAwareErrorMessage(error: unknown): string {
  const base = error instanceof Error ? error.message : 'Unknown error';
  const summary = getFallbackFailureSummary(error);
  return summary !== undefined ? `${base} — fallback via OpenRouter also failed: ${summary}` : base;
}

/**
 * Fold the fallback-failure summary into an already-classified error info's
 * `technicalMessage` — the field bot-client's `buildErrorContent` actually
 * renders into the persona-voiced Discord error (`result.error` is log-only).
 * Classification fields (category/type/shouldRetry) are untouched: they were
 * derived from the pristine message and must stay that way. No summary → the
 * info passes through unchanged.
 */
export function withFallbackFailure<T extends { technicalMessage?: string }>(
  errorInfo: T,
  error: unknown
): T {
  const summary = getFallbackFailureSummary(error);
  if (summary === undefined) {
    return errorInfo;
  }
  const base = errorInfo.technicalMessage ?? (error instanceof Error ? error.message : 'Unknown');
  return {
    ...errorInfo,
    technicalMessage: `${base} — fallback via OpenRouter also failed: ${summary}`,
  };
}

/**
 * Short, user-renderable summary of the fallback's failure. Provider messages
 * can run long (the OpenRouter 402 includes token math); cap it so the
 * persona-voiced error stays readable. Sliced via code points (Array.from) so
 * a multi-byte character at the boundary can't be split into a mangled surrogate.
 */
export function summarizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const MAX = 160;
  const points = Array.from(message);
  return points.length > MAX ? `${points.slice(0, MAX).join('')}…` : message;
}
