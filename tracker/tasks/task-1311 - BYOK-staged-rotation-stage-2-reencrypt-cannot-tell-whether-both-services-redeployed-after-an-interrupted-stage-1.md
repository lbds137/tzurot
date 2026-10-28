---
id: TASK-1311
title: >-
  BYOK staged rotation: stage 2 (reencrypt) cannot tell whether both services
  redeployed after an interrupted stage 1
status: Done
assignee: []
created_date: '2026-10-27T17:10:00Z'
updated_date: '2026-10-28T00:48:00Z'
labels:
  - area:tooling
  - size:M
  - state:ready
dependencies: []
priority: high
ordinal: 1295000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: same gap as TASK-981, found while scoping it (that fix covers secrets:rotate-env only). BYOK stage 1 upserts API_KEY_ENCRYPTION_KEY and _PREVIOUS on api-gateway and ai-worker then redeploys both; an interrupted stage 1 leaves values written with the services never redeployed, and the only guard is prose: packages/tooling/src/secrets/byok-stage-helpers.ts (open-window error, ~L118) tells the operator to redeploy both and wait before stage 2. Stage 2 then re-encrypts stored rows while a service may still hold only the old key.

What: give BYOK stage 2 the equivalent guarantee (redeploy both services and wait for the new deployment id to reach SUCCESS before reencrypting), reusing getRailwayServiceLatestDeployment and the wait helper shipped for TASK-981 (verifier-redeploy-wait.ts). Check first whether stage 2 already has a deployment-ready preflight and what a stale-but-SUCCESS deployment does to it.

Acceptance: BYOK stage 2 cannot begin re-encryption until both services run a deployment created after the stage-1 writes; the hedge prose in byok-stage-helpers.ts is replaced by a cite of the shipped check; dev run covers the never-redeployed state.
<!-- SECTION:DESCRIPTION:END -->
