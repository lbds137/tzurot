---
id: TASK-1140
title: Release retry re-posts the blast-completed owner embed on every retry cycle
status: To Do
assignee: []
created_date: '2026-09-27 23:06'
updated_date: '2026-09-27 23:14'
labels:
  - 'area:bot-client'
  - 'area:api-gateway'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 1132000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: TASK-1133 (branch fix/release-dm-boot-race) reopens failed_transient release rows hourly for 24h by clearing the announcement's completedAt; each cycle that ends with no pending rows re-stamps completion, stampCompletionIfFinal returns a summary, and bot-client's postBlastCompletionReport posts another "Release blast completed" embed to the owner channel. A normal retry adds one embed; a row that keeps failing transiently can post up to ~24. Owner ruling 2026-09-27 (AskUserQuestion): ship TASK-1133 as is and file this dedupe.

What: post the completion embed on a retry cycle only when that cycle changed an outcome (a retry delivered, or a row turned permanent), else stay silent; the first completion always posts. Decide where the signal lives (gateway summary vs worker batch result) by reading stampCompletionIfFinal and postBlastCompletionReport; no schema change unless unavoidable (then owner call).

Acceptance: a retry cycle whose rows all fail transiently again posts no embed (test); a retry that delivers posts one; the first blast is unchanged.
<!-- SECTION:DESCRIPTION:END -->
