---
id: TASK-580
title: 'release:range refinements: cap-drift comment + absent-files fixture'
status: To Do
assignee: []
created_date: '2026-08-12 23:43'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 580000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: two colocated refinements from the #2082 round-3 review, folded rather than re-cycling CI on a merged PR. (1) GH_FILES_LIST_CAP=100 is empirically derived (one probe); a code comment should acknowledge that a LOWERED gh truncation point would silently misclassify below the cap - note the drift direction, or add a periodic re-probe. (2) github-prs.test.ts covers files: [] and populated, but no fixture omits the files key entirely, so normalizeGhPr optional-chaining branch (raw.files?.map) is unexercised.

Fix shape: one comment sentence on the cap constant; one fixture without a files key asserting files === undefined survives normalization.

Acceptance: both land in the next range.ts/github-prs.ts touch. Source: #2082 round-3 review items 3-4.
<!-- SECTION:DESCRIPTION:END -->
