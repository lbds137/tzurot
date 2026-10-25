---
id: TASK-1288
title: Batch result lines double the severity emoji in the facts and memory flows
status: To Do
assignee: []
created_date: '2026-10-25 15:37'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 1274000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
PR 2654 round-3 finding: formatBatchItemLines adds the ❌ glyph and the note is a renderSpec string carrying its own severity emoji, so failure lines render as '❌ @lila - ❌ You do not have permission...'. The alias flow is fixed caller-side in 2654 (pass the spec plain text); factsBatch.ts ~line 379 and the memory batch flow have the same shape and are already landed. Fix both callers the same way, and add one assertion per flow that a failure line contains exactly one severity emoji (existing tests only assert toContain on the label). Acceptance: no doubled emoji in any batch result line across the three flows; tests pin it.
<!-- SECTION:DESCRIPTION:END -->
