---
id: TASK-318
title: Extract the duplicated seededTimestamp test helper
status: To Do
assignee: []
created_date: '2026-07-23 00:00'
updated_date: '2026-09-04 19:39'
labels:
  - 'area:conversation-history'
  - 'area:testing'
  - 'origin:review'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 318000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Surfaced 2026-07-23 (#1772 review, non-blocking) — the `seededTimestamp(i)` test helper is now defined identically in `ConversationSyncService.component.test.ts` and `ConversationHistoryService.component.test.ts`, and a third component test (`DuplicateDetectionFlow`) uses a separate auto-increment `seedMessage` wrapper for the same purpose — two conventions for one need. Also `futureTime = seededTimestamp(100)` is a bare magic number ("far enough future" for a `>=` window check). **Fix shape**: if/when a third conversation-history-style component test needs seeded timestamps, promote a shared test-util (single helper + a named `FAR_FUTURE_OFFSET_SECONDS`-style constant) rather than copy the 2-liner again. **Promote when**: a third file needs the seeded-timestamp helper, or a shared test-utils consolidation pass touches these files.

**Why:** Duplicated 2-line helper across 2 files is below the CPD ratchet and reasonable now; consolidation only pays off at a third consumer.

**Member 2 added 2026-08-17 (#2124 review, non-blocking), and the promote-when has FIRED.** The windowed-fetch change replaced `historyService.getChannelHistory(channelId, limit)` with the free function `getChannelHistoryWindow(prisma, params)`, whose result is an object — so ~30 call sites across the SAME four files now carry an identical `(await getChannelHistoryWindow(prisma, {...})).messages` unwrap. Files: `ConversationHistoryService.component.test.ts`, `ConversationSyncService.component.test.ts`, `DuplicateDetectionFlow.component.test.ts`, `storedReference.component.test.ts`.

Fix shape for both members together: one shared component-test helper module covering the seeded timestamp AND a `fetchHistory(prisma, channelId, cap)` unwrap, rather than a per-file 2-liner each. CPD's call-dominant filter does not flag the unwrap (the ratchet passed on #2124), so this is readability, not debt — but it is now duplication this repo introduced rather than inherited, across four files that a single pass can close.

State moved `dependent` → `ready`: the original trigger was "a third file needs the helper, or a shared test-utils consolidation pass touches these files," and #2124 touched all four.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:39
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): Self-recorded trigger fired (#2124, 2026-08-17). Promoted to priority medium for the next tooling/test drain batch.
---
<!-- COMMENTS:END -->
