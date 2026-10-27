---
id: TASK-1314
title: >-
  A NEEDS_APPROVAL redeploy refusal tells the operator to re-run, but the re-run
  may need approval again (rotate-env and BYOK stage 2)
status: To Do
assignee: []
created_date: '2026-10-27T21:45:00Z'
labels:
  - area:tooling
  - size:S
  - state:observable
dependencies: []
priority: low
ordinal: 1297000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: found in PR 2676 review. The wait in packages/tooling/src/secrets (the redeploy-and-wait helper) throws as soon as the new deployment reads NEEDS_APPROVAL and tells the operator to approve it in the dashboard and re-run stage 2. A re-run triggers a NEW redeploy (rotate-env stage 2 and BYOK stage 2 both redeploy first). If approval applies to API-triggered redeploys, the new deployment needs approval again and the stage can never reach its next step. Never observed live: both dev rotations on this project ran with no approval prompt.

What: when a NEEDS_APPROVAL deployment is seen in practice, either treat it as a wait state (poll until the timeout, say that approving lets the run continue) or correct the message so it does not imply a re-run converges. Changing it to a wait state is an async-boundary change, so show the owner the design first.

Promote when: a NEEDS_APPROVAL status is seen on a rotation redeploy.

Acceptance: the refusal either continues after approval or says plainly that a re-run triggers another redeploy.
<!-- SECTION:DESCRIPTION:END -->
