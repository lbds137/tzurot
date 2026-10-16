---
id: TASK-1238
title: >-
  TASK-1226 round-6 nit residue: example 7 pronoun + anyway; archiveSummaryStore
  fixture versions
status: To Do
assignee: []
created_date: '2026-10-16 18:00'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 1226000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
PR 2626 review round 6 nit-grade items deferred at the ~6-round cap (branch was all-green at 73aa596fc): (1) Example 7's output ends 'catching up with them' — resolve to 'with Jules' per the new attribution rule, and drop 'anyway' (framing the source does not state, Faithfulness rule); (2) archiveSummaryStore.test.ts promptVersion: 1 fixtures (lines ~75-155) should read ARCHIVE_SUMMARY_PROMPT_VERSION symbolically like the processor/component tests. Files: services/ai-worker/src/services/archiveSummary/archiveSummaryPrompt.ts, archiveSummaryStore.test.ts.
<!-- SECTION:DESCRIPTION:END -->
