---
id: TASK-905
title: writeArchiveSummaryFailure writes the attempts CASE twice in one UPDATE
status: To Do
assignee: []
created_date: '2026-09-07 06:14'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 903000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: services/ai-worker/src/services/archiveSummary/archiveSummaryStore.ts computes the new attempts count in one CASE for summary_attempts and repeats the identical CASE inside the summary_status CASE that decides dead vs failed. They agree today only because the two copies are textually identical; a future edit to the match condition in one copy (another guard column, say) that misses the other would desync the count from the status it justifies. Surfaced by the #2351 round-6 review at the round cap, so filed rather than iterated.
Fix shape: compute the new count once (a WITH CTE or a subquery over the row) and reference it from both the attempts column and the status CASE, keeping the content guard and the returned affected-row count. The PGLite tests in ArchiveSummaryProcessor.component.test.ts (three failures to dead, hash reset, version-bump reset) are the canaries and must stay green unchanged.
Acceptance: one CASE expression in the writer; the component suite green; no behaviour change.
<!-- SECTION:DESCRIPTION:END -->
