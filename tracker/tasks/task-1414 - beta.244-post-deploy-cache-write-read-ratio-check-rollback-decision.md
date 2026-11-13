---
id: TASK-1414
title: 'beta.244 post-deploy: cache write/read ratio check + rollback decision'
status: To Do
assignee: []
created_date: '2026-11-13T00:59:00Z'
labels:
  - area:ai-worker
  - state:observable
  - size:S
dependencies: []
priority: medium
ordinal: 1402000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Round-2 review finding on the prompt-caching PR: with the 1h tier, every turn writes its prompt tail at 2x. A model whose prompt prefix breaks every turn (per-turn content early in the prompt - retrieved memories, a timestamp) pays roughly double input instead of the cached curve, and nothing in the PR acts on that outcome. CHECK: 24h after the beta.244 prod deploy, per model, sum cachedWriteTokens vs sum cachedPromptTokens (cacheObservability Generated-response log lines and the diagnostic store carry both). Healthy: reads >= writes. If writes >> reads persist on a model, apply the lever recorded in the PR 2747 deploy notes: OPENROUTER_PROMPT_CACHE_CONTROL -> {type:ephemeral} (5m tier, writes 1.25x), or remove promptCaching from the modelInvocation spread (full off). Promote when: 24h after the beta.244 prod deploy. Triage hint (round-3 review): if writes >> reads on one model, check its transforms config FIRST - middle-out rewrites the prompt middle when over the context window, breaking the byte-stable prefix every turn.
<!-- SECTION:DESCRIPTION:END -->
