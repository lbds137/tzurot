---
id: TASK-1356
title: >-
  BYOK rotation: add the new key decrypt-only on both services before either
  encrypts with it
status: In Progress
assignee:
  - Tzurot
created_date: '2026-11-08T03:28:00Z'
updated_date: '2026-11-22T18:14:00Z'
labels:
  - area:tooling
  - size:M
  - state:ready
dependencies: []
priority: low
ordinal: 1339000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: both BYOK rotation stages redeploy api-gateway then ai-worker. While one service runs the new CURRENT and the other does not, a row written by the first cannot be decrypted by the second for about one deploy duration. Writers: api-gateway `routes/wallet/setKey.ts:83` and `routes/user/shapes/auth.ts:101`, ai-worker `jobs/shapesCredentials.ts:76`. It heals itself once the second service is live. Analysis in TASK-1350.

What: a pre-stage that makes the next key decrypt-capable on both services (e.g. a second fallback slot) and redeploys, before stage 1 switches CURRENT, so every mixed state can read every row.

Acceptance: no rotation step leaves a running process unable to decrypt a row another process can write.

Owner question: is a minutes-long, self-healing BYOK decrypt failure once per 180-day rotation worth a rotation redesign?
Recommendation: no, leave as is — rotations run with you present, the failure self-heals within one deploy, and the fix adds a key slot to security-critical code.
Owner ruling (2026-11-20, AUQ): YES, redesign the rotation (against the leave-as-is recommendation): new key decrypt-only on both services before either encrypts with it.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Design ruling (Lila AUQ 2026-11-22): decrypt-only API_KEY_ENCRYPTION_KEY_NEXT slot folded into stage 1 (stage NEXT on both, redeploy+wait with old-deployment-gone gate, then swap CURRENT/PREVIOUS and delete NEXT). Rejected: reusing PREVIOUS (state not identifiable from Railway vars alone). Restarts 3 to 4 per service per rotation, no new command. Before build: probe in dev what Railway reports for a superseded deployment. Acceptance: dev end-to-end rotation with a live mixed-state read.

Driver calls 2026-11-22 (engineering, not owner): NEXT equal to CURRENT counts as unset (mirrors PREVIOUS normalisation; fixes a stage-1/2/3 refusal loop after an interrupted swap that dispatch 1 found); differing NEXT in an open window refuses with the deploy:var-delete command. Stage-1 test counts 4->6 updated as intended behaviour change. Spec: docs/local/dispatch/task-1356-spec.md (Amendments 1-2).
<!-- SECTION:NOTES:END -->
