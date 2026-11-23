---
id: TASK-1510
title: 'BYOK stage 1: refuse when the running image predates the NEXT-aware decrypt'
status: To Do
assignee: []
created_date: '2026-11-22T20:49:00Z'
labels:
  - area:tooling
  - size:M
  - state:ready
dependencies: []
priority: high
ordinal: 1510000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: secrets:rotate-byok stage 1 (packages/tooling/src/secrets/byok-prepare-stage.ts header, PRECONDITION) reuses the running image on its prepare redeploy, so it relies on that image already containing the NEXT-aware decryptApiKey (packages/common-types/src/utils/encryption.ts). Nothing checks it. On an older image NEXT is ignored, the removal waits still pass, and the swap reproduces the cross-process encrypt/decrypt race that TASK-1356 closes. Found by the TASK-1356 PR review.

What: before staging NEXT, verify each BYOK service's live deployment commit contains the NEXT-aware change (for example getLiveDeploymentCommit in packages/tooling/src/deployment/railway-api.ts plus an ancestry check against the commit that introduced it), and refuse with a message naming the service and the deploy to do first.

Acceptance: stage 1 refuses on a service whose live commit lacks the NEXT-aware decrypt, with a unit test for the refusal and one for the pass; the PRECONDITION header and ENCRYPTION_KEY_ROTATION.md say it is checked.

Gate (Lila 2026-11-22, AskUserQuestion on PR #2788 review finding 2, "Gate prod on it"): no prod BYOK rotation runs until this task ships. Lila's later ruling the same day, AUQ "Merge, then rotate dev": PR #2788 merges to develop first, and its dev end-to-end rotation runs on develop's auto-deploy. This task is the next PR. ENCRYPTION_KEY_ROTATION.md carries the same gate until this lands.

Also before the first prod rotation (PR #2788 review round 5): probe prod read-only with `deployments(input: { serviceId, environmentId, status: { in: [CRASHED] } })` for api-gateway and ai-worker. Only dev was probed; it had none. One lingering superseded CRASHED deployment would make the pre-swap check (`assertOnlyNewDeploymentsLive`) refuse every run, after both prepare restarts. The session that built #2788 had this read refused by the auto-mode classifier, so it may need the owner's run.
<!-- SECTION:DESCRIPTION:END -->
