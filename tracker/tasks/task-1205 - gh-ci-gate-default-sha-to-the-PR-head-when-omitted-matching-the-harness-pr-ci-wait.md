---
id: TASK-1205
title: >-
  gh:ci-gate: default --sha to the PR head when omitted, matching the harness
  pr-ci-wait
status: Done
assignee: []
created_date: '2026-10-11 11:07'
updated_date: '2026-10-11 15:19'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1194000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: gh:ci-gate requires --sha (ci-gate.ts validateGateArgs). Session mining (2026-10-11) counted 3 bad-SHA recoveries from hand-typed or hand-extended SHAs across ~76 monitor arms. The harness port (seyag bin/pr-ci-wait resolve_sha) already treats an omitted --sha as the PR head and logs that it did. Keeping the two semantics identical also shrinks TASK-1119 (retiring gh:ci-gate for pr-ci-wait).

What: make --sha optional; when omitted, read pulls/N head.sha (fetchPrHeadSha), log one line saying so, and fail with a usage error if the head cannot be read. Keep every explicit-SHA check. Add the trigger line to /tzurot-git-workflow: never type a SHA; use the substitution or omit the flag. The canonical monitor command (three copies, guard:monitor-command) stays unchanged.

Acceptance: unit tests for omitted/explicit/unreadable-head; OPS_CLI_REFERENCE row updated; guard:ops-doc and guard:monitor-command green.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Shipped in #2602.
<!-- SECTION:NOTES:END -->
