---
id: TASK-248
title: Forced-system-key rate-limit pre-check reads the wrong cache identity
status: To Do
assignee: []
created_date: '2026-07-10 00:00'
updated_date: '2026-07-28 20:35'
labels:
  - 'area:ai-worker'
  - 'size:M'
dependencies: []
priority: medium
ordinal: 248000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Forced-system-key rate-limit pre-check reads the wrong cache identity — Same provenance-vs-presence class as the #1570 incident fix, one level upstream: `selectQuotaFallbackTarget`'s `forceSystemKey` branch (`services/ai-worker/src/services/quotaFallback.ts:146-149`) checks `caches.rateLimit.isRateLimited` under the CALLER's pre-retarget `cacheKeyId` (`user:<id>`), but post-#1570 a forced-system-key invocation's own 429 is written under `system` — the pre-check reads a different Redis key than gets written, so the known-doomed fail-fast never fires for this path (one wasted doomed round trip against the shared free model; fail-safe, no wrong answer). Three funnel points share it: `quotaFallback.ts:146`, `retargetRoute.ts downgradeToFreeDefault`, `quotaFallbackRunner.ts resolveTargetAndCredentials` guestTarget — all through `selectQuotaFallbackTarget`. **Fix shape (reviewer-sketched)**: have `selectQuotaFallbackTarget` derive/accept the TARGET's identity ('system' when forceSystemKey) for the viability check instead of reusing the caller's. **Fourth instance (PR #1584 round-4 review)**: `AuthStep.resolveLlmAuthWithQuotaCheck` derives `deriveCacheKeyId(resolvedApiKey, userId)` WITHOUT `isSystemKeyRoute: true` on guest/system-key routes, so a zai-admitted guest's viability check reads `user:<id>` doom marks from their OpenRouter history — post-hoc vetoing an already-consumed zai fair-share slot (conservative over-count, but the same wrong-identity class; fix likely shared). **Fifth instance (PR #1618 review)**: the D12 floor hop's `checkModelViability` reuses the pre-downgrade `cacheKeyId` even when hop-1 forced a credential swap — same wrong-identity class, fail-safe only. **Ride-along at fix time**: reword `checkModelViability`'s JSDoc — the fail-open lives INSIDE `RateLimitCache.isRateLimited`/`CreditExhaustionCache.isCreditExhausted`'s own try/catch, not at the callers' seams; the runner's unwrapped `await selectQuotaFallbackTarget` would propagate if the caches ever stopped fail-opening internally (#1618 round-3 nit). **Promote when**: next quota-fallback touch, or if free-tier 429 storms show wasted doomed round trips. Surfaced 2026-07-10 (PR #1570 post-autosquash review).

**Why:** Fail-fast optimization gap in the exact class #1570 fixed at the invoke site.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Grounding 2026-07-28 (drain round 3): deterministic sweep found the class is WIDER than the five documented instances. All deriveCacheKeyId call sites, classified: ConversationalRAGService:185 passes isGuestMode (correct); quotaFallbackRunner:128 (feeds the funnel), autoPromotionFallback:184, promotionDemotion:69, AuthStep:149 (documented instance 4), AuthStep:231 — all omit the route flag; each needs its key-provenance traced (system vs BYOK at that point) before flipping. Funnel fix confirmed viable: selectQuotaFallbackTarget forceSystemKey branch checks rateLimit under the CALLER cacheKeyId (quotaFallback.ts ~:304) while the forced invocation writes under system. checkModelViability JSDoc may already carry part of the ride-along wording — re-check at build. All instances remain fail-safe; this is a size:M-shaped fix in billing-adjacent machinery, worth a fresh focused session.
<!-- SECTION:NOTES:END -->
