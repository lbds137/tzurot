---
id: TASK-645
title: >-
  Floor-hop gate ignores the inherited quota category, same dead-end one hop
  down
status: To Do
assignee: []
created_date: '2026-08-17 21:21'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 645000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: review of #2128 flagged that attemptFloorHop in quotaFallbackRunner.ts gates the bounded second hop purely on classifyQuotaFailure(retryError) === null. It does not consult opts.inheritedQuotaCategory, nor info.category which already carries the resolved category. If the hop-1 retarget retry itself fails with a non-classifiable error (another unclassifiable 4xx), the floor hop is skipped and the original error rethrows — the same dead-end shape #2128 fixed at the OUTER gate, one hop further down.

Pre-existing, not introduced or regressed by #2128; the reviewer explicitly did not ask for a fix in that PR. Risk is low because hop-1 targets are admin defaults, presumably always valid on OpenRouter, unlike the z.ai staggered-release scenario that triggers the primary bug.

Fix shape: decide whether attemptFloorHop should fall back to info.category (preferred — it is the already-resolved category for THIS retarget) or to opts.inheritedQuotaCategory, then pin it with a test that drives hop-1 failure with a non-classifiable error and asserts the floor hop is still attempted. Note the outer gate deliberately prefers LIVE classification, so keep the same precedence.

Acceptance: a hop-1 retry failing with an unclassifiable error still reaches the floor hop, pinned by a test; or the current behaviour is deliberately kept with the reason recorded in a comment at the gate.

## GROUNDING 2026-08-19 (read-only) — the premise holds, but the named fix collapses the gate

Premise verified at services/ai-worker/src/jobs/handlers/pipeline/steps/quotaFallbackRunner.ts:419:
`if (classifyQuotaFailure(retryError) === null) { return { kind: 'not-attempted' }; }`
— no consultation of `info.category` or `opts.inheritedQuotaCategory`, exactly as
filed. The outer gate's precedence is at :134,
`classifyQuotaFailure(originalError) ?? opts.inheritedQuotaCategory ?? null`.

WHAT THE FIX-SHAPE DID NOT ANTICIPATE. It says to prefer `info.category`
"(preferred -- it is the already-resolved category for THIS retarget)". But
`QuotaFallbackInfo.category` is REQUIRED, not optional
(services/ai-worker/src/services/quotaFallback.ts:84, type
`QuotaFallbackAnnounceCategory = QuotaFallbackCategory | GUEST_MODE_CATEGORY`).
So `classifyQuotaFailure(retryError) ?? info.category` can never be null, and
mirroring the outer gate's precedence does not RELAX the gate — it DELETES it.
The floor hop would be attempted after EVERY hop-1 failure.

That may well be correct: reaching this code at all means the outer gate already
resolved a quota category, so the turn is known quota-limited and the hop-1
failure's own classifiability arguably says nothing. But it is a SPEND decision,
not a null-safety tidy-up: a hop-1 failure that is not quota-shaped at all (a
genuine 5xx, a content-policy 400, a context-length error) would then buy one
more paid model call per turn. 04-discord.md's spend-idempotency section is the
neighbourhood.

So the acceptance's second arm ("or the current behaviour is deliberately kept
with the reason recorded in a comment at the gate") is live, and the choice is
three-way rather than two:
  (a) delete the gate, floor-hop on any hop-1 failure — simplest, costs one
      extra call on non-quota failures;
  (b) keep a gate but widen it to the quota-shaped-OR-inherited case, which
      needs a predicate that is not just `?? info.category` — e.g. still require
      `classifyQuotaFailure(retryError) !== null` OR that the ORIGINAL category
      came from `inheritedQuotaCategory` (the proactive-demotion case the outer
      gate's comment describes, which is the actual dead-end being reported);
  (c) keep as-is with the reason recorded.

(b) is the narrowest fix that closes the reported dead-end without widening
spend, and is my recommendation — but it is a spend-adjacent call, so it is the
owner's rather than mine. NOT started; no code written.
<!-- SECTION:DESCRIPTION:END -->
