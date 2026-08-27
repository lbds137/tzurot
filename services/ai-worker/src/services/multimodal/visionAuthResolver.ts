/**
 * Vision Config Resolver
 *
 * Resolves the API key + provider + model for a vision call **independently**
 * from the main-model auth resolution. The personality's vision model may live
 * on a different provider than its main model (e.g., main=`glm-5.1` on
 * z.ai-coding, vision=`qwen/qwen3.5-...` on OpenRouter); using the main-model
 * key for the vision call results in a 401 from the vision provider's API.
 *
 * `resolveVisionConfig` returns a discriminated union:
 * - `{ kind: 'resolved', config }` — caller proceeds with the vision call,
 *   passing `config.model` through so the chosen model (which may be a forced
 *   free-tier downgrade) is honored rather than re-selected.
 * - `{ kind: 'failFast', provider }` — caller MUST short-circuit. Only happens
 *   when even the free-model system fallback is unavailable (no system
 *   OpenRouter key configured).
 *
 * Policy: an authenticated user lacking a key for the vision provider does NOT
 * fail-fast; they downgrade to the free vision model
 * (`getFreeVisionFloor()`) on the system OpenRouter key. This is
 * the BROAD free-fallback behavior — it applies to ALL authenticated users who
 * can't auth the vision provider, not a specific provider's users.
 *
 * On `failFast`, the fallback loop (`describeImageWithFallback`) renders the
 * `visionAuthFailFastDescription` "configure your key" placeholder per attachment
 * once every fallback tier is exhausted.
 *
 * The z.ai free-tier piggyback participates as a GUEST vision tier: when the
 * target model is the piggyback model and the caller is a guest, admission
 * (flag + key + kill switch + plan headroom + fair-share quota) decides, and any
 * denial `failFast`s so the walk continues down the normal guest chain.
 */

import {
  AIProvider,
  ZAI_FREE_TIER_MODEL,
  isZaiFreeTierModel,
} from '@tzurot/common-types/constants/ai';
import { ApiErrorCategory } from '@tzurot/common-types/constants/error';
import { type LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { getFreeVisionFloor } from '../freeFloors.js';
import { detectVisionProvider } from '../ProviderRouter.js';
import { selectVisionModel, buildFailureFallback } from './VisionProcessor.js';
import { visionFallbackQuota, zaiFreeTierAdmission } from '../../redis.js';
import type { ApiKeyResolver } from '../ApiKeyResolver.js';

const logger = createLogger('VisionAuthResolver');

/**
 * Fallback description shown to the LLM when no usable vision key exists across
 * every fallback tier. DERIVED from `buildFailureFallback`'s AUTH+user branch —
 * this is the "no tier ever resolved a key" rendering, which is the same
 * user-actionable situation, so the wording must stay identical. Deriving
 * (rather than duplicating the literal) makes a future wording change land in
 * both places by construction.
 *
 * A function (not a module-level constant) so the per-request filename reaches
 * the placeholder — every other failure path names the image file, and the
 * fail-fast path shouldn't be the one exception.
 */
export function visionAuthFailFastDescription(filename?: string): string {
  return buildFailureFallback(ApiErrorCategory.AUTHENTICATION, 'user', filename);
}

/**
 * Resolved auth + model context for a vision call. Unifies the auth decision
 * (which key, which provider) with the model decision (which vision model) so a
 * downgraded authenticated user gets the system key AND the free model together —
 * resolving them in separate functions risks handing the system key to a paid
 * model (`selectVisionModel` returns the PAID fallback for `isGuestMode === false`).
 */
export interface VisionConfig {
  apiKey: string;
  provider: AIProvider;
  /** Final resolved vision model — what `describeImage` should actually invoke. */
  model: string;
  source: 'user' | 'system';
  /**
   * PRESERVED meaning: "no keys anywhere" (genuine guest). A downgraded
   * authenticated user (no vision-provider key, falling back to the free model
   * on the system key) is NOT a guest — `isGuestMode` stays `false` for them.
   * Downstream consumers that branch on `isGuestMode` must not conflate it with
   * "using the system key."
   */
  isGuestMode: boolean;
}

/**
 * Result of `resolveVisionConfig`.
 * - `resolved` — caller proceeds with the vision call using `config`
 * - `failFast` — even the free-model system fallback is unavailable (no system
 *   OpenRouter key configured); the fallback loop treats this tier as unusable and
 *   advances (rendering `visionAuthFailFastDescription` once all tiers exhaust).
 *   `provider` is the ORIGINAL vision provider the user actually lacked, so
 *   telemetry reflects what they were missing rather than the free-fallback provider.
 */
export type VisionConfigResult =
  { kind: 'resolved'; config: VisionConfig } | { kind: 'failFast'; provider: AIProvider };

/**
 * Inputs for `resolveVisionConfig` — bundled into an options object to keep the
 * call site readable when threaded through pipeline steps.
 */
export interface ResolveVisionConfigOptions {
  /** Personality whose vision model determines the target provider + model. */
  personality: LoadedPersonality;
  /**
   * Provider that the main-model resolution landed on (typically `auth.provider`
   * from the upstream `AuthStep`). Drives the "is this same-provider, can we
   * reuse the main key?" decision. `undefined` for callers with no upstream
   * main-model context (e.g., `ImageDescriptionJob`), in which case the
   * same-provider fast path is skipped and per-provider resolution always runs.
   */
  mainProvider?: AIProvider;
  /**
   * API key the upstream resolution returned for the main model. Optional
   * because `AuthStep`'s resolution-failure recovery branch returns
   * `resolvedApiKey: undefined` (degraded guest mode); when missing or empty,
   * the same-provider fast path is skipped and per-provider resolution always
   * runs, ensuring we don't hand `createChatModel` an empty Authorization
   * header.
   */
  mainApiKey?: string;
  /** Whether the upstream resolution landed on a system fallback (genuine guest mode). */
  isGuestMode: boolean;
  /** Discord user ID, if known. Required for any user-key lookup. */
  userId: string | undefined;
  /**
   * Per-request idempotency anchor. Required for the z.ai free-tier piggyback vision tier:
   * admission counts per (userId, requestId), so the same request re-admitting
   * costs nothing. Absent → the piggyback tier is skipped rather than admitted
   * without an anchor.
   */
  requestId?: string;
  /** Resolver instance for cross-provider lookups. */
  apiKeyResolver: ApiKeyResolver;
}

/**
 * Single-use gate for the system-key free-vision fallback's daily quota. The fallback LOOP
 * (`describeImageWithFallback`) resolves auth across multiple TIERS for ONE image, so the
 * per-user daily cap (`VisionFallbackQuota`) is checked at most once per tracker — a
 * per-tier consume would multiply the charge WITHIN a single image's tier walk and defeat
 * the cap. Once consumed, subsequent `tryConsume()` calls return false without touching the
 * store. Fail-open on the underlying quota error (a Redis blip shouldn't block description).
 *
 * The loop creates a FRESH tracker per attachment, so the quota meters **per image** (each
 * image that downgrades onto the system key spends one unit) — see `VisionFallbackQuota`'s
 * docstring for why per-image accounting is deliberate. The primary path (`resolveVisionConfig`)
 * likewise creates a fresh single-use tracker.
 */
export interface VisionQuotaTracker {
  tryConsume(): Promise<boolean>;
}

export function createVisionQuotaTracker(userId: string | undefined): VisionQuotaTracker {
  let consumedThisRequest = false;
  return {
    async tryConsume(): Promise<boolean> {
      if (consumedThisRequest) {
        return false;
      }
      if (userId === undefined) {
        return true; // no user to meter — fail-open (the caller's own guards apply)
      }
      let ok: boolean;
      try {
        ok = await visionFallbackQuota.tryConsume(userId);
      } catch {
        ok = true; // fail-open — a quota-store blip must not block image description
      }
      // Latch on ANY real check, not just success: an over-cap answer can't change
      // within one tracker's lifetime, so a later tier re-hitting Redis for an
      // already-denied user is pure waste (extra INCR+EXPIRE round-trips).
      consumedThisRequest = true;
      return ok;
    },
  };
}

/**
 * BROAD FREE FALLBACK — authenticated user with no key for the vision provider.
 * Downgrade to the free vision model on the system key instead of fail-fasting.
 * MUST force BOTH the free model AND its provider's key: `selectVisionModel`
 * returns the PAID fallback for authenticated users (isGuestMode=false), so
 * handing the system key to the natural model would bill the system key for a
 * paid model.
 *
 * Only a SYSTEM-key downgrade spends the owner's shared free-tier quota, so only
 * it counts against the per-user daily cap (a user on their OWN OpenRouter key
 * doesn't). Over the cap → fail-fast. `resolveApiKey` throws propagate to the
 * caller's catch (→ fail-fast). `originalVisionProvider` is carried so a
 * fail-fast names what the user actually lacked, not the free-fallback provider.
 * The `quotaTracker` gates the daily-cap consume to once per tracker (the loop calls this
 * per tier for ONE image; a fresh tracker per image = per-image accounting, see the
 * `createVisionQuotaTracker` docstring).
 */
async function resolveBroadFreeFallback(
  userId: string | undefined,
  originalVisionProvider: AIProvider,
  apiKeyResolver: ApiKeyResolver,
  quotaTracker: VisionQuotaTracker
): Promise<VisionConfigResult> {
  const freeModel = getFreeVisionFloor();
  const freeProvider = detectVisionProvider(freeModel);
  const sys = await apiKeyResolver.resolveApiKey(userId, freeProvider);
  // `sys.apiKey ?? ''` is defense-in-depth: resolveApiKey normally throws when
  // no key is available, but a misbehaving resolver returning null would
  // otherwise throw on `.length`.
  if ((sys.apiKey ?? '').length === 0) {
    logger.info(
      { userId, originalVisionProvider, freeProvider },
      'Vision free-fallback unavailable (no system key) — failing fast'
    );
    return { kind: 'failFast', provider: originalVisionProvider };
  }
  // Only a SYSTEM-key downgrade spends the shared quota; consume it at most once per
  // request via the tracker (the fallback loop may reach the free tier more than once).
  if (sys.source === 'system' && !(await quotaTracker.tryConsume())) {
    return { kind: 'failFast', provider: originalVisionProvider };
  }
  logger.debug(
    { userId, originalVisionProvider, freeProvider, freeModel, source: sys.source },
    'Authenticated user lacks vision-provider key — downgrading to free vision model on system key'
  );
  return {
    kind: 'resolved',
    config: {
      apiKey: sys.apiKey,
      provider: freeProvider,
      model: freeModel,
      // `source` is whatever resolveApiKey returned — normally 'system'; if the
      // user happens to have an OpenRouter key it'd be 'user', which is fine
      // (they ARE authenticated, just downgraded for the vision model).
      source: sys.source,
      // NOT a guest — they're authenticated, only the vision model is downgraded.
      isGuestMode: false,
    },
  };
}

/**
 * The z.ai piggyback VISION tier. Mirrors the text-slot upgrade in
 * `guestModeOverrides`: an admitted guest runs the bare piggyback model on the
 * system coding-plan key with `provider: zai-coding` so the model factory routes
 * z.ai-direct. Every denial shape — feature off, kill switch, no headroom, quota,
 * missing key, missing user, missing request anchor — returns `failFast`, which
 * the fallback loop treats as "advance to the next tier", so the guest lands on
 * today's free floor unchanged.
 *
 * The piggyback model is NEVER routed through `apiKeyResolver`: there is no
 * system ZaiCoding key in the wallet, so a resolver call would throw rather
 * than degrade.
 *
 * `requestId` is the idempotency anchor — `admit` counts per (userId, requestId)
 * (zset membership per user, SET-NX per request for the global counter), so a
 * guest whose TEXT slot already admitted this request consumes nothing extra
 * here. Pinned by `visionAuthResolver.test.ts` ("missing requestId → failFast,
 * admit never called").
 */
async function resolveZaiPiggybackVision(
  userId: string | undefined,
  requestId: string | undefined
): Promise<VisionConfigResult> {
  if (userId === undefined || requestId === undefined) {
    logger.debug(
      { userId, hasRequestId: requestId !== undefined },
      'z.ai piggyback vision tier skipped — no user or no request anchor'
    );
    return { kind: 'failFast', provider: AIProvider.ZaiCoding };
  }
  const verdict = await zaiFreeTierAdmission.admit(userId, requestId);
  if (!verdict.admitted) {
    logger.info(
      { userId, reason: verdict.reason },
      'z.ai piggyback vision tier denied — advancing to the next vision tier'
    );
    return { kind: 'failFast', provider: AIProvider.ZaiCoding };
  }
  const systemKey = zaiFreeTierAdmission.systemKey();
  if (systemKey === undefined) {
    // Admission already consumed the guest's quota share; the log line keeps a
    // vanished key distinguishable from a plain denial.
    logger.warn(
      { userId },
      'z.ai piggyback vision admitted but the system key vanished — advancing with quota consumed'
    );
    return { kind: 'failFast', provider: AIProvider.ZaiCoding };
  }
  logger.info(
    { userId, model: ZAI_FREE_TIER_MODEL },
    'Guest vision upgraded to the piggyback model on the system coding plan'
  );
  return {
    kind: 'resolved',
    config: {
      apiKey: systemKey,
      provider: AIProvider.ZaiCoding,
      model: ZAI_FREE_TIER_MODEL,
      source: 'system',
      isGuestMode: true,
    },
  };
}

/**
 * Resolve the API key + provider for a SPECIFIC vision model. Parameterized by the
 * target model so a caller can resolve auth for ANY tier (the runtime fallback
 * loop), not just the primary — a cross-provider fallback and a free-tier downgrade
 * each need their own key. `resolveVisionConfig` is the primary-model entry point that
 * computes the natural model then delegates here.
 *
 * Branch order:
 * 1. Same-provider fast path (PRIMARY tier only, and never for the piggyback model)
 *    — reuse the upstream main-model key.
 * 2. Guest (or unknown user) asking for the z.ai piggyback model — admission decides;
 *    admitted guests get the bare piggyback model on the system coding-plan key, every
 *    denial shape `failFast`s so the walk advances to the next tier. Resolved ahead of
 *    the guest free-forcing so the forcing never rewrites it.
 * 3. Genuine guest (or unknown user) — system key for the vision provider
 *    (fallback tiers force the free model — see the guest branch).
 * 4. Authenticated user with a vision-provider key — use it.
 * 5. BROAD FREE FALLBACK — authenticated user lacking a vision-provider key
 *    downgrades to the free vision model on the system OpenRouter key (instead
 *    of fail-fasting). Forces BOTH the free model AND its provider's system key
 *    so the system key never gets billed for a paid model.
 * 6. Fallback-of-fallback — if even the free-model system key is unavailable
 *    (no system OpenRouter key configured), `failFast` so the caller emits the
 *    "configure your key" placeholder against the ORIGINAL vision provider.
 *
 * `isPrimaryTier` — true only for the FIRST tier of a walk (and the primary-path
 * entry point). Fallback tiers must not take the same-provider fast path: the
 * fast path just re-hands back the identical upstream key, so after a tier-1
 * failure a same-provider tier-2 would retry the exact same credential and the
 * loop would provide zero resilience for the broken-key case it exists for.
 * Forcing per-provider resolution on fallback tiers routes an authenticated
 * user through their wallet key (or the broad free fallback) instead.
 */
export async function resolveVisionAuth(
  targetModel: string,
  options: ResolveVisionConfigOptions,
  quotaTracker: VisionQuotaTracker,
  isPrimaryTier: boolean
): Promise<VisionConfigResult> {
  const { mainProvider, mainApiKey, isGuestMode, userId, apiKeyResolver, requestId } = options;
  // Self-derive the provider from the target model rather than accepting it as a separate
  // trusted param — the per-tier fallback loop supplies only the model, and a mismatched
  // (model, provider) pair would silently resolve auth for the wrong provider.
  const visionProvider = detectVisionProvider(targetModel);

  // Same-provider fast path — reuse the upstream-resolved key without a second
  // resolver call. Avoids redundant DB reads for the common case where main and
  // vision share a provider. PRIMARY TIER ONLY — see the docstring.
  //
  // Gated on a non-empty `mainApiKey` because AuthStep's resolution-failure
  // catch branch returns `resolvedApiKey: undefined` regardless of whether the
  // failing user was authenticated or guest (the rare error path where
  // ProviderRouter.resolveRoute throws). Reusing an empty key would silently
  // reach `createChatModel` with no Authorization header and reproduce the exact
  // bug this resolver exists to prevent. Falling through to per-provider
  // resolution lets the user's actual keys (if any) be picked up instead.
  // The piggyback model is EXCLUDED from the fast path in either form. Invariant:
  // it must always reach either admission (quota + headroom + kill switch, via the
  // guest branch below) or the authenticated arm's own wallet lookup — never a
  // reuse of the upstream main key, which skips both. A guest whose TEXT slot was
  // admitted onto the piggyback arrives here with `mainProvider: ZaiCoding` and a
  // non-empty system `mainApiKey`, so without this exclusion the fast path would
  // hand the shared coding-plan key to an unmetered vision call. An authenticated
  // z.ai-BYOK user falls through to `tryResolveUserKey(userId, ZaiCoding)` instead,
  // which returns their own key — same outcome, one extra cached lookup. Pinned by
  // the "piggyback model is excluded from the same-provider fast path" tests.
  if (
    isPrimaryTier &&
    visionProvider === mainProvider &&
    mainApiKey !== undefined &&
    mainApiKey.length > 0 &&
    !isZaiFreeTierModel(targetModel)
  ) {
    logger.debug(
      { userId, visionProvider, isGuestMode },
      'Vision config same-provider fast path — reusing main-model key'
    );
    return {
      kind: 'resolved',
      config: {
        apiKey: mainApiKey,
        provider: visionProvider,
        model: targetModel,
        source: isGuestMode ? 'system' : 'user',
        isGuestMode,
      },
    };
  }

  // Defensive guard: an authenticated context (`isGuestMode === false`) that
  // nonetheless has no userId is contradictory — `tryResolveUserKey` requires a
  // userId to look up wallet entries. In practice the upstream pipeline only
  // sets `isGuestMode: false` after a successful user-key resolution (which
  // requires userId), so this branch isn't reachable from production code.
  // Logging at warn level + degrading to the guest path surfaces a regression
  // if any future caller violates the invariant without crashing the request.
  if (!isGuestMode && userId === undefined) {
    logger.warn(
      { mainProvider, visionProvider },
      'Vision config: !isGuestMode but userId undefined — degrading to guest path'
    );
  }
  const treatAsGuest = isGuestMode || userId === undefined;

  // Wrap the resolver calls so a transient throw (e.g. Redis blip inside the
  // resolver) degrades to a fail-fast placeholder rather than propagating out of
  // the caller's vision pipeline. Mirrors the try/catch the upload-time path
  // historically had in `resolveVisionApiKey`. (Model selection runs before this
  // block intentionally in `resolveVisionConfig` — `selectVisionModel`'s Redis
  // reads already degrade to a pattern-matching fallback, so a genuine throw
  // there is a real error worth surfacing, not masking as a placeholder.)
  try {
    if (treatAsGuest) {
      // The piggyback tier is resolved BEFORE the guest free-forcing below, so
      // the forcing never rewrites it to the floor regardless of tier index —
      // and the piggyback model never reaches `apiKeyResolver` (no system
      // ZaiCoding key exists there).
      if (isZaiFreeTierModel(targetModel)) {
        return await resolveZaiPiggybackVision(userId, requestId);
      }

      // Genuine guest — system key is the only path that works for them.
      // For the primary tier `selectVisionModel` already returned the free model,
      // so `targetModel` is correct as-is. FALLBACK tiers carry the stamped DB
      // models, which can be PAID (the admin's global vision default) — a guest
      // walking onto one would put the system key on a paid model, bypassing the
      // free-forcing that governs every other guest path. Force the free model
      // there; the guest's floor tier is the free model anyway, so this only
      // changes WHICH tier renders it (and the loop's resolved-model dedup then
      // collapses the duplicates into one attempt).
      const guestModel = isPrimaryTier ? targetModel : getFreeVisionFloor();
      const guestProvider = isPrimaryTier ? visionProvider : detectVisionProvider(guestModel);
      const result = await apiKeyResolver.resolveApiKey(userId, guestProvider);
      logger.debug(
        { userId, visionProvider: guestProvider, mainProvider, source: result.source },
        'Cross-provider vision config resolved (guest path)'
      );
      return {
        kind: 'resolved',
        config: {
          apiKey: result.apiKey,
          provider: guestProvider,
          model: guestModel,
          source: result.source,
          isGuestMode: result.isGuestMode,
        },
      };
    }

    // Authenticated user — try their key for the vision provider first.
    const userKey = await apiKeyResolver.tryResolveUserKey(userId, visionProvider);
    if (userKey !== null) {
      logger.debug(
        { userId, visionProvider, mainProvider, source: 'user' },
        'Cross-provider vision config resolved (authenticated user key)'
      );
      return {
        kind: 'resolved',
        config: {
          apiKey: userKey,
          provider: visionProvider,
          model: targetModel,
          source: 'user',
          isGuestMode: false,
        },
      };
    }

    // Authenticated user with no key for the vision provider → broad free
    // fallback (downgrade to the free vision model on the system key). Extracted
    // to keep this function under the line limit; runs inside this try so its
    // `resolveApiKey` throw still degrades to fail-fast via the catch below.
    return await resolveBroadFreeFallback(userId, visionProvider, apiKeyResolver, quotaTracker);
  } catch (error) {
    // Fallback-of-fallback unavailable path: `resolveApiKey` throws when no key
    // (user or system) is available for the requested provider. For the
    // authenticated free-fallback branch that means no system OpenRouter key is
    // configured → fail-fast against the original vision provider. For the guest
    // branch a throw is genuinely unrecoverable too, so fail-fast is consistent.
    logger.warn(
      { err: error, userId, visionProvider },
      'Vision config resolution failed — failing fast (no usable key for vision or free-fallback provider)'
    );
    return { kind: 'failFast', provider: visionProvider };
  }
}

/**
 * Resolve the API key + provider + model for the PRIMARY vision call atomically.
 * Computes the natural vision model via `selectVisionModel`, then delegates auth
 * resolution to `resolveVisionAuth`. (the fallback loop calls `resolveVisionAuth`
 * directly, once per tier, with that tier's model.)
 */
export async function resolveVisionConfig(
  options: ResolveVisionConfigOptions
): Promise<VisionConfigResult> {
  // Compute the natural model with the same selection logic `describeImage`
  // uses internally, so provider detection sees the actual model rather than
  // the main model (e.g. main=glm-5.1 with no native vision falls through to
  // the OpenRouter fallback model — its provider is OpenRouter, not z.ai).
  const naturalModel = await selectVisionModel(options.personality, options.isGuestMode);
  // A fresh single-use tracker → identical to the old direct per-call quota consume.
  // The primary path IS the primary tier — the fast path is legitimate here.
  return resolveVisionAuth(naturalModel, options, createVisionQuotaTracker(options.userId), true);
}
