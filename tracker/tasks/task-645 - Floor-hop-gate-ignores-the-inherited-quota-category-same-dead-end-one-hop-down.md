---
id: TASK-645
title: >-
  Floor-hop gate ignores the inherited quota category, same dead-end one hop
  down
status: Done
assignee: []
created_date: '2026-08-17 21:21'
updated_date: '2026-08-20 16:20'
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
failure's own classifiability arguably says nothing.

CORRECTION to this note's first draft, which said gate deletion would "buy one
more PAID model call per turn". That overstated the money cost on every arm,
checked against `selectFloorTarget`
(services/ai-worker/src/services/quotaFallback.ts:232):
- guest/free path: the floor is `getFreeTextFloor()`, isFreeModel-guarded
  precisely so an out-of-band settings edit cannot bill the owner. Free.
- paid path: the floor is `fallbackTextModel` (seeded `openrouter/auto`) run on
  the USER's own key, not the owner's.
- a FAILED hop bills ~nothing either way (4xx/5xx are not charged), and a
  SUCCEEDING hop returned an answer, which is the mechanism working.
- `checkModelViability` already vetoes the hop when the doom caches show the key
  credit-exhausted or rate-limited, so the most cost-sensitive states never
  reach a call at all.

The real cost is FUTILITY AND LATENCY, not owner spend. Quota failures are a
property of the model or the account, so trying another model is the right move.
But some hop-1 failures are properties of the REQUEST -- content-policy
rejection, context-length overflow, an unsupported payload -- and those fail
identically on the floor because the input is unchanged. Deleting the gate makes
every one of those buy a third full round-trip with near-zero rescue odds, on a
turn where the user has already waited through two failures. Secondary: a futile
request still burns one against the free tier's daily cap.

Counter-argument, which is why this is not clear-cut: for a plain 5xx on hop 1
the floor genuinely can rescue -- `openrouter/auto` is a router whose stated job
is to always answer. So gate deletion is not wrong across the board, only for
the request-shaped subset.

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

(b) is the narrowest fix: it closes the reported dead-end without extending the
fallback chain to failure classes it cannot fix. Recommended. With the money
side corrected above, this is closer to an ordinary engineering call than the
first draft implied — it needs the owner only for a say on the
latency-vs-rescue tradeoff. NOT started; no code written.

## OWNER DECISION 2026-08-20

Option (b) — keep a gate, widened narrowly: attempt the floor hop when the hop-1 retry's error is quota-shaped (classifyQuotaFailure !== null) OR the ORIGINAL category came from opts.inheritedQuotaCategory (the proactive-demotion dead-end actually reported). Rationale: closes the reported dead-end without extending the fallback chain to request-shaped failures (content-policy, context overflow) the floor cannot rescue; money is not at stake (floor is free for guests, user-billed otherwise), so the trade was latency-vs-rescue and the narrow gate wins it. Buildable now — slated as a beta.205 rider.
<!-- SECTION:DESCRIPTION:END -->
