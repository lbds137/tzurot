---
id: TASK-1438
title: >-
  Read promptCacheGate back from the model instance instead of recomputing it at
  log time
status: To Do
assignee: []
created_date: '2026-11-17T18:58:00Z'
labels:
  - area:ai-worker
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1438000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR 2760 round-3 review (nit 5). modelInvocation.ts recomputes promptCacheGate at log time via promptCacheGateFires on the resolved model and provider, rather than reading the gate the factory actually applied to the instance getModel returned. Today they agree (the cache key carries the gate result, so a hit returns an instance built under the same gate). Edge: a fallbackTextModel change between getModel and the log line, with an empty personality model, makes the log disagree with the instance. What: have createChatModel return the gate result on ChatModelResult and log that. Acceptance: the log field comes from the instance; a test changes the fallback setting between getModel and the log and still logs the instance gate.
<!-- SECTION:DESCRIPTION:END -->
