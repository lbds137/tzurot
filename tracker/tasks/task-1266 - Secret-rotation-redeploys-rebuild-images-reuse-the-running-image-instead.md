---
id: TASK-1266
title: Secret-rotation redeploys rebuild images; reuse the running image instead
status: To Do
assignee: []
created_date: '2026-10-22 21:44'
labels:
  - 'area:tooling'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1254000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: redeployRailwayService (packages/tooling/src/deployment/railway-api.ts, the serviceInstanceRedeploy mutation) deploys the branch HEAD and therefore runs a full image build, 1-28 min per service on Railway (TASK-1260 L1, L13). Every secrets:rotate-env stage and rotate-byok stage 3 pays that, and rotate-byok stage 1 pays it via the CLI implicit deploy. Measured 2026-10-22 on dev: deploymentRedeploy(id: <latest SUCCESS deployment>, usePreviousImageTag: true) skipped the build (bot-client SUCCESS in 19 s) and the new deployment snapshotted the CURRENT variables (a combined Postgres+Redis rotation with it took 45 s end to end and the new containers authenticated with the new passwords; see TASK-1260 L14). It also redeploys the code already running instead of whatever the branch HEAD is, which is the right semantics for a secret rotation.

What: give the rotation paths an image-reusing redeploy (latest SUCCESS deployment id + usePreviousImageTag) and use it in secrets:rotate-env stages and rotate-byok stage 3; keep serviceInstanceRedeploy for deploy:redeploy where a rebuild is wanted. Check the rotate-env deployed-code gate still reads the right commit. Move rotate-byok stage 1 to API upserts with skipDeploys (already a TASK-1263 member) so it can use it too.

Acceptance: a dev rotate-env 1-2-3 cycle where every redeploy finishes in under a minute, effect observed in service logs.
<!-- SECTION:DESCRIPTION:END -->
