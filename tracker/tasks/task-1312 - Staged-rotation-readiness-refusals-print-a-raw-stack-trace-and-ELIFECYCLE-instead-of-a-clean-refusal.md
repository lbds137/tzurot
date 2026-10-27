---
id: TASK-1312
title: >-
  Staged-rotation readiness refusals print a raw stack trace and ELIFECYCLE
  instead of a clean refusal
status: To Do
assignee: []
created_date: '2026-10-27T18:47:00Z'
labels:
  - area:tooling
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1295000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: observed in the TASK-981 dev end-to-end run. secrets:rotate-env --stage 2 run seconds after stage 1 was correctly refused ("api-gateway latest deployment is DEPLOYING, not SUCCESS - wait for it to settle ... Nothing was changed.") but the CLI printed an uncaught-error stack trace (railway-api.ts assertRailwayServiceDeploymentReady -> rotate-env-context.ts assertServicesDeploymentReady -> runStage2) followed by ELIFECYCLE. The refusal is an expected operator-facing state, not a crash; a clean one-line refusal is what an operator should see.

What: have assertRailwayServiceDeploymentReady throw UsageError (as the other expected refusals in this flow do) or catch it at the rotate-env CLI boundary, so the process exits non-zero with only the message. Check the other callers (deploy:redeploy, rotation.ts BYOK stages) before changing the error class.

Acceptance: a stage-2 readiness refusal prints the message without a stack trace; exit code stays non-zero; a unit test pins the error class.
<!-- SECTION:DESCRIPTION:END -->
