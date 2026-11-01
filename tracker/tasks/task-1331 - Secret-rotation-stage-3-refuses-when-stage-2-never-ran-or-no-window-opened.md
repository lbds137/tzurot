---
id: TASK-1331
title: 'Secret rotation: stage 3 refuses when stage 2 never ran or no window opened'
status: To Do
assignee: []
created_date: '2026-11-01T11:33:00Z'
labels:
  - area:tooling
  - size:M
  - state:ready
dependencies: []
priority: medium
ordinal: 1314000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: post-merge audit, verified by reading. (1) packages/tooling/src/secrets/rotate-env-stages.ts runStage3 checks the window and degeneracy but not that stage 2 ran, so 1 then 3 deletes _PREVIOUS while presenters hold the old value: 401s until redeployed by hand. Needs an operator mistake past a confirm prompt. (2) packages/tooling/src/secrets/rotation.ts finalizeByokWindow has no open-window check: with PREVIOUS absent on both services it redeploys and stamps byok-encryption-key as rotated, resetting the 180d nag with no rotation. rotation.test.ts pins this because resuming a partial stage 3 looks identical, so the fix must keep that resume working.
What: add both guards; decide how to tell resume from never-opened (for example presenter deployment times, or an explicit resume flag).
Acceptance: both wrong sequences refuse with a message naming the next step; partial-stage-3 resume still works; end-to-end dev exercise before any prod use, per 00-critical.
<!-- SECTION:DESCRIPTION:END -->
