---
id: TASK-1334
title: 'Audit batch: tooling gates that can pass too easily'
status: Done
assignee: []
created_date: '2026-11-01T11:33:00Z'
updated_date: '2026-11-02T13:02:00Z'
labels:
  - area:tooling
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1317000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: post-merge audit, read only, none reachable by accident. (1) packages/tooling/src/db/check-migration-safety.ts balanced-pair check is order-blind, so create then drop of a protected index passes, as does a create inside a never-run conditional; hand-edited SQL only, and its WHY.md documents anywhere-in-file. (2) packages/tooling/src/mutation/mutation-scoped.ts prints nothing to run when packages were skipped, and parseGitDiff drops git-quoted paths; local-only, not in CI. (3) mutation-scoped-report.ts parseTextSummary turns an unparseable cell into 0. (4) packages/conversation-history/src/historyWindow.ts Stryker disable also hides the killable <= to > mutant.
Acceptance: each fixed or ruled out with a reason.
<!-- SECTION:DESCRIPTION:END -->
