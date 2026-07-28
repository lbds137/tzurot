---
id: TASK-97
title: adoptRehydratedEntry all-terminal path may leak ordering-service state
status: To Do
assignee: []
created_date: '2026-05-16 00:00'
updated_date: '2026-07-28 10:48'
labels:
  - 'area:jobs'
  - 'area:bot-client'
  - 'size:S'
dependencies: []
priority: low
ordinal: 97000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

`adoptRehydratedEntry` all-terminal path may leak ordering-service state

**Why:** `MultiTagCoordinator.adoptRehydratedEntry` calls `orderingService.registerJob(channelId, groupId, ...)` unconditionally, then if all slots are terminal, immediately calls `flushEntry → deliverGroup → deleteEntry`. `flushEntry` invokes `orderingService.handleResult` which should process the registered job — but end-to-end cleanup hasn't been verified. **Risk**: if `ResponseOrderingService` doesn't clean up its internal tracking when `handleResult`'s deliverFn callback fires post-flush, the channel's ordering queue could retain a dangling reference, delaying or stalling other buffered messages. **Fix shape**: focused integration test exercising the all-terminal adoption path, asserting on `ResponseOrderingService`'s queue state post-flush. If a leak exists: skip `registerJob` when allDone is computable before registration, OR add an explicit cleanup call. **Promote when**: opportunistic during the next `ResponseOrderingService` touch, OR if recovery-related ordering issues surface in production logs. Surfaced 2026-05-16 PR #1034.
<!-- SECTION:DESCRIPTION:END -->
