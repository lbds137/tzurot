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

Folds (PR 2769 rounds 4–7, each re-flagged the resolve duplication): (a) check incognito BEFORE resolving the persona, so an incognito skipped author pays no DB lookup; (b) pass the guard-resolved persona into buildDeferredMemoryData (optional pre-resolved param) instead of the second resolve from skippedContext.userId; (c) consider omitting the survivor thinkingContent from skipped rows — that reasoning was about the survivor prompt, not the skipped author (round-6 #10); (d) micro: the guard condition orders skippedContent.length before historyEntry undefined — reorder so the undefined check is first and narrows the type (round-7 #8).
<!-- SECTION:DESCRIPTION:END -->
