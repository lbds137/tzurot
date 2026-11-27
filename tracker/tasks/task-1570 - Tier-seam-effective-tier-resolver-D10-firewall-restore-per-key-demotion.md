---
id: TASK-1570
title: 'Tier seam: effective-tier resolver, D10 firewall restore, per-key demotion'
status: In Progress
assignee:
  - tzurot-A
created_date: '2026-11-27T06:01:00Z'
labels:
  - area:ai-worker
  - size:L
  - state:ready
dependencies: []
priority: high
ordinal: 1560000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: prod 402 incident 11-27 - an authenticated free-tier user hit the PAID floor on the system OpenRouter key (quotaFallback.ts:342 keys on isGuestMode; its doc at :322-326 already states the D10 split) and the drained system workspace 402d both hops; no reply. Lila rulings via Deck: full D10 firewall (free/keyless never bill system OpenRouter on any hop); promotion runs only on the user own stored z.ai coding key, else skipped; per-key low-credit demotion INCLUDING BYOK keys (a key out of credit or erroring demotes that key to the free cascade until it recovers); low-credit requests try glm-5.3-flash z.ai-direct via the guarded piggyback, never OpenRouter. Structural ask: tier decided in ONE seam, not re-derived per site; full edge-case matrix as one table-driven test; a structural guard so new features cannot re-derive tier. Visibility ruling (Lila 11-27 via Deck, AUQ): footer-only disclosure - the existing footer announce covers demotion, no new UI.
What: PR 1 - resolveEffectiveTier computed once in AuthStep and carried on the auth object; re-key selectFloorTarget, hopOneFloorTarget, the free-ladder trigger and the promotion (own zai key else piggyback-admitted else none); matrix rows for the none/ok key states across guest/free/paid-system/BYOK x chat/promote/floor; dependency-cruiser import guard on the tier primitives. PR 2 - per-key demotion state machine: 402/401 classifier marks flip the tier per key (CreditExhaustionCache buckets, reactive TTL, no balance probe), recovery on expiry, matrix extension with low-credit/402/401/429/provider-down rows and vision/caption/retry paths.
Acceptance: a keyless free-tier request never reaches a system-key-billed model on either hop (regression test); a BYOK 402 demotes only that key; a low-credit request routes glm-5.3-flash z.ai-direct through the guarded piggyback, never OpenRouter; every matrix row the current code fails is enumerated as a finding in the PR 1 body.
<!-- SECTION:DESCRIPTION:END -->

**PR 1 shipped as #2827** — merged into develop 2026-11-27 (merge commit 9a83aed2e; 4 review rounds dispositioned, matrix 32 tests, CI 24/24 at 7a3b58e10). The checklist below + the r4 nits ride PR 2.

**PR 2 (branch `feat/task-1570-pr2-key-state`) reviewed the WHOLE checklist at producer-landing**, disposition per bullet: sites 1–3 (quotaFallback CREDIT_EXHAUSTION arm, targetCacheKeyId bucket, resolveRetryCredentials) re-keyed to billing identity (`keyProvenance` + `forceSystemKey`); sites 4–5 (enforceGuestFreeTierQuota/meterForcedFallback/reactToZaiFreeTierFailure, applyGuestModeOverrides) confirmed intended free-tier-capability and kept on `effectiveTier` — premise-ledger P4/P5 verification, including the caught seam bug (buildPostRouteLlmAuth re-deriving tier without keyState would un-demote one step after AuthStep demoted; fixed by threading keyState as a fourth parameter). Matrix rows for user-provenance + low-credit added at each site (P7: 40 matrix rows total).

## PR 2 checklist — billing-identity vs free-tier-capability split (r4 review finding #1, latent until the keyState producer)

At 2827's head `tier === 'free'` and `keyProvenance !== 'user'` are equivalent (verified by the r4 reviewer), so nothing below changes behavior today. When PR 2 lands `keyState`, each site must be classified: **billing identity** (which key bills / which doom bucket) reads `keyProvenance`; **free-tier capability** (model/floor selection, free meter, guest overrides) keeps `effectiveTier`. Review the WHOLE list together when the producer lands, not one site per round:

- `services/ai-worker/src/services/quotaFallback.ts` `selectQuotaFallbackTarget` CREDIT_EXHAUSTION arm ("the system key itself is broke" → null): for a low-credit BYOK user the broke key is the user's — forceSystemKey swap may be right, not terminal null. Billing-identity candidate.
- same function, `targetCacheKeyId = forceSystemKey || tier === 'free' ? SYSTEM_CACHE_KEY_ID : cacheKeyId`: viability must be checked under the bucket the retry actually bills. Billing-identity candidate (the D10 mismatch shape).
- `services/ai-worker/src/jobs/handlers/pipeline/steps/quotaFallbackRunner.ts` `resolveRetryCredentials` (`effectiveTier === 'free'` swaps cross-provider retry onto the system key). Billing-identity candidate.
- `services/ai-worker/src/jobs/handlers/pipeline/steps/generationStepValidation.ts` `enforceGuestFreeTierQuota` + `quotaFallbackRunner.ts` `meterForcedFallback` / `reactToZaiFreeTierFailure`: likely intended free-tier-capability (a demoted user drops to the shared free pool) — confirm against the Lila 11-27 demotion ruling.
- `services/ai-worker/src/jobs/handlers/pipeline/steps/AuthStep.ts` `preLadderTier === 'free'` → `applyGuestModeOverrides`: likely intended free-tier-capability — confirm.
- With the producer: matrix rows for `'user'`-provenance + `'free'`-tier (low-credit) at each of these sites.

Also carried from r4 (mechanical nits, ride PR 2's diff): move `provenanceFromResolution` + its tests into `services/effectiveTier.ts` (seam logic out of the pipeline-step layer) **[rode PR 2]**; `no-tier-flag-branching` ternary `consequent`/`alternate` + computed string-literal gaps (fix or document) **[filed TASK-1574]**; stale "guest semantics" JSDoc in `selectHopOneFloorTarget` + the hopOneFloorTarget header now that it owns the credential helpers **[filed TASK-1573]**; inline `resolveInvocationCacheKeyId` **[filed TASK-1573]**; rename the matrix's `keyState` column (shadows the seam parameter) e.g. to `keyPresence` **[rode PR 2]**. Also riding PR 2 from earlier rounds: the r3 #7 `retargetRoute` keyProvenance threading and the r2 CreditExhaustionCache "1 hour"→"10 minutes" JSDoc fixes.

