---
id: TASK-223
title: 'Guard test: three protected-index registries must agree'
status: To Do
assignee: []
created_date: '2026-07-06 00:00'
labels:
  - 'area:tooling'
  - 'area:db'
dependencies: []
ordinal: 223000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Guard test: three protected-index registries must agree — `prisma/drift-ignore.json` protectedIndexes, `check-migration-safety.ts` PROTECTED_INDEXES, and `inspect-database.ts` PROTECTED_INDEXES are three hand-synced lists (memory_facts was the second table to need all three; the review caught two missing). A small tooling test asserting name-set agreement kills the drift class. **Promote when**: next tooling-touching session, or the third table joins the lists. Filed 2026-07-06 (PR #1527 review).

**Why:** ~30min; kills a recurring sync-miss class.
<!-- SECTION:DESCRIPTION:END -->
