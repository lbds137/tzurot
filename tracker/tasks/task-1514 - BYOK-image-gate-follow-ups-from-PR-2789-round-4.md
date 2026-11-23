---
id: TASK-1514
title: BYOK image gate follow-ups from PR 2789 round 4
status: In Progress
assignee:
  - tzurot
created_date: '2026-11-23T04:30:00Z'
updated_date: '2026-11-23T04:56:00Z'
labels:
  - area:tooling
  - size:S
  - state:ready
dependencies: []
priority: medium
ordinal: 1514000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR 2789 (TASK-1510) merged at review round 4 with low findings that are real defects, not taste. (1) getLiveDeploymentCommit in packages/tooling/src/deployment/railway-api.ts is dead production code: its only caller now uses getLiveDeployment (git grep over packages/*/src and services/*/src, tests excluded, shows only its definition and two comments). (2) assertImagesDecryptWithNext in packages/tooling/src/secrets/byok-prepare-stage.ts infers a live-read failure from a missing deploymentId; nothing pins that only the read-failure branch of deployed-code-gate.ts omits it, so a new not-ok branch would silently get the in-flight-deploy prefix. (3) The byok-prepare-stage.test.ts not-ok-with-id fixture uses the rotate-env reason string (carries no API_KEY_ENCRYPTION_KEY_PREVIOUS). (4) ENCRYPTION_KEY_ROTATION.md stage-1 paragraph has a mid-sentence wrap.

What: delete getLiveDeploymentCommit, move its tests onto getLiveDeployment, fix the railway-api.ts docstring that names it; pin the deploymentId invariant with an assertion per not-ok branch in deployed-code-gate.test.ts (or a discriminant field); fix the fixture string; reflow the paragraph.

Acceptance: no production reference to getLiveDeploymentCommit; a test fails if a not-ok gate branch drops deploymentId; tooling suite green.
<!-- SECTION:DESCRIPTION:END -->
