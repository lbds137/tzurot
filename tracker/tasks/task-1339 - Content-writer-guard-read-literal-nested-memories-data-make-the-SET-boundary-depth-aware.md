---
id: TASK-1339
title: >-
  Content writer guard: read literal nested memories data, make the SET boundary
  depth-aware
status: To Do
assignee: []
created_date: '2026-11-02T04:01:00Z'
labels:
  - area:tooling
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1322000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: review on PR 2694 left two matcher limits in packages/tooling/src/dev/check-memory-content-writers.ts. Both are recorded in that PR. (1) inspectNestedMemoriesChildProperty fails every nested update, updateMany or upsert under memories, even a literal data with no content, such as a soft-delete cascade through persona.update. An unverifiable finding never counts toward ALLOWED_CONTENT_WRITERS, so the only way out is a top-level prisma.memory call, and the failure text (literal argument or rename) does not fit. No such write exists today. (2) SET_CLAUSE_BOUNDARY ends the clause at any FROM, WHERE, RETURNING or semicolon, so UPDATE memories SET a = (SELECT b FROM t), content = 1 is missed, and so is a boundary word inside a string value. That is the permissive direction.

What: run a literal nested data through inspectDataObject and keep failing closed on a non-literal one, with a fixture pinning a literal non-content nested write; accept a SET clause boundary only at parenthesis depth 0 and outside a string literal, or name the shape in the header Limit paragraph if that costs more than a tripwire is worth. Also drop the redundant as const on ALLOWED_CONTENT_WRITERS.

Acceptance: both shapes have fixtures and canaries; the header names whatever remains out of reach.
<!-- SECTION:DESCRIPTION:END -->
