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
 * the retargeted personality. Hops never re-select a route the primary already
 * ran (`attemptedRoutes`).
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
  selectFloorTarget,
  selectQuotaFallbackTarget,
  type AttemptedRoute,
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
import { selectHopOneFloorTarget } from './hopOneFloorTarget.js';
import { hasBudgetForAttempt } from './llmBudget.js';

const logger = createLogger('QuotaFallbackRunner');

/** Job-wide LLM budget gate for the retarget hop: a spent deadline must not
 * start another full attempt — propagate the pristine original error untouched
 * (classification runs on message regexes; never wrap or append to it). */
function assertBudgetForRetarget(opts: GenerateAttemptOpts, originalError: unknown): void {
  if (!hasBudgetForAttempt(opts.llmDeadline)) {
    logger.warn(
      { jobId: opts.jobId },
      'LLM job budget exhausted before quota retarget hop — propagating original error'
    );
    throw originalError;
  }
}

/** Fire the fail-soft free-tier reactor for a z.ai guest failure BEFORE any
 * retarget — the window-exhausted/kill-switch reactions must see the original
 * error even when the degrade then succeeds. Fail-soft by contract; never
 * lets the reaction mask the real error. */
async function reactToZaiFreeTierFailure(
  opts: GenerateAttemptOpts,
  onZaiFreeTierFailure: ((error: unknown) => Promise<void>) | undefined,
  originalError: unknown
): Promise<void> {
  if (
    opts.isGuestMode &&
    opts.effectiveProvider === AIProvider.ZaiCoding &&
    onZaiFreeTierFailure !== undefined
  ) {
    await onZaiFreeTierFailure(originalError).catch(() => undefined);
  }
}

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
  /**
   * Fired (fail-soft) when a z.ai free-tier attempt fails, BEFORE any
   * retarget — the window-exhausted/kill-switch reactions must see the
   * original error even when the degrade then succeeds.
   */
  onZaiFreeTierFailure?: (error: unknown) => Promise<void>;
  /**
   * The routes the primary already ran: the failing route plus, when the
   * auto-promotion wrapper swapped, its OpenRouter fallback route. No reactive
   * hop selects one of them. Omitted = nothing excluded beyond the existing
   * same-model check.
   */
  attemptedRoutes?: readonly AttemptedRoute[];
}): Promise<QuotaFallbackRunResult> {
  const { primary, retry, opts, userId, deps, freeTierQuota, requestId, onZaiFreeTierFailure } =
    options;
  const { attemptedRoutes } = options;

  if (deps === undefined) {
    return primary();
  }

  try {
    return await primary();
  } catch (originalError) {
    await reactToZaiFreeTierFailure(opts, onZaiFreeTierFailure, originalError);
    // Classification first; the inherited category is a fallback, never an
    // override — a live quota error still describes itself best.
    //
    // The fallback exists because a proactive demotion consumes the quota error
    // before it can be classified here. `AuthStep.resolveLlmAuthWithQuotaCheck`
    // returns early unless `checkModelViability` reports the route doomed, and
    // only then demotes — so on a demoted turn the doomed pool is never called
    // and produces no error. The only error this sees is whatever the demoted
    // route returned. When that is a 400 (a model OpenRouter has not published
    // yet), classification yields null and the turn dead-ends — even though the
    // user is demonstrably rate-limited, which is why the demotion happened.
    const liveCategory = classifyQuotaFailure(originalError);
    const category = liveCategory ?? opts.inheritedQuotaCategory ?? null;
    if (category === null) {
      throw originalError;
    }
    // The budget gate sits AFTER the retargetability checks: classification is a
    // pure predicate, so this order starts no attempt — but the spent-budget log
    // now fires only for hops the runner was actually going to attempt.
    assertBudgetForRetarget(opts, originalError);

    // A guest attempt runs on a SYSTEM key handed over as a plain string, so
    // identity must follow the route's provenance (isGuestMode), not the
    // key's presence — flagless derivation filed guest failures under
    // `user:<id>` while the invocation path writes doom marks under `system`.
    const cacheKeyId = deriveCacheKeyId(opts.apiKey, userId, opts.isGuestMode);
    const tieredTarget = await selectQuotaFallbackTarget({
      category,
      isGuestMode: opts.isGuestMode,
      failingModel: opts.personality.model,
      cacheKeyId,
      configResolver: deps.configResolver,
      caches: deps.caches,
      excludeRoutes: attemptedRoutes,
    });
    // No tier-aware retarget exists when the failing model IS the tier's own
    // default — the proactively-substituted guest turn, and the user whose
    // global default is the failing model — or when that default is a route
    // this job already attempted. The floor is then the only rescue,
    // and it has to be reachable as hop 1 because hop 2 only runs after a
    // hop-1 attempt.
    const target =
      tieredTarget ??
      (await selectHopOneFloorTarget({
        category,
        opts,
        cacheKeyId,
        caches: deps.caches,
        excludeRoutes: attemptedRoutes,
      }));
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
      attemptedRoutes,
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
      // Hop-2 (floor descent) context — see executeRetarget's doc. The hop
      // reuses hop-1's resolved credentials, so its viability check (and its
      // audit line) must run under THAT route's identity: a forced entity
      // swap or degraded downgrade moved the retry onto the system key, and
      // the pre-retarget `user:<id>` bucket no longer describes it.
      caches: deps.caches,
      cacheKeyId: deriveCacheKeyId(credentials.apiKey, userId, credentials.isGuestMode),
      // Past the gate above, a null live classification means the category came
      // from `inheritedQuotaCategory` — the `?? null` arm would have rethrown.
      categoryInherited: liveCategory === null,
      attemptedRoutes,
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
  attemptedRoutes?: readonly AttemptedRoute[];
}): Promise<{
  effectiveTarget: NonNullable<Awaited<ReturnType<typeof selectQuotaFallbackTarget>>>;
  credentials: { apiKey: string | undefined; isGuestMode: boolean };
}> {
  const { target, opts, deps, userId, category, cacheKeyId, originalError, attemptedRoutes } =
    params;
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
      excludeRoutes: attemptedRoutes,
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
 * Fires when a NON-guest is now forced onto the system key with guest
 * semantics (`!wasGuest && nowGuest`) — excluding a pure guest's free-model
 * retarget, which GenerationStep already metered — OR when a z.ai-free-tier
 * guest degrades onto the OpenRouter pool: that request billed the zai pool
 * at admission and GenerationStep therefore SKIPPED the OpenRouter meter, so
 * the retarget is this pool's first (and only) charge. The owner bypasses; a
 * missing quota (test fixtures) is a no-op; `tryConsume` fails open, so a
 * Redis blip returns allowed.
 */
async function meterForcedFallback(params: {
  freeTierQuota: FreeTierRequestQuota | undefined;
  opts: GenerateAttemptOpts;
  nowGuest: boolean;
  userId: string;
  requestId: string;
}): Promise<boolean> {
  const { freeTierQuota, opts, nowGuest, userId, requestId } = params;
  const byokDowngrade = !opts.isGuestMode && nowGuest;
  const zaiGuestDegrade =
    opts.isGuestMode && opts.effectiveProvider === AIProvider.ZaiCoding && nowGuest;
  if ((!byokDowngrade && !zaiGuestDegrade) || freeTierQuota === undefined || isBotOwner(userId)) {
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
 *   z.ai-promoted request carries the user's z.ai key), and the caller is
 *   BYOK → the user's OWN OpenRouter key, never the system key (a paid
 *   default on the system key would be owner cost);
 * - the same non-OpenRouter case with GUEST semantics → the system key. A
 *   guest has no BYOK OpenRouter key by construction, so asking for one
 *   resolves undefined and dead-ends a turn whose correct credential is
 *   obvious; the system key IS a guest's OpenRouter billing identity. No
 *   owner-cost exposure opens up, because every guest-reachable target is
 *   free-guarded at selection (`resolveGuestSafeFreeDefault` and
 *   `selectFloorTarget`'s isFreeModel-guarded floor);
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
      if (opts.isGuestMode) {
        const systemKey = await deps.resolveSystemKey();
        return systemKey === undefined ? null : { apiKey: systemKey, isGuestMode: true };
      }
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
 * Run the retargeted retry (hop 1); on a retargetable second failure, attempt
 * ONE bounded floor hop (hop 2, D12) — the runtime `fallbackTextModel(Free)`
 * setting, dedup'd against both prior models and doom-cache viability-checked.
 * Any remaining failure propagates the pristine original with every rescue
 * attempt's failure attached out-of-band for the composer.
 */
async function executeRetarget(options: {
  retry: (opts: GenerateAttemptOpts) => Promise<GenerateAttemptResult>;
  opts: GenerateAttemptOpts;
  info: QuotaFallbackInfo;
  originalError: unknown;
  caches: QuotaFallbackCaches;
  cacheKeyId: string;
  /** True when this turn's category came from a proactive demotion, not a live error. */
  categoryInherited: boolean;
  /** Routes the primary already ran; the hop-2 floor never re-selects one. */
  attemptedRoutes?: readonly AttemptedRoute[];
}): Promise<QuotaFallbackRunResult> {
  const {
    retry,
    opts,
    info,
    originalError,
    caches,
    cacheKeyId,
    categoryInherited,
    attemptedRoutes,
  } = options;
  try {
    const result = await retry(opts);
    // OpenRouter actually served this request; report it so the footer's
    // provider badge doesn't show the stale pre-retarget provider. The
    // guest-mode flag gets the same correction: `opts` here carries the
    // RESOLVED retry credentials, so a forced entity swap (BYOK → system
    // key) must reach the usage row's byok column, not the stale value.
    return {
      ...result,
      effectiveProviderUsed: AIProvider.OpenRouter,
      effectiveIsGuestMode: opts.isGuestMode,
      quotaFallback: info,
    };
  } catch (retryError) {
    const floorOutcome = await attemptFloorHop({
      retry,
      opts,
      info,
      retryError,
      caches,
      cacheKeyId,
      categoryInherited,
      attemptedRoutes,
    });
    if (floorOutcome.kind === 'success') {
      return floorOutcome.result;
    }
    logger.error(
      { jobId: opts.jobId, err: originalError, retryErr: retryError },
      'Quota-fallback retry also failed; propagating original error (summary attached)'
    );
    mergeFallbackFailure(originalError, retryError, info.toModel);
    if (floorOutcome.kind === 'failed') {
      mergeFallbackFailure(originalError, floorOutcome.floorError, floorOutcome.floorModel);
    }
    throw originalError;
  }
}

/** Outcome of the bounded second hop — the caller owns error-summary merging. */
type FloorHopOutcome =
  | { kind: 'success'; result: QuotaFallbackRunResult }
  | { kind: 'failed'; floorError: unknown; floorModel: string }
  | { kind: 'not-attempted' };

/** Shared not-attempted outcome (every skip path returns the same shape).
 *  Declared via `as const` WITHOUT the `FloorHopOutcome` annotation — an
 *  annotation would re-widen the literal and undo the readonly type the shared
 *  module-level object needs against mutation through a returned reference. */
const FLOOR_HOP_NOT_ATTEMPTED = { kind: 'not-attempted' } as const;

/**
 * The bounded second hop (D12). Not attempted when the retry's failure is not
 * retargetable AND this turn's category was not inherited, when the floor is
 * already among this turn's failed models, or when the doom caches veto it.
 * Never throws: a floor-selection error must not replace the pristine original
 * the caller propagates.
 *
 * The retargetability gate exists because a quota failure is a property of the
 * MODEL or the ACCOUNT, so another model can rescue it, while a request-shaped
 * failure (content policy, context overflow) would fail identically on the
 * floor. An inherited-category turn is the exception: the category came from a
 * proactive demotion, which fires only when the route is already known
 * quota-scarce (rate-limited or credit-exhausted), and the hop-1 error's
 * own unclassifiability says nothing about
 * the turn — so the floor stays reachable there.
 */
async function attemptFloorHop(params: {
  retry: (opts: GenerateAttemptOpts) => Promise<GenerateAttemptResult>;
  opts: GenerateAttemptOpts;
  info: QuotaFallbackInfo;
  retryError: unknown;
  caches: QuotaFallbackCaches;
  cacheKeyId: string;
  /** True when this turn's category came from a proactive demotion, not a live error. */
  categoryInherited: boolean;
  /** Routes the primary already ran; the floor is not selected when it is one of them. */
  attemptedRoutes?: readonly AttemptedRoute[];
}): Promise<FloorHopOutcome> {
  const { retry, opts, info, retryError, caches, cacheKeyId, categoryInherited, attemptedRoutes } =
    params;
  if (classifyQuotaFailure(retryError) === null && !categoryInherited) {
    return FLOOR_HOP_NOT_ATTEMPTED;
  }
  // Job-wide budget spent — never start the floor attempt. Not-attempted, not
  // thrown: attemptFloorHop's contract is outcome-shaped, never throwing. It
  // sits after the retargetability check (classification is a pure predicate —
  // this order starts no attempt) so the budget log fires only for a hop the
  // floor descent was actually going to run.
  if (!hasBudgetForAttempt(opts.llmDeadline)) {
    logger.info(
      { jobId: opts.jobId, hop1Model: info.toModel },
      'LLM job budget exhausted before floor descent — not attempting hop 2'
    );
    return FLOOR_HOP_NOT_ATTEMPTED;
  }
  const floorTarget = await selectFloorTarget({
    isGuestMode: opts.isGuestMode,
    excludeModels: [info.fromModel, info.toModel],
    excludeRoutes: attemptedRoutes,
    cacheKeyId,
    caches,
  }).catch(() => null);
  if (floorTarget === null) {
    return FLOOR_HOP_NOT_ATTEMPTED;
  }
  // The footer traces back to the ORIGINAL configured model with the ORIGINAL
  // failure category (the story's start); the hop chain lives in the audit log.
  const floorInfo: QuotaFallbackInfo = {
    fromModel: info.fromModel,
    toModel: floorTarget.config.model,
    category: info.category,
    mode: 'reactive',
  };
  logQuotaFallbackAudit(floorInfo, { jobId: opts.jobId, cacheKeyId });
  logger.info(
    { jobId: opts.jobId, hop1Model: info.toModel, floorModel: floorTarget.config.model },
    'Quota-fallback hop-1 target also failed — descending to the floor (hop 2)'
  );
  try {
    const result = await retry({
      ...opts,
      personality: applyConfigToPersonality(opts.personality, floorTarget.config),
    });
    return {
      kind: 'success',
      // Hop 2 reuses hop-1's resolved credentials (opts carries them), so
      // the effective guest-mode correction mirrors executeRetarget's.
      result: {
        ...result,
        effectiveProviderUsed: AIProvider.OpenRouter,
        effectiveIsGuestMode: opts.isGuestMode,
        quotaFallback: floorInfo,
      },
    };
  } catch (floorError) {
    logger.error(
      { jobId: opts.jobId, retryErr: retryError, floorErr: floorError },
      'Floor descent (hop 2) also failed; propagating original error'
    );
    return { kind: 'failed', floorError, floorModel: floorInfo.toModel };
  }
}

/**
 * Merge one rescue attempt's failure into the single-valued announce
 * attachment slot (the auto-promotion wrapper may already have used it —
 * merge rather than clobber, so no rescue attempt goes unannounced).
 */
function mergeFallbackFailure(originalError: unknown, attemptError: unknown, model: string): void {
  const summary = summarizeError(
    attemptError instanceof RetryError ? attemptError.lastError : attemptError
  );
  const priorSummary = getFallbackFailureSummary(originalError);
  attachFallbackFailure(originalError, {
    summary:
      priorSummary !== undefined
        ? `${priorSummary}; quota-fallback retry (${model}) also failed: ${summary}`
        : summary,
    provider: 'OpenRouter',
  });
}
