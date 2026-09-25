---
id: TASK-1097
title: Sweep the hand-rolled execFileSync(gh) call sites onto ghCall/GhApiError
status: To Do
assignee: []
created_date: '2026-09-25 02:29'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 1090000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: #2524 extracted `ghCall` + `GhApiError` (packages/tooling/src/gh/ghCall.ts, tested) out of ci-gate.ts; seven other files still hand-roll `execFileSync('gh', ...)` with their own error shaping: audits/health-extras.ts, dev/check-repo-settings.ts, dev/check-workflow-sync.ts, gh/ci-gate.ts (fetchRuns), gh/github-api.ts, release/finalize.ts, release/publish.ts (`grep -rln "execFileSync('gh'" packages/tooling/src --include=*.ts | grep -v .test.ts`). Surfaced by the #2524 round-3 review as a separate pass.
Fix shape: one PR; route each call through ghCall(args, timeoutMs), keep each site's own timeout and its decision about loudness (some fail open by design: reportReviewRounds, health rows), and delete the per-file copies of the stderr/signal shaping. A site whose call shape ghCall cannot express (streaming, stdin) stays and says why in a comment.
Acceptance: the grep above lists only ghCall.ts, and every touched command's tests stay green.
<!-- SECTION:DESCRIPTION:END -->
