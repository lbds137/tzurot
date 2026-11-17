---
id: TASK-1439
title: TTLCache injected-clock seam and prompt-cache comment residue from PR 2760
status: To Do
assignee: []
created_date: '2026-11-17T19:38:00Z'
labels:
  - area:ai-worker
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1439000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR 2760 round-4 review (nothing blocking; filed at the step-back point). What: (1) in packages/common-types/src/utils/TTLCache.ts, set lru-cache ttlResolution to 0 when a now clock is injected, so the injected-clock tests in TTLCache.test.ts and LLMInvoker.test.ts (T1) stop needing a 1 ms timer advance after each clock move; then drop those advances and their comments. (2) Keep the session-id pseudonymization rationale once, on ModelConfig.sessionId in services/ai-worker/src/services/modelFactory/types.ts, and point to it from the modelInvocation.ts call site. (3) Pin that buildModelSamplingConfig always sets provider (unset personality.provider gives AIProvider.OpenRouter) with a one-line RAGUtils test, then drop the hedge in the modelInvocation.ts promptCacheGate comment. Acceptance: both clock tests pass without timer advances; one copy of the rationale; the provider claim pinned by a named test.
<!-- SECTION:DESCRIPTION:END -->
