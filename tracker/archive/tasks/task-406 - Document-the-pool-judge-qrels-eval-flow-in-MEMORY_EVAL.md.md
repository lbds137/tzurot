---
id: TASK-406
title: Document the pool/judge/qrels eval flow in MEMORY_EVAL.md
status: To Do
assignee: []
created_date: '2026-08-03 00:40'
updated_date: '2026-09-04 20:08'
labels:
  - 'area:docs'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 406000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: MEMORY_EVAL.md documents only eval:memory, but the mine -> pool -> judgment-sheet -> qrels -> score loop is now the backbone of 4+ harnesses (fold, fact, allocation, voice-consistency) and exists nowhere as prose; each new harness re-derives the conventions from the previous ones.
Fix shape: one section in docs/reference/testing/MEMORY_EVAL.md covering the loop, the "runner is eval-only, math is committed + CI-tested" convention, the prefix-keyed qrels + reconcile ambiguity contract, and the blinded owner-sheet variant the voice harness added.
Acceptance: a new harness author can follow the doc without reading a sibling harness end-to-end.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 20:08
---
Pass 2026-09-04 (TASK-888 half 1), owner ruling: SUPERSEDED into doc-96 (Idea Doc lifecycle chores — retire distill document); archived. The member bullet there carries the fix shape, trigger or cost, and the 2026-09-04 evidence; pnpm tracker doc search TASK-406 finds it.
---
<!-- COMMENTS:END -->
