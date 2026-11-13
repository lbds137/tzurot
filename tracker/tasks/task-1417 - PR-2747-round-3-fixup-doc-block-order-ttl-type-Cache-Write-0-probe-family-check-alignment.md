---
id: TASK-1417
title: >-
  PR 2747 round-3 fixup: doc block order, ttl type, Cache Write 0 probe,
  family-check alignment
status: Done
assignee: []
created_date: '2026-11-13T02:20:00Z'
labels:
  - area:ai-worker
  - state:ready
  - size:S
dependencies: []
priority: medium
ordinal: 1404000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Round-3 review on PR 2747 (all Low, reviewer says none block the merge - fix-forward before the beta.244 cut). 1. extendedViews.ts: move isAnthropicFamilyResponse + its JSDoc ABOVE the renderCacheHeader doc block - the stacked blocks detached renderCacheHeader's doc from its function. 2. OpenRouterExtraParams.cacheControl ttl: widen to optional 5m|1h so the PR-body graduated rollback lever (OPENROUTER_PROMPT_CACHE_CONTROL -> {type:ephemeral}) is really one line that typechecks; today ttl is required and the lever breaks typecheck mid-incident. 3. PROBE the installed LangChain dist: does prompt_tokens_details.cache_write_tokens: 0 flow through as cache_creation: 0 on non-caching responses? If yes, the summary embed shows Cache Write: 0 on every GLM/OpenAI response - gate the embed line the same way the extended view is gated (family check) + test; if no (undefined-ified), record the verified no-op in the PR residue. 4. Align the extended view family check with the worker gate: use modelUsed (what we requested) not routedModel ?? modelUsed, and fix the predicate docstring claim to we-only-request-it-there (provider-side implicit caching exists elsewhere); update the routed-precedence test to the new shape. Size:S one dispatch after the 2746 round-4 worker frees the slot.
<!-- SECTION:DESCRIPTION:END -->
