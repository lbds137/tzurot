---
id: TASK-1557
title: >-
  OpenRouter routing resolver: case-normalize the pin lookup, pin refusal
  category, dedupe describeBodyType
status: Done
assignee: []
created_date: '2026-11-26T04:43:00Z'
updated_date: '2026-11-27T08:16:00Z'
labels:
  - area:ai-worker
  - size:S
  - state:ready
dependencies: []
priority: medium
ordinal: 1551000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR #2816 round-4 review (owner chose merge-as-is, these filed). (1) resolveOpenRouterProviderRouting in services/ai-worker/src/services/modelFactory/providerRouting.ts looks up PINNED_MODELS with Object.hasOwn on the raw id, while isRouteAttempted (quotaFallback.ts) lowercases via stripZaiPrefix; a config storing Z-AI/GLM-5.3-Flash silently takes the deny+ignore shape and loses the censorship pin (never unrouted). Sibling class: TASK-1248. (2) refuseUnrouted (modelFactory/OpenRouterFetch.ts) throws inside the custom fetch; which ApiErrorCategory it lands in after SDK wrapping and parseApiError is not probed (likely NETWORK, so users see a network error for a local bug). (3) refuseUnrouted calls describeBodyType twice.

What: lookup on trim().toLowerCase() with a case-variant test (wire id unchanged), or document exact-match next to the :free suffix note; add a test or hedged comment for the post-wrap category; compute describeBodyType once.

Acceptance: a Z-AI/GLM-5.3-Flash test takes the pin (or the doc states exact match); the refusal category is pinned by a test or hedged; ai-worker gates green.

Promote when: PR #2816 merges to develop.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
PR #2816 round-6 review carries (owner ruling: lows ride the next PR): (a) warnRoutingExhaustedForError fires only from LLMInvoker.ts; emit it from the vision (VisionProcessor/invokeModelGuarded) and fact-extraction failure sites too, or narrow the quotaFallback.ts doc claim; (b) USER_ERROR_MESSAGES[ROUTING_EXHAUSTED] in error.ts duplicates the SERVER_ERROR string: reference one constant; (c) move OPENROUTER_ROUTING_EXHAUSTED_PATTERNS from apiErrorParser.ts into ERROR_PATTERNS.
<!-- SECTION:NOTES:END -->
