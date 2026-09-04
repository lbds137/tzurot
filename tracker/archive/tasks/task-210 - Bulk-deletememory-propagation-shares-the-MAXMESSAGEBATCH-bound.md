---
id: TASK-210
title: Bulk delete→memory propagation shares the MAX_MESSAGE_BATCH bound
status: To Do
assignee: []
created_date: '2026-07-05 00:00'
updated_date: '2026-09-04 20:02'
labels:
  - 'area:api-gateway'
  - 'area:conversation-history'
  - 'size:S'
  - 'state:dependent'
dependencies: []
priority: low
ordinal: 210000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Bulk delete→memory propagation shares the MAX_MESSAGE_BATCH bound

**Why:** `softDeleteMessages` soft-deletes ALL ids but the tombstone fetch (and therefore memory propagation) is bounded at 1000 — a >1000-id bulk delete would leave the tail's linked memories live. Current callers (opportunistic sync windows) are far below the bound; the code comment at the propagation call names the fix shape (unbounded id-only fetch). **Promote when**: any bulk-delete path can exceed ~1000 ids. Surfaced by #1497 review. Surfaced 2026-07-05 (dated from git history).
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 20:02
---
Pass 2026-09-04 (TASK-888 half 1), owner ruling: SUPERSEDED into doc-92 (Idea Scale gated watches — threshold inventory for the single instance ceiling); archived. The member bullet there carries the fix shape, trigger or cost, and the 2026-09-04 evidence; pnpm tracker doc search TASK-210 finds it.
---
<!-- COMMENTS:END -->
