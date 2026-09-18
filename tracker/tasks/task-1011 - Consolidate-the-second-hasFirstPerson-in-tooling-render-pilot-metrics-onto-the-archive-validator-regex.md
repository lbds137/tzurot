---
id: TASK-1011
title: >-
  Consolidate the second hasFirstPerson in tooling render-pilot-metrics onto the
  archive validator regex
status: To Do
assignee: []
created_date: '2026-09-18 06:04'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1007000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: packages/tooling/src/memory/render-pilot-metrics.ts:215 holds its own hasFirstPerson with its own regex; the archive validator (services/ai-worker/src/services/archiveSummary/archiveSummaryValidation.ts) was adapted from it and has since diverged (contraction ordering, curly apostrophes, the enumerated sentence-initial capitals). PR #2448 consolidated the two ai-worker callers onto one regex via findFirstPersonToken; the tooling copy was out of that scope. Two detectors disagreeing on the same text means the pilot metrics misreport first-person leaks silently, which is a measured cost, not a hypothetical one.
Fix shape: tooling cannot import ai-worker, so move FIRST_PERSON_REGEX + findFirstPersonToken + hasFirstPerson (and stripQuotedSpans, which they depend on) into common-types (a utils module), re-export or re-import from archiveSummaryValidation.ts, and point render-pilot-metrics.ts at it; delete the local copy; keep both call sites test-pinned (the archive tests already cover the regex; add one pilot-metrics test that reds if the local regex comes back).
Acceptance: grep -rn "hasFirstPerson" packages services finds one definition; both callers import it; tooling and ai-worker suites green.
<!-- SECTION:DESCRIPTION:END -->
