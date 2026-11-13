---
id: TASK-1420
title: 'Prompt caching reads zero: add explicit system-block cache breakpoint'
status: To Do
assignee: []
created_date: '2026-11-13T05:00:00Z'
labels:
  - area:ai-worker
  - size:M
  - state:ready
dependencies: []
priority: high
ordinal: 1420000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
beta.244 day-1 diagnosis 11-12/13: prompt caching writes the full premium every turn and reads zero, including a same-model pair 67s apart (turns C/D haiku: 63,432 and 61,120 written, 0 read). Verified: mechanics are prefix-based (OpenRouter docs, auto-advancing breakpoint - not exact-prompt keying); the system prompt is byte-stable four turns running (promptHashSystemCore=282a2233dde7 in every Generated response line); therefore the divergence starts at the SECOND shipped container - the cross-channel prior_conversations HumanMessage that ships first after the system message (shippedStablePrefix docstring in cacheObservability.ts). OpenRouter provider stickiness hashes the first system plus first non-system message, so a churning cc block both breaks prefix matching AND scatters requests across Anthropic endpoints - writes succeed everywhere, reads land nowhere. Remaining verification: read formatCrossChannelHistoryAsXml (services/ai-worker/src/jobs/utils/conversationUtils.ts) for per-turn-varying content (relative timestamps or a sliding group selection). Fix: explicit Anthropic-style cache_control breakpoint on the system content block (OpenRouter docs recommend explicit breakpoints for character cards and large bodies of text; limit is 4, we need 1) so reads cover the ~60k system prompt regardless of what follows it; optionally stabilize the cc render (absolute timestamps) and/or pass session_id for endpoint affinity. Cost context (Deck-reported call 11-12): broken caching costs ~2x per turn (1h write premium, no reads back) - on her haiku steady-state that is ~0.01 USD/turn, so NO rollback; keep ttl 1h (her observed turn gaps include 478s, beyond the 5m tier lifetime). Required tests: red-under-mutation pin that the system message content block carries cache_control when promptCaching is on; a cc-render determinism check (same groups in, byte-identical XML out). Acceptance: a same-model prod turn pair shows cachedPromptTokens near the system prompt size (cacheHitRatio well above 0) in the Generated response log line.
<!-- SECTION:DESCRIPTION:END -->
