---
id: TASK-87
title: >-
  Extract conditional-warning response/log helper for admin config-delete
  handlers
status: To Do
assignee: []
created_date: '2026-05-04 00:00'
updated_date: '2026-07-28 10:47'
labels:
  - 'area:voice'
  - 'area:db'
  - 'size:S'
  - 'state:dependent'
dependencies: []
priority: low
ordinal: 87000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Extract conditional-warning response/log helper for admin config-delete handlers

**Why:** Both `admin/llm-config.ts` and `admin/tts-config.ts` now have identical `responseBody`/`logFields` ternaries (clean delete vs warning-bearing). ~20 LOC + colocated tests. Companion cleanups: skip the third `prisma.user.count` query in `checkDeleteConstraints` when blocker known; normalize blocker message asymmetry. Reviewer flagged "not worth extracting at N=2." **Promote when**: a third admin config-delete handler with the same warning-discriminator shape lands, OR opportunistic alongside any admin-routes refactor pass. Surfaced 2026-05-04 PR #978. Deferred 2026-05-07.
<!-- SECTION:DESCRIPTION:END -->
