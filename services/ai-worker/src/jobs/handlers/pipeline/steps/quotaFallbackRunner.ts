/**
 * Reactive quota-fallback retry orchestrator.
 *
 * Wraps the whole primary generation attempt (including the auto-promotion
 * wrapper) with a one-shot tier-aware retarget on quota-class failures.
 * Pure orchestration — the target-selection matrix, viability checks, and
 * personality rewrite live in `services/quotaFallback.ts`.
 *
 * The retry deliberately does NOT re-enter the auto-promotion wrapper: its
 * pre-computed fallback route belongs to the PRIMARY model and could swap the
 * retargeted request back onto a stale route. The retry is a plain attempt on
 * the retargeted personality.
 *
 * Both-fail propagates the PRISTINE original error (classification runs on
 * message regexes — appending text could flip the category) with the second
 * failure attached out-of-band, exactly like the auto-promotion wrapper.
 */

import { AIProvider } from '@tzurot/common-types/constants/ai';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { isBotOwner } from '@tzurot/common-types/utils/ownerMiddleware';
import type { LlmConfigResolver } from '@tzurot/config-resolver';
import type { FreeTierRequestQuota } from '../../../../services/FreeTierRequestQuota.js';
import {
  applyConfigToPersonality,
  classifyQuotaFailure,
  logQuotaFallbackAudit,
  selectQuotaFallbackTarget,
  type QuotaFallbackCaches,
  type QuotaFallbackInfo,
} from '../../../../services/quotaFallback.js';
import { deriveCacheKeyId } from '../../../../services/RateLimitCache.js';
import { RetryError } from '../../../../utils/retry.js';
import {
  attachFallbackFailure,
  getFallbackFailureSummary,
  summarizeError,
  type GenerateAttemptOpts,
  type GenerateAttemptResult,
} from './autoPromotionFallback.js';

const logger = createLogger('QuotaFallbackRunner');

/** Worker-level dependencies, wired once by LLMGenerationHandler. */
export interface QuotaFallbackDeps {
  configResolver: LlmConfigResolver;
  caches: QuotaFallbackCaches;
  /**
   * Resolve the system OpenRouter key for the forced-entity-swap path
   * (credit-exhausted BYOK). Returns undefined when no system key is
   * configured — the retarget is then skipped (terminal, as today).
   */
  resolveSystemKey: () => Promise<string | undefined>;
  /**
   * Resolve the user's OWN OpenRouter key (BYOK only — undefined when the
   * user has none). Needed when the failing attempt ran on a different
   * provider's credential (e.g. a z.ai-promoted request carries the user's
   * z.ai key): the retarget's OpenRouter attempt must not reuse it, and it
   * must not silently drop a paid-default retry onto the system key either.
   */
  resolveUserOpenRouterKey: (userId: string) => Promise<string | undefined>;
}

export interface QuotaFallbackRunResult extends GenerateAttemptResult {
  /** Set when the reactive retarget fired and the retry succeeded. */
  quotaFallback?: QuotaFallbackInfo;
}

/**
 * Run `primary`; on a quota-class failure, retarget once via `retry` with the
 * tier-aware default. `deps === undefined` (test fixtures without the wiring)
 * is a straight passthrough.
 */
export async function runWithQuotaFallback(options: {
  primary: () => Promise<GenerateAttemptResult>;
  retry: (opts: GenerateAttemptOpts) => Promise<GenerateAttemptResult>;
  opts: GenerateAttemptOpts;
  userId: string;
  deps: QuotaFallbackDeps | undefined;
  /**
   * Shared-free-key fair-share meter. Charged here on ANY BYOK → system-key
   * downgrade with guest semantics — credit-exhaustion is the common trigger,
   * but the degraded-beats-failed path can force a previously-BYOK user onto the
   * system key for other quota categories too, and all of those should be
   * metered. The pure-guest path is metered upstream in GenerationStep; the
   * `!wasGuest && nowGuest` guard keeps the two mutually exclusive (no
   * double-count).
   */
  freeTierQuota?: FreeTierRequestQuota;
  /**
   * The logical-message id — the free-tier meter's idempotency member. A
   * required, retry-stable `job.data.requestId` (NOT the optional `job.id`);
   * both meter sites use it so counting is consistent and never collapses to a
   * per-user member that would silently disable the cap.
   */
  requestId: string;
}): Promise<QuotaFallbackRunResult> {
  const { primary, retry, opts, userId, deps, freeTierQuota, requestId } = options;

  if (deps === undefined) {
    return primary();
  }

  try {
    return await primary();
  } catch (originalError) {
    const category = classifyQuotaFailure(originalError);
    if (category === null) {
      throw originalError;
    }

    const cacheKeyId = deriveCacheKeyId(opts.apiKey, userId);
    const target = await selectQuotaFallbackTarget({
      category,
      isGuestMode: opts.isGuestMode,
      failingModel: opts.personality.model,
      cacheKeyId,
      configResolver: deps.configResolver,
      caches: deps.caches,
    });
    if (target === null) {
      throw originalError;
    }

    const { effectiveTarget, credentials } = await resolveTargetAndCredentials({
      target,
      opts,
      deps,
      userId,
      category,
      cacheKeyId,
      originalError,
    });

    // Meter the credit-exhausted-BYOK → shared-system-key transition. Over-share
    // → surface the ORIGINAL error (their own key is out of credits; "top up" is
    // the actionable fix, not "bring your own key").
    if (
      !(await meterForcedFallback({
        freeTierQuota,
        opts,
        nowGuest: credentials.isGuestMode,
        userId,
        requestId,
      }))
    ) {
      throw originalError;
    }

    const info: QuotaFallbackInfo = {
      fromModel: opts.personality.model,
      toModel: effectiveTarget.config.model,
      category,
      mode: 'reactive',
    };
    logQuotaFallbackAudit(info, { jobId: opts.jobId, cacheKeyId });

    return executeRetarget({
      retry,
      opts: {
        ...opts,
        personality: applyConfigToPersonality(opts.personality, effectiveTarget.config),
        apiKey: credentials.apiKey,
        isGuestMode: credentials.isGuestMode,
        // The retarget is an OpenRouter attempt by construction (admin
        // defaults are OpenRouter-routed), so the context-window cap and
        // vision auth must derive from OpenRouter — mirroring the
        // auto-promotion wrapper's own retry. Revisit if an explicit
        // fallback edge ever allows a non-OpenRouter target.
        effectiveProvider: AIProvider.OpenRouter,
      },
      info,
      originalError,
    });
  }
}

/**
 * Resolve the retarget's effective target + credentials, applying the
 * degraded-beats-failed downgrade (owner policy): when the primary target's
 * credential resolution comes up empty (typically a paid target needs the
 * user's own OpenRouter key and they have none), downgrade to the FREE default
 * on the system key — zero owner cost — rather than failing the turn. Always
 * throws the PRISTINE `originalError` (never a dep's throw) when even the
 * downgrade can't resolve, so classification stays stable.
 */
async function resolveTargetAndCredentials(params: {
  target: NonNullable<Awaited<ReturnType<typeof selectQuotaFallbackTarget>>>;
  opts: GenerateAttemptOpts;
  deps: QuotaFallbackDeps;
  userId: string;
  category: NonNullable<ReturnType<typeof classifyQuotaFailure>>;
  cacheKeyId: string;
  originalError: unknown;
}): Promise<{
  effectiveTarget: NonNullable<Awaited<ReturnType<typeof selectQuotaFallbackTarget>>>;
  credentials: { apiKey: string | undefined; isGuestMode: boolean };
}> {
  const { target, opts, deps, userId, category, cacheKeyId, originalError } = params;
  const credentials = await resolveRetryCredentials(target, opts, deps, userId);
  if (credentials !== null) {
    return { effectiveTarget: target, credentials };
  }
  // Wrapped so a throwing dep can never REPLACE the pristine original.
  try {
    const guestTarget = await selectQuotaFallbackTarget({
      category,
      isGuestMode: true,
      failingModel: opts.personality.model,
      cacheKeyId,
      configResolver: deps.configResolver,
      caches: deps.caches,
    });
    const systemKey = await deps.resolveSystemKey();
    if (guestTarget === null || systemKey === undefined) {
      throw originalError;
    }
    return { effectiveTarget: guestTarget, credentials: { apiKey: systemKey, isGuestMode: true } };
  } catch {
    throw originalError;
  }
}

/**
 * Fair-share meter for the BYOK → shared-system-key downgrade (owner: "meter
 * the fallback too"). Returns `true` (proceed) unless a metered user is over
 * their share.
 *
 * Fires ONLY when a NON-guest is now forced onto the system key with guest
 * semantics (`!wasGuest && nowGuest`) — this excludes a pure guest's free-model
 * retarget (already metered upstream in GenerationStep), so the two meter sites
 * never double-count. The owner bypasses; a missing quota (test fixtures) is a
 * no-op; `tryConsume` fails open, so a Redis blip returns allowed.
 */
async function meterForcedFallback(params: {
  freeTierQuota: FreeTierRequestQuota | undefined;
  opts: GenerateAttemptOpts;
  nowGuest: boolean;
  userId: string;
  requestId: string;
}): Promise<boolean> {
  const { freeTierQuota, opts, nowGuest, userId, requestId } = params;
  if (opts.isGuestMode || !nowGuest || freeTierQuota === undefined || isBotOwner(userId)) {
    return true;
  }
  const verdict = await freeTierQuota.tryConsume(userId, requestId);
  return verdict.allowed;
}

/**
 * Compose the announce-carrier when BOTH hooks fired in one turn: a proactive
 * retarget's model then failed and a reactive retarget rescued it. The footer
 * must trace back to the ORIGINAL configured model, not the intermediate hop.
 * With only one hook fired, that hook's info passes through unchanged.
 */
export function composeQuotaFallbackInfo(
  reactive: QuotaFallbackInfo | undefined,
  proactive: QuotaFallbackInfo | undefined
): QuotaFallbackInfo | undefined {
  if (reactive !== undefined && proactive !== undefined) {
    return { ...reactive, fromModel: proactive.fromModel };
  }
  return reactive ?? proactive;
}

/**
 * Pick the credential the retargeted attempt must run on. Null aborts the
 * retarget (terminal, as today):
 * - forced entity swap (credit-exhausted BYOK) → the system OpenRouter key
 *   with guest semantics (the free target bills the owner);
 * - the failing attempt ran on a NON-OpenRouter credential (e.g. a
 *   z.ai-promoted request carries the user's z.ai key) → the user's OWN
 *   OpenRouter key, never the system key (a paid default on the system key
 *   would be owner cost);
 * - otherwise the original key already fits the OpenRouter target.
 */
async function resolveRetryCredentials(
  target: NonNullable<Awaited<ReturnType<typeof selectQuotaFallbackTarget>>>,
  opts: GenerateAttemptOpts,
  deps: QuotaFallbackDeps,
  userId: string
): Promise<{ apiKey: string | undefined; isGuestMode: boolean } | null> {
  // The deps are never-throwing by contract, but this function runs inside
  // the runner's catch block — a throw here would REPLACE the original quota
  // error. Guard the injectable seam so no wiring can break that guarantee:
  // a credential failure degrades to null → the pristine original rethrows.
  try {
    if (target.forceSystemKey) {
      const systemKey = await deps.resolveSystemKey();
      return systemKey === undefined ? null : { apiKey: systemKey, isGuestMode: true };
    }
    const provider: string | undefined = opts.personality.provider;
    if (provider !== undefined && provider !== (AIProvider.OpenRouter as string)) {
      const openRouterKey = await deps.resolveUserOpenRouterKey(userId);
      return openRouterKey === undefined
        ? null
        : { apiKey: openRouterKey, isGuestMode: opts.isGuestMode };
    }
    return { apiKey: opts.apiKey, isGuestMode: opts.isGuestMode };
  } catch (error) {
    logger.warn(
      { err: error, jobId: opts.jobId },
      'Quota-fallback credential resolution failed — aborting retarget'
    );
    return null;
  }
}

/**
 * Run the retargeted retry; on a second failure, propagate the pristine
 * original with the retry's failure attached out-of-band for the composer.
 */
async function executeRetarget(options: {
  retry: (opts: GenerateAttemptOpts) => Promise<GenerateAttemptResult>;
  opts: GenerateAttemptOpts;
  info: QuotaFallbackInfo;
  originalError: unknown;
}): Promise<QuotaFallbackRunResult> {
  const { retry, opts, info, originalError } = options;
  try {
    const result = await retry(opts);
    // OpenRouter actually served this request; report it so the footer's
    // provider badge doesn't show the stale pre-retarget provider.
    return { ...result, effectiveProviderUsed: AIProvider.OpenRouter, quotaFallback: info };
  } catch (retryError) {
    logger.error(
      { jobId: opts.jobId, err: originalError, retryErr: retryError },
      'Quota-fallback retry also failed; propagating original error (summary attached)'
    );
    // The attachment slot is single-valued and the auto-promotion wrapper may
    // have already used it (triple-failure: z.ai → its OpenRouter route →
    // this retarget). Merge rather than clobber, so no rescue attempt goes
    // unannounced.
    const retrySummary = summarizeError(
      retryError instanceof RetryError ? retryError.lastError : retryError
    );
    const priorSummary = getFallbackFailureSummary(originalError);
    attachFallbackFailure(originalError, {
      summary:
        priorSummary !== undefined
          ? `${priorSummary}; quota-fallback retry (${info.toModel}) also failed: ${retrySummary}`
          : retrySummary,
      provider: 'OpenRouter',
    });
    throw originalError;
  }
}
