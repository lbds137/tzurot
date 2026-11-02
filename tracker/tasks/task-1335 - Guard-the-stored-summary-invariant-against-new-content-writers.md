---
id: TASK-1335
title: Guard the stored-summary invariant against new content writers
status: Done
assignee: []
created_date: '2026-11-01T13:43:00Z'
updated_date: '2026-11-02T04:03:00Z'
labels:
  - area:ai-worker
  - size:S
  - state:ready
dependencies: []
priority: medium
ordinal: 1318000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR 2689 made rendering depend on an invariant: a non-empty assistant_summary always describes the row content. It holds today (writeArchiveSummarySuccess is the only summary writer; the edit route in services/api-gateway/src/routes/user/memorySingle.ts clears it; services/api-gateway/src/services/sync/SyncUpsertBuilder.ts copies both together), but nothing enforces it. A future write path changing content without clearing the summary would silently bring back stale summaries, and every comment would still read as true. Raised by claude-review on PR 2689.
What: a cheap guard that fails when a new memory.update or UPDATE memories site sets content outside the allowlisted edit route, then keep the full argument once in docs/intent/memory-archive/memory-archive-design.md and point the code comments at it. Also, from the same review: simplify the conditional mock in packages/conversation-history/src/assistantSummaryLookup.test.ts to a plain mockResolvedValue, add service qualifiers to the cross-package paths in the assistantSummaryLookup.ts and memoryUtils.ts comments, and rewrap the long render-stamp line in the design doc.
Acceptance: a test fixture adding such a writer fails the guard; positive control on the real edit route.
<!-- SECTION:DESCRIPTION:END -->
