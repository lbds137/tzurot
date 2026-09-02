/**
 * Vision fallback loop.
 *
 * Wraps the single-model `describeImage` with a runtime retry-down-the-chain: when the
 * chosen vision model FAILS on a RETRYABLE category, try the next fallback tier (the
 * gateway-stamped `visionFallbackModels`, then the hardcoded floor) before surfacing a
 * terminal placeholder. Terminate immediately on an IMAGE-intrinsic failure (content
 * filtered / censored / unreadable) — another model won't help.
 *
 * All DB resolution stays gateway-side (the tiers are stamped on the personality); this
 * loop only picks the next model + resolves its per-tier auth via `resolveVisionAuth`.
 * It NEVER throws `VisionModelError` — the loop is the boundary that turns a failure into
 * the prompt-facing `[Image … couldn't be processed …]` placeholder.
 */

import {
  AIProvider,
  isFreeModel,
  isRouterAliasModel,
  isZaiFreeTierModel,
  MODEL_DEFAULTS,
  ZAI_FREE_TIER_MODEL,
} from '@tzurot/common-types/constants/ai';
import { ApiErrorCategory } from '@tzurot/common-types/constants/error';
import { type AttachmentMetadata } from '@tzurot/common-types/types/schemas/discord';
import { type LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { getSystemSetting } from '@tzurot/common-types/services/SystemSettingsService';
import { getFreeVisionFloor } from '../freeFloors.js';
import { zaiFreeTierFailureReactor } from '../../redis.js';
import {
  describeImage,
  selectVisionModel,
  buildFailureFallback,
  VisionModelError,
  VISION_TERMINATE_CATEGORIES,
  type DescribeImageOptions,
} from './VisionProcessor.js';
import {
  resolveVisionAuth,
  createVisionQuotaTracker,
  visionAuthFailFastDescription,
  type ResolveVisionConfigOptions,
  type VisionConfig,
  type VisionQuotaTracker,
} from './visionAuthResolver.js';

const logger = createLogger('VisionFallbackLoop');

/**
 * Cap on the composed base chain per attachment — each tier is a ~1-3s + $ API
 * call. Not an absolute ceiling on the walk: TWO cases can put the tier count
 * one above this, with the loop's resolved-model dedup bounding the
 * actually-attempted calls either way.
 *
 * 1. The guest piggyback hoist (see `composeWalkTiers`).
 * 2. A non-guest chain whose CAPPED tail is a router alias (`ROUTER_ALIAS_MODELS`:
 *    `openrouter/auto` or `openrouter/free`) gets the concrete
 *    `MODEL_DEFAULTS.VISION_FALLBACK` appended after it, so the chain never ends
 *    on a router (see `appendConcreteTerminal`).
 */
const MAX_VISION_FALLBACK_TIERS = 3;

/**
 * Outcome of a single resolved tier:
 * - `resolved` — return this string (a real description, OR a terminate-category placeholder
 *   the image itself earned — no other tier would do better).
 * - `advance` — this tier failed on a retryable category; try the next one.
 */
type TierOutcome =
  | { kind: 'resolved'; description: string }
  | { kind: 'advance'; category: ApiErrorCategory; routedModel?: string };

/**
 * Run one already-resolved tier: describe, or classify its failure into terminate-vs-advance.
 * `onTierFailure` is invoked with the underlying provider error before classification —
 * used only for the z.ai piggyback tier, whose account/window failures must arm the
 * free-tier kill switch (the text path arms it through `quotaFallbackRunner` instead).
 */
async function runVisionTier(
  config: VisionConfig,
  attachment: AttachmentMetadata,
  personality: LoadedPersonality,
  describeOptions: DescribeImageOptions,
  onTierFailure?: (error: unknown) => Promise<void>
): Promise<TierOutcome> {
  try {
    const description = await describeImage(
      attachment,
      personality,
      config.isGuestMode,
      config.apiKey,
      {
        ...describeOptions,
        model: config.model,
        provider: config.provider,
        // Retry-loop semantics: honor only ATTACHMENT-BOUND cached failures (a model
        // genuinely dead for this image); let transient cached failures re-attempt.
        skipNegativeCache: true,
        // The loop IS the boundary: make describeImage throw the typed error on BOTH a fresh
        // failure AND a negative-cache hit, so a cached placeholder isn't mistaken for success.
        throwOnFailure: true,
      }
    );
    return { kind: 'resolved', description };
  } catch (error) {
    if (onTierFailure !== undefined) {
      // `VisionModelError` wraps the provider error; the reactor classifies on the
      // provider's own business code, so hand it the cause when there is one.
      await onTierFailure(error instanceof VisionModelError ? (error.cause ?? error) : error);
    }
    if (!(error instanceof VisionModelError)) {
      // Non-vision throw raised OUTSIDE invokeVisionModel's try — e.g. createChatModel's
      // synchronous missing-key throw, or a malformed-URL TypeError. The loop is the
      // graceful-degradation boundary (callers rely on "never throws" for per-image
      // isolation), so advance to the next tier rather than propagate and fail the batch.
      logger.error(
        { err: error, model: config.model, attachmentId: attachment.id },
        'Vision tier threw a non-VisionModelError — advancing to the next fallback model'
      );
      return { kind: 'advance', category: ApiErrorCategory.UNKNOWN };
    }
    if (VISION_TERMINATE_CATEGORIES.has(error.category)) {
      logger.info(
        { attachmentId: attachment.id, model: config.model, category: error.category },
        'Vision terminate category — image itself rejected, not retrying other tiers'
      );
      return {
        kind: 'resolved',
        description: buildFailureFallback(error.category, config.source, attachment.name),
      };
    }
    logger.info(
      { attachmentId: attachment.id, model: config.model, category: error.category },
      'Vision tier failed on a retryable category — advancing to the next fallback model'
    );
    return { kind: 'advance', category: error.category, routedModel: error.routedModel };
  }
}

/**
 * Guarantee that a paid chain never ENDS on a router alias.
 *
 * A router alias (`ROUTER_ALIAS_MODELS`: `openrouter/auto` or `openrouter/free`)
 * resolves to some other model at call time, so when it is the last tier and it
 * fails there is nothing concrete left to try — the shape that exhausts a chain
 * with no description. Either alias can reach the tail on a non-guest chain: the
 * paid floor setting is schema-validated against `ROUTER_ALIAS_MODELS`, so an
 * operator may configure either one. The check runs POST-cap on the capped
 * tail, so it fires no matter which source put the alias there: the
 * system-setting floor, or a gateway-stamped `visionFallbackModels` entry that
 * outlived the floor once the cap trimmed it. The concrete
 * `MODEL_DEFAULTS.VISION_FALLBACK` is appended and is allowed to sit ONE tier
 * above `MAX_VISION_FALLBACK_TIERS`.
 *
 * An alias that is NOT the tail already has something concrete after it and
 * gets nothing. Guest chains get nothing either — the free floor is a billing
 * firewall (`freeFloors.ts`), and per-tier auth would force a paid successor
 * back to it anyway, adding a tier that always collapses. Pinned by the
 * `composeVisionTiers` router-alias tests.
 */
function appendConcreteTerminal(capped: string[], isGuestMode: boolean): string[] {
  if (isGuestMode || !isRouterAliasModel(capped[capped.length - 1])) {
    return capped;
  }
  if (capped.includes(MODEL_DEFAULTS.VISION_FALLBACK)) {
    return capped;
  }
  return [...capped, MODEL_DEFAULTS.VISION_FALLBACK];
}

/**
 * Compose the ordered, deduped tier list for one attachment: the resolved primary model
 * (the gateway-stamped `visionModel` or `selectVisionModel`, which already folds in the
 * native-main-model + hardcoded picks) → the stamped DB fallbacks (`visionFallbackModels`)
 * → the hardcoded floor. Capped at `MAX_VISION_FALLBACK_TIERS` so the worst case is a
 * bounded number of API calls.
 *
 * NOTE the cap can trim the TAIL: with a primary + 2 stamped fallbacks (the max — the global
 * + free vision defaults), the hardcoded floor is the 4th item and gets sliced off. That's
 * acceptable because the stamped FREE vision default already fills the free-tier last-resort
 * role when present; the hardcoded floor only needs to survive when there's ≤1 stamped
 * fallback (then it stays within the top 3). See the `caps the tier list at 3` test.
 *
 * A ROUTER ALIAS must never be the last paid tier: when a router alias
 * (`ROUTER_ALIAS_MODELS`: `openrouter/auto` or `openrouter/free`) fails
 * there is nothing concrete left to try, which is how a two-tier chain exhausts
 * with no description. That rule is applied AFTER the cap, to whatever source
 * put the alias at the capped tail — the system-setting floor, or a stamped
 * fallback that outlived the floor the cap trimmed. When the tail is the alias
 * on a non-guest walk, `MODEL_DEFAULTS.VISION_FALLBACK` is appended and the
 * chain is allowed to run ONE tier over the cap rather than lose its concrete
 * terminal. An alias mid-chain gets nothing (something concrete already follows
 * it), and guest composition is untouched — its free floor is a billing
 * firewall (`freeFloors.ts`). See {@link appendConcreteTerminal}; pinned by the
 * `composeVisionTiers` router-alias tests.
 *
 * That concrete default is a PAID model, but composition emits model NAMES
 * only: per-tier auth resolution is what keeps a guest or a keyless user off it
 * (`resolveVisionAuth` forces the free floor on every non-primary guest tier,
 * and `resolveBroadFreeFallback` downgrades a keyless authenticated user onto
 * the free model on the system key). Pinned for this exact model by the
 * `visionAuthResolver.test.ts` cases `forces the free model for a GUEST on the
 * concrete vision fallback tier` and `downgrades the concrete vision fallback
 * to the free model on the system key for a keyless user`.
 *
 * BYOK reordering is NOT this function's job — `walkFallbackChain` applies
 * `sinkFreeRouteFallbacks` lazily, only once the primary tier has already failed.
 *
 * The guest piggyback tier is NOT this function's job either: `composeWalkTiers`
 * derives the guest walk from this finished output, hoisting the piggyback tier
 * to the front and removing any flash member already present. A flash-free
 * chain here is therefore unchanged below the hoisted tier, while a
 * flash-bearing one has that member relocated rather than left in place.
 */
export function composeVisionTiers(
  primaryModel: string,
  personality: LoadedPersonality,
  isGuestMode: boolean
): string[] {
  // The floor is the paid model unless we KNOW this is a guest. Even a caller that
  // under-reports guest-ness here degrades safely: the paid floor is only a MODEL NAME at
  // this composition step; when the loop actually reaches it, resolveVisionAuth downgrades a
  // keyless user onto the free model on the system key anyway (broad-free-fallback). So a
  // "wrong" isGuestMode picks a floor model name that auth-time resolution converges to free.
  const floor = isGuestMode ? getFreeVisionFloor() : getSystemSetting('fallbackVisionModel');
  const ordered = [primaryModel, ...(personality.visionFallbackModels ?? []), floor];
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const model of ordered) {
    if (model.length > 0 && !seen.has(model)) {
      seen.add(model);
      deduped.push(model);
    }
  }
  return appendConcreteTerminal(deduped.slice(0, MAX_VISION_FALLBACK_TIERS), isGuestMode);
}

/**
 * BYOK ordering: with a user OpenRouter key on file, paid fallbacks outrank free
 * routes — a free-route tier 429ing before the user's own paid route is ever tried is
 * the 7da570d8 incident shape. Stable partition of the FALLBACKS only (membership and
 * the cap are settled by `composeVisionTiers` first); the primary always stays first,
 * because an explicitly configured primary wins even when it is a free route.
 *
 * The sink is provider-agnostic while the key evidence is OpenRouter-only — a mixed
 * z.ai-paid + openrouter/free tail gets its z.ai tier promoted on the strength of an
 * unrelated OpenRouter key. Accepted slop: per-tier auth resolution still fail-fasts
 * a provider the user has no key for, and the broad free fallback catches the rest.
 * Exported for the ordering unit tests; production reaches it via `maybeReorderFallbacks`.
 */
export function sinkFreeRouteFallbacks(tiers: string[]): string[] {
  const [primary, ...rest] = tiers;
  return [primary, ...rest.filter(model => !isFreeModel(model)), ...rest.filter(isFreeModel)];
}

/**
 * Lazily apply the BYOK reorder once the walk is past the primary tier: probe the
 * wallet only when the fallback tail contains BOTH a free route and a paid one
 * (otherwise the reorder is a no-op), and only for authenticated users — the resolver
 * deliberately does not cache negative key lookups, so a probe that cannot change the
 * order would cost keyless users a guaranteed DB read.
 *
 * Accepted double-read: when tier 0 was OpenRouter-routed off the fast path, its own
 * `resolveVisionAuth` already asked the resolver for this same (userId, OpenRouter)
 * key, and for a keyless user that negative wasn't cached — so this probe re-reads the
 * DB once in that shape. Threading tier 0's auth result here would couple the walk to
 * resolver internals to save one SELECT on an already-failing multi-call path; pinned
 * by the wiring test's call-count assertion (`visionFallbackChain.test.ts`, scenario 5).
 */
async function maybeReorderFallbacks(
  tiers: string[],
  authOptions: ResolveVisionConfigOptions
): Promise<string[]> {
  // A prepended piggyback tier only exists for guests (composeWalkTiers), and for them
  // `tiers[0]` is the piggyback model, not the primary tier this reorder assumes it's
  // sinking free routes AROUND — the boundary the function hardcodes below no longer
  // holds. Guests also never carry the wallet OpenRouter key this reorder exists to
  // honor, so skipping it costs a genuine guest nothing (userHasOpenRouterKey's own
  // `authOptions.isGuestMode` guard already returns false for them independently).
  if (authOptions.isGuestMode) {
    return tiers;
  }
  const fallbackTail = tiers.slice(1);
  const reorderCouldMatter =
    fallbackTail.some(isFreeModel) && fallbackTail.some(model => !isFreeModel(model));
  if (!reorderCouldMatter) {
    return tiers;
  }
  if (!(await userHasOpenRouterKey(authOptions))) {
    return tiers;
  }
  return sinkFreeRouteFallbacks(tiers);
}

/**
 * Describe an image, retrying down the vision fallback chain on a retryable failure.
 * Returns a description string on success, or a `[Image … couldn't be processed …]`
 * placeholder when a tier hits a terminate category or the whole chain is exhausted. **NEVER throws** — it is
 * the graceful-degradation boundary its callers rely on for per-image isolation, so any
 * unexpected error degrades to a generic placeholder rather than failing the whole batch.
 */
export async function describeImageWithFallback(
  attachment: AttachmentMetadata,
  personality: LoadedPersonality,
  authOptions: ResolveVisionConfigOptions,
  describeOptions: DescribeImageOptions = {}
): Promise<string> {
  try {
    return await walkFallbackChain(attachment, personality, authOptions, describeOptions);
  } catch (error) {
    // Belt-and-suspenders for the "never throws" contract: anything the per-tier loop
    // doesn't catch (e.g. selectVisionModel's Redis call throwing) degrades to a generic
    // placeholder instead of propagating and failing the whole batch of attachments.
    logger.error(
      { err: error, attachmentId: attachment.id },
      'Vision fallback loop threw unexpectedly — rendering generic fallback'
    );
    return buildFailureFallback(ApiErrorCategory.UNKNOWN, undefined, attachment.name);
  }
}

/**
 * Whether the user has their OWN OpenRouter key on file (not necessarily funded or
 * valid — a bad key still fails gracefully per tier and advances down the chain).
 * OpenRouter is the right wallet to probe because the free routes are all OpenRouter
 * routes and the stamped paid fallbacks are OpenRouter routes in practice; were one
 * not, the reorder is only a preference — per-tier auth resolution still failFasts
 * and advances. Any resolver error degrades to false (today's ordering). Called at
 * most once per chain walk; the resolver caches positive results but deliberately
 * not negatives, which is why the caller gates the probe on the reorder mattering.
 */
async function userHasOpenRouterKey(authOptions: ResolveVisionConfigOptions): Promise<boolean> {
  if (authOptions.isGuestMode || authOptions.userId === undefined) {
    return false;
  }
  try {
    const key = await authOptions.apiKeyResolver.tryResolveUserKey(
      authOptions.userId,
      AIProvider.OpenRouter
    );
    return key !== null;
  } catch (error) {
    logger.debug(
      { err: error, userId: authOptions.userId },
      'OpenRouter key probe failed — keeping the default vision tier order'
    );
    return false;
  }
}

/**
 * Compose the tier list plus the index of the REAL primary tier for one walk.
 * Eligibility for the guest piggyback vision tier is deliberately NOT gated on
 * `zaiFreeTierAdmission.isEnabled()`: a disabled admission denies synchronously
 * inside `resolveVisionAuth` with no I/O, and keeping the gate to inputs the loop
 * already holds avoids a second Redis singleton dependency here. `userId` is
 * required to meter at all, and `requestId` is the idempotency anchor admission
 * counts by — without one the tier is skipped rather than admitted unanchored.
 *
 * Postcondition, for an ELIGIBLE walk: `tiers[0]` is always the bare
 * `ZAI_FREE_TIER_MODEL`, exactly one member of `tiers` satisfies
 * `isZaiFreeTierModel`, and the remainder is `composeVisionTiers`'s finished
 * output with every flash member (bare or `z-ai/`-prefixed) removed, order
 * otherwise preserved. This holds whether the chain arrived with no flash
 * member, a bare-flash primary, or a flash tier stamped anywhere in the DB
 * fallbacks — a chain-resident flash is normalized into the single hoisted
 * tier rather than left in place, which would otherwise send the walk through
 * admission twice for one image. An INELIGIBLE walk returns `composeVisionTiers`'s
 * output untouched, with `primaryTierIndex` 0.
 *
 * `primaryTierIndex` follows the model the chain actually SELECTED as primary,
 * not positionally: it is `isZaiFreeTierModel(base[0]) ? 0 : 1`. When the
 * chain's own primary already IS the piggyback id (an explicit
 * `describeOptions.model` override, in bare or prefixed form), that model keeps
 * index 0 even after hoisting — hoisting a tier that's already first is a no-op
 * on order. When flash was hoisted in front of a DIFFERENT primary, that
 * primary now sits at index 1. Primary-tier semantics (the same-provider fast
 * path, and exemption from the guest fallback-tier free-forcing) must travel
 * with the model the chain actually selected: reading `tiers[0]` unconditionally
 * would mark a possibly-PAID stamped fallback as primary and resolve the system
 * key for it. Pinned by the "bare-flash primary: the paid stamped fallback
 * stays a NON-primary guest tier" test.
 *
 * Because the tail is `base` minus its flash member(s), it can be one entry
 * SHORTER than `base`, so the hoisted tier can push the total back up to
 * `MAX_VISION_FALLBACK_TIERS` and, when `base` was already at the cap, one over
 * it — the loop's resolved-model dedup keeps the actually-attempted API calls
 * bounded regardless.
 *
 * Exported for the tier-composition unit tests; production reaches it via
 * `walkFallbackChain`.
 */
export function composeWalkTiers(
  primaryModel: string,
  personality: LoadedPersonality,
  authOptions: ResolveVisionConfigOptions
): { tiers: string[]; primaryTierIndex: number } {
  const isGuestMode = authOptions.isGuestMode;
  const piggybackEligible =
    isGuestMode && authOptions.userId !== undefined && authOptions.requestId !== undefined;
  const base = composeVisionTiers(primaryModel, personality, isGuestMode);
  if (!piggybackEligible) {
    return { tiers: base, primaryTierIndex: 0 };
  }
  const flashIsExplicitPrimary = base.length > 0 && isZaiFreeTierModel(base[0]);
  return {
    tiers: [ZAI_FREE_TIER_MODEL, ...base.filter(model => !isZaiFreeTierModel(model))],
    primaryTierIndex: flashIsExplicitPrimary ? 0 : 1,
  };
}

/**
 * Only the piggyback tier arms the z.ai free-tier reactor: a BYOK z.ai user's
 * own plan state is theirs, and only a system-key guest tier can be the shared
 * coding plan.
 */
function isPiggybackTierConfig(config: VisionConfig): boolean {
  return config.isGuestMode && config.source === 'system' && isZaiFreeTierModel(config.model);
}

/** Outcome of attempting ONE tier index, folding the failFast/dedup/run branching. */
type TierAttempt =
  | { kind: 'skip' }
  | { kind: 'resolved'; description: string }
  | {
      kind: 'advance';
      category: ApiErrorCategory;
      source: 'user' | 'system';
      routedModel?: string;
    };

/** Inputs for {@link attemptTier}, bundled to stay under the parameter-count limit. */
interface AttemptTierOptions {
  tierIndex: number;
  primaryTierIndex: number;
  tierModel: string;
  attempted: Set<string>;
  authOptions: ResolveVisionConfigOptions;
  quota: VisionQuotaTracker;
  attachment: AttachmentMetadata;
  personality: LoadedPersonality;
  describeOptions: DescribeImageOptions;
}

/**
 * Resolve + (maybe) run one tier index. `skip` covers both a failFast auth
 * result and a dedup hit — neither counts as an attempt, so the caller's
 * `lastAttempt` must not update for either.
 */
async function attemptTier(options: AttemptTierOptions): Promise<TierAttempt> {
  const {
    tierIndex,
    primaryTierIndex,
    tierModel,
    attempted,
    authOptions,
    quota,
    attachment,
    personality,
    describeOptions,
  } = options;
  // Only the FIRST (real primary) tier may take the same-provider fast path
  // (reuse the upstream main key) — a fallback tier re-handing back the
  // identical key would retry the exact credential that just failed and
  // defeat the loop's resilience purpose.
  const auth = await resolveVisionAuth(
    tierModel,
    authOptions,
    quota,
    tierIndex === primaryTierIndex
  );
  if (auth.kind === 'failFast' || attempted.has(auth.config.model)) {
    return { kind: 'skip' };
  }
  attempted.add(auth.config.model);

  // `.catch` keeps the reactor fail-soft — the walk must proceed regardless.
  const onTierFailure = isPiggybackTierConfig(auth.config)
    ? (error: unknown) => zaiFreeTierFailureReactor(error).catch(() => undefined)
    : undefined;
  const outcome = await runVisionTier(
    auth.config,
    attachment,
    personality,
    describeOptions,
    onTierFailure
  );
  if (outcome.kind === 'resolved') {
    return { kind: 'resolved', description: outcome.description };
  }
  return {
    kind: 'advance',
    category: outcome.category,
    source: auth.config.source,
    routedModel: outcome.routedModel,
  };
}

async function walkFallbackChain(
  attachment: AttachmentMetadata,
  personality: LoadedPersonality,
  authOptions: ResolveVisionConfigOptions,
  describeOptions: DescribeImageOptions
): Promise<string> {
  const isGuestMode = authOptions.isGuestMode;
  const primaryModel =
    describeOptions.model !== undefined && describeOptions.model.length > 0
      ? describeOptions.model
      : await selectVisionModel(personality, isGuestMode);

  const walkTiers = composeWalkTiers(primaryModel, personality, authOptions);
  let tiers = walkTiers.tiers;
  const primaryTierIndex = walkTiers.primaryTierIndex;
  const quota = createVisionQuotaTracker(authOptions.userId);
  // Dedup by the RESOLVED model: the broad-free-fallback can collapse several distinct
  // tiers onto the same free model, and re-invoking the same (model, attachment) is what
  // the negative cache already guards — skip it here to save the redundant call.
  const attempted = new Set<string>();
  // Track the last tier that was actually ATTEMPTED (a key resolved + describeImage ran) —
  // its category AND key source. A failFast (no key for the tier) is NOT an attempt, so it
  // never contributes here; that keeps a downstream failFast from clobbering a real failure.
  // `routedModel` rides along so the exhausted-chain log names the model that
  // actually served the last failure — for a router alias the tier's model
  // string is the alias, not the id that answered. Undefined when the attempt
  // failed before any response existed.
  let lastAttempt:
    { category: ApiErrorCategory; source: 'user' | 'system'; routedModel?: string } | undefined;

  for (let tierIndex = 0; tierIndex < tiers.length; tierIndex++) {
    if (tierIndex === primaryTierIndex + 1) {
      // The reorder never touches tiers[0], so its cost (a possible wallet probe — see
      // maybeReorderFallbacks) is deferred until the primary tier has actually failed:
      // the common primary-succeeds walk pays nothing. The offset keeps "past the
      // primary" correct when a piggyback tier was prepended (for a guest the reorder
      // is a no-op anyway — the wallet probe returns false).
      tiers = await maybeReorderFallbacks(tiers, authOptions);
    }
    const attempt = await attemptTier({
      tierIndex,
      primaryTierIndex,
      tierModel: tiers[tierIndex],
      attempted,
      authOptions,
      quota,
      attachment,
      personality,
      describeOptions,
    });
    if (attempt.kind === 'skip') {
      continue; // no usable key for this tier's provider (and no free fallback), or a dedup hit — advance
    }
    if (attempt.kind === 'resolved') {
      return attempt.description;
    }
    lastAttempt = {
      category: attempt.category,
      source: attempt.source,
      routedModel: attempt.routedModel,
    };
  }

  logger.warn(
    { attachmentId: attachment.id, tiers, lastAttempt },
    'Vision fallback chain exhausted — all tiers failed'
  );
  // No tier ever resolved a key → genuine "no usable key anywhere" (incl. the system free
  // tier): the fixed "configure your key" guidance is right. Otherwise render the LAST
  // attempted failure honoring its key source — so a 401 on the SYSTEM key doesn't tell the
  // user to fix a key they don't own (buildFailureFallback maps system-source AUTH to a
  // non-blaming "temporarily unavailable" message).
  if (lastAttempt === undefined) {
    return visionAuthFailFastDescription(attachment.name);
  }
  return buildFailureFallback(lastAttempt.category, lastAttempt.source, attachment.name);
}
