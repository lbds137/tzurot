---
id: TASK-1458
title: Hoist skipped-author memory work out of the duplicate-retry loop
status: To Do
assignee: []
created_date: '2026-11-18T22:19:00Z'
labels:
  - area:ai-worker
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1458000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-66 review findings #10 and D8 (PR 2769): buildSkippedDeferredMemories sits inside generateResponse, which duplicateRetry calls once per attempt — each attempt repeats the Redis incognito check and resolvePersonaForMemory for every skipped author (up to 10 serial round trips per attempt), and only the last result is used. Additionally the ownership guard added in round 4 calls resolvePersonaForMemory once per skipped message, and buildDeferredMemoryData repeats that same resolve internally. Fix: compute per-skipped-author data once after the retry loop (GenerationStep) and pass resolve results through so the resolve runs once per author. Reviewer notes this mirrors how primary deferred data behaves, so it is minor; bounded cost. Acceptance: one incognito check and one persona resolve per skipped author per generation, tests still green.
<!-- SECTION:DESCRIPTION:END -->
