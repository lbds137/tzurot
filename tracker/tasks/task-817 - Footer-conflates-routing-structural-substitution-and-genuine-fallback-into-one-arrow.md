---
id: TASK-817
title: >-
  Footer conflates routing, structural substitution, and genuine fallback into
  one arrow
status: Done
assignee: []
created_date: '2026-08-29 14:34'
updated_date: '2026-08-30 04:22'
labels:
  - 'area:bot-client'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 817000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner design direction 2026-08-29, verbatim: "I actually think we shouldn't be doing the fallback display for free users the way we are now - it shouldn't show the paid to free fallback arrow. only free to free prime if the original requested model is a router or otherwise wasn't served directly (and I like the parenthetical reason too - for routers, it should maybe be distinct to indicate to users in a shorthand way - maybe 'routed' or 'autorouted' or something that is understandable without verbosity)".

THE UNDERLYING PROBLEM, which the owner's two asks are both instances of: the footer renders THREE different events in one visual grammar. `buildModelFooterText` (packages/common-types/src/constants/discord.ts:442, options at :338) emits `Model: <from> → <to> (<reason>)` whenever `quotaFallback` is set, and `QUOTA_FALLBACK_REASON` (:379, verified at read time) lists `guest_mode: 'guest mode'` in the same table as `rate limited`, `out of credit`, `model refused`. So a free user's STRUCTURAL substitution — which happens on every single turn and is not news — renders identically to a model that actually failed.

The three cases that need distinct treatment:
1. STRUCTURAL substitution (guest_mode): the user is on the free tier, their configured paid model was never going to be served. Not an incident. Owner: do not render the arrow.
2. ROUTING (`openrouter/auto` and other router aliases resolving to a concrete model): not a failure at all, the alias did its job. Owner wants this VISUALLY DISTINCT and terse — candidate wording "routed" or "autorouted". Note this needs `routedModel`, shipped in #2247, and overlaps TASK-809 which renders the same fact in `/inspect`; do them together or at least decide the vocabulary once.
3. GENUINE fallback (rate limit, credit, model unavailable, refusal): a real incident. Keep today's arrow and keep the parenthetical reason — the owner explicitly likes it, and the existing design note is right that a silent model swap reads as a bug.

Prior art in the same file, do not re-derive: #2243 already carved out a fourth case — `namesSameModel` (:394) collapses the arrow when `from` and `to` are the `z-ai/`-prefixed and bare spellings of ONE model, because that is a route change, not a model change. That is this same instinct applied narrowly; the fix here generalizes it rather than replacing it.

SECOND OWNER ASK, same session, and the recommendation DIFFERS from what was proposed — owner explicitly invited disagreement ("unless you materially disagree and have a better idea"). Verbatim: "I noticed some free users have stale model overrides - those are presets that used to be free on OpenRouter but were removed from the free tier ... we should maybe sweep and clear any currently non free overrides for free users ... maybe it's overreach but it kinda bugs me. we can leave them alone too."

RECOMMENDATION: do NOT sweep or clear. Reasons, in order of weight:
- The owner's own premise argues against it: the free lineup "changes all the time". A sweep on Monday deletes a preference that becomes valid again on Friday, so the churn makes clearing MORE destructive, not less.
- It is irreversible and lossy. A user who later brings their own key loses a considered choice and must re-pick.
- It contradicts the owner's standing instinct recorded on doc-8: "I don't want to delete anything."
- It is unnecessary. The runtime already free-forces (guestModeOverrides.ts, AuthStep.ts), so the stored value is inert. These are not STALE data, they are DORMANT PREFERENCES: harmless while the user is on the free tier, correct again the moment they are not.

The owner's own third clause is the complete fix and makes the sweep moot: non-free overrides for free users should be ignored at resolution AND not rendered in the footer as a fallback. That is case 1 above.

If a lever is still wanted, prefer an admin REPORT (which free users hold currently-non-free overrides) over an admin mutation — same visibility, nothing destroyed. Note that any such report is a point-in-time read against a catalog that moves, so it informs, it never gates.

Acceptance: the three cases above render distinguishably; a free user on the free tier sees no paid-to-free arrow; a router-resolved turn is marked with the agreed shorthand rather than an incident arrow; a genuine fallback keeps arrow plus parenthetical reason; the `namesSameModel` collapse still holds. Each case pinned by a test, and the guest_mode arm proven able to fail (it is the one whose absence is the feature). Non-free overrides on free accounts are ignored at resolution with NO destructive sweep; if an admin surface is built it is read-only. Vocabulary for case 2 is an owner wording call — "routed" is the working default.
<!-- SECTION:DESCRIPTION:END -->
