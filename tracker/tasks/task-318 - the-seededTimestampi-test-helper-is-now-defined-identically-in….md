---
id: TASK-318
title: Extract the duplicated seededTimestamp test helper
status: To Do
assignee: []
created_date: '2026-07-23 00:00'
updated_date: '2026-07-28 10:52'
labels:
  - 'area:conversation-history'
  - 'area:testing'
  - 'origin:review'
  - 'size:S'
dependencies: []
priority: low
ordinal: 318000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Surfaced 2026-07-23 (#1772 review, non-blocking) — the `seededTimestamp(i)` test helper is now defined identically in `ConversationSyncService.component.test.ts` and `ConversationHistoryService.component.test.ts`, and a third component test (`DuplicateDetectionFlow`) uses a separate auto-increment `seedMessage` wrapper for the same purpose — two conventions for one need. Also `futureTime = seededTimestamp(100)` is a bare magic number ("far enough future" for a `>=` window check). **Fix shape**: if/when a third conversation-history-style component test needs seeded timestamps, promote a shared test-util (single helper + a named `FAR_FUTURE_OFFSET_SECONDS`-style constant) rather than copy the 2-liner again. **Promote when**: a third file needs the seeded-timestamp helper, or a shared test-utils consolidation pass touches these files.

**Why:** Duplicated 2-line helper across 2 files is below the CPD ratchet and reasonable now; consolidation only pays off at a third consumer.
<!-- SECTION:DESCRIPTION:END -->
