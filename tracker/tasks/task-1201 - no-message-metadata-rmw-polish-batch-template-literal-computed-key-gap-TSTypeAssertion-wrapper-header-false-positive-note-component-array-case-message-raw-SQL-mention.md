---
id: TASK-1201
title: >-
  no-message-metadata-rmw polish batch: template-literal computed key gap,
  TSTypeAssertion wrapper, header false-positive note, component array case,
  message raw-SQL mention
status: To Do
assignee: []
created_date: '2026-10-10 16:05'
updated_date: '2026-10-10 16:12'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 1190000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR #2598 review rounds 4-6 (all non-blocking) converged on the same polish set instead of converging to empty; iterated to the ~6-round cap, so it merges with these dispositioned instead of another cycle.
What (all in no-message-metadata-rmw.ts/.test.ts unless noted):
- a no-expression TemplateLiteral computed key ([`messageMetadata`]) is not flagged and not in the accepted-gaps list (raised by two reviewers) - handle in keyName (single-quasi check) or document + pin
- TSTypeAssertion (angle-bracket assertion) not in TS_WRAPPERS - free add
- header lists false-negative gaps but not the false-POSITIVE direction (name-only receiver match) - one sentence
- component it.each lacks an array case ([1]::jsonb) though the docstring claims arrays are discarded
- lint message could mention raw-SQL writers among the unsanctioned
Labels: area:tooling, size:S
<!-- SECTION:DESCRIPTION:END -->
