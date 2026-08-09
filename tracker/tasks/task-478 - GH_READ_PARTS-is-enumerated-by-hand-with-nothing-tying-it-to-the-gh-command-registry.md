---
id: TASK-478
title: >-
  GH_READ_PARTS is enumerated by hand with nothing tying it to the gh command
  registry
status: Done
assignee: []
created_date: '2026-08-09 10:25'
updated_date: '2026-08-09 13:26'
labels:
  - 'area:tooling'
  - 'area:process'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 478000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: lossy-pipe-guard rule 2 protects gh READ commands from truncation, and the protected list is hand-enumerated (pr-all, pr-comments, pr-conversation, pr-info, pr-reviews, ci-gate). Nothing connects it to the registry in packages/tooling/src/commands/gh.ts, so a future gh: read wrapper is unprotected until somebody remembers this file. The failure is silent: the new command simply is not covered, and no test goes red.

The enumeration itself is deliberate and should stay. A gh:[a-z-]+ glob was tried and swept in gh:pr-edit, a WRITE command whose output is a confirmation line rather than rows that can hide a failure — that produced pure friction, blocking gh:pr-edit --help twice during authoring.

Why this is filed rather than left as the comment at the site: a code comment is not a tracking mechanism (00-critical, Out-of-Scope Items Must Be Tracked). The comment names the risk for whoever reads the line; this task is what makes it reachable by a query.

Fix shape: an agreement test in the shape of gitCommitPatternAgreement.test.ts — extract the names from GH_READ_PARTS, extract every gh: command registered in commands/gh.ts, and assert every enumerated name still exists (catches a rename or removal) and that gh:pr-edit is absent (catches the glob regression). Deciding read-vs-write for a NEW command stays human; the test pins what is already decided.

Acceptance: renaming or deleting a gh: read wrapper without updating GH_READ_PARTS fails a test.
<!-- SECTION:DESCRIPTION:END -->
