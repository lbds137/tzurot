---
id: TASK-232
title: Read/write-phase split helper if a third command needs it
status: To Do
assignee: []
created_date: '2026-07-08 00:00'
updated_date: '2026-07-28 10:50'
labels:
  - 'origin:review'
  - 'area:bot-client'
  - 'size:S'
  - 'state:dependent'
dependencies: []
priority: low
ordinal: 232000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Read/write-phase split helper if a third command needs it — avatar.ts + voice.ts now carry the identical fetchEditableCharacter read-phase-catch → write-phase-catch shape (deliberate same-family duplication; reviewer + 2-callback ceiling agree not to extract at two copies). **Promote when**: a third command adopts the same split — prototype the kernel then. Surfaced 2026-07-08 (PR #1554 round-4 review).

**Why:** Threshold-gated extraction.
<!-- SECTION:DESCRIPTION:END -->
