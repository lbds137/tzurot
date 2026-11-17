---
id: TASK-1426
title: 'PR 2755 round-2 residue: cache-breakpoint doc and test hygiene'
status: Done
assignee: []
created_date: '2026-11-16T20:31:00Z'
updated_date: '2026-11-17T19:39:00Z'
labels:
  - area:ai-worker
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1426000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Round-2 claude-review on PR 2755 (verdict: nothing blocks) left four small items, filed per the PR-economy ruling instead of buying another cycle. (1) ModelFactory.ts isAnthropicFamilyModelId JSDoc repeats the breakpoint layout from attachCacheBreakpoints (drift risk): shrink to a pointer and restore the sentence that OpenRouter scopes caching to Anthropic/Vertex/Azure/Bedrock providers (why the gate exists). (2) attachCacheBreakpoints docstring states Anthropic rejects cache_control on an empty text block: external-system claim with no probe; probe it (one OpenRouter call) or hedge, and align with the real reason the guard exists (an empty string would otherwise be wrapped into a new empty block). (3) OpenRouterFetch.test.ts markedIndices helper detects marks by substring over JSON.stringify(content): check for a block with an own cache_control property instead. (4) Add a test with a non-object entry at a target index (messages[1] = null) to pin the markMessageBlock early return. Declined in the same round: a 5m TTL on the [len-2] breakpoint (per-turn write there is 10-12 tokens in the probe, and 5m would lose reads across observed 478 s turn gaps).
<!-- SECTION:DESCRIPTION:END -->
