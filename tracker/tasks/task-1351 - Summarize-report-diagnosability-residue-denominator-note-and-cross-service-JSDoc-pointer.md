---
id: TASK-1351
title: >-
  Summarize report diagnosability residue - denominator note and cross-service
  JSDoc pointer
status: To Do
assignee: []
created_date: '2026-11-04T18:47:00Z'
labels:
  - area:tooling
  - size:S
  - state:ready
dependencies: []
priority: medium
ordinal: 1334000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
PR #2716 round-7 residue, filed at merge. (1) The failed/dead breakdown covers ALL rows for the personality while the status block failed/dead counts above it are in-window only - an operator diagnosing a stalled gate will try to match them and they will not agree; print the breakdown total beside the caption or add a window-only note. (2) The FAILED_BY_ERROR_CLASS_SQL JSDoc states ai-worker attempt rules from the tooling package without naming the source; add the pointer to writeArchiveSummaryFailure in services/ai-worker/src/services/archiveSummary/archiveSummaryStore.ts, the way ELIGIBLE_PREDICATE names its twin.
<!-- SECTION:DESCRIPTION:END -->
