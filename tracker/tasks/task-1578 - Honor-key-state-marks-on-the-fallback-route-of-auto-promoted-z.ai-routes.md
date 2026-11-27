---
id: TASK-1578
title: Honor key-state marks on the fallback route of auto-promoted z.ai routes
status: To Do
assignee: []
created_date: '2026-11-27T22:23:00Z'
labels:
  - area:ai-worker
  - size:M
  - state:ready
dependencies: []
priority: low
ordinal: 1568000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR 2829 review round 3 finding 4 - preLadderKeyState reads only the primary route; an auto-promoted z.ai route carries route.fallback pointing at the user OpenRouter key, which may carry a live invalid mark. On a z.ai failure the retry-with-fallback bills a known-invalid key (one wasted 401 per such turn; throwIfCreditExhausted covers the low-credit sibling only). What: consult the doom marks for the OpenRouter fallback route - either an AuthStep read of the fallback key state or a GenerationStep pre-retry gate mirroring throwIfCreditExhausted for the invalid class. Acceptance: unit test showing the fallback retry skips a marked key and takes the next rung.
<!-- SECTION:DESCRIPTION:END -->
