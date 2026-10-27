---
id: TASK-1313
title: >-
  rotate-env stage 2: a FAILED verifier redeploy says re-running is safe, but
  the re-run's readiness preflight refuses it
status: To Do
assignee: []
created_date: '2026-10-27T21:24:00Z'
labels:
  - area:tooling
  - size:S
  - state:ready
dependencies: []
priority: medium
ordinal: 1296000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: found in PR 2676 review. packages/tooling/src/secrets/verifier-redeploy-wait.ts terminal-failure refusal (TERMINAL_BAD_STATUSES branch) ends with the default rerunNote, "Re-running stage 2 is safe because redeploying the verifier is idempotent". When the new verifier deployment ends FAILED/CRASHED/REMOVED/SKIPPED it becomes latestDeployment, so the re-run is refused by assertRailwayServiceDeploymentReady (railway-api.ts:501) and by redeployRailwayServiceReusingImageWithSource (railway-api.ts:562); the operator needs a hand deploy:redeploy first.

What: give the DEFAULT wording the same terminal-branch recovery text PR 2676 gives BYOK (name the hand redeploy, wait for SUCCESS, then re-run stage 2), and update the pinned rotate-env text and its tests deliberately.

Acceptance: the rotate-env FAILED/CRASHED refusal names the hand redeploy step; tests pin it.
<!-- SECTION:DESCRIPTION:END -->
