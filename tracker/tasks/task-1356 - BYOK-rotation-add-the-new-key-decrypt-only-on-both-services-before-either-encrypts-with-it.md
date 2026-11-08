---
id: TASK-1356
title: >-
  BYOK rotation: add the new key decrypt-only on both services before either
  encrypts with it
status: To Do
assignee: []
created_date: '2026-11-08T03:28:00Z'
labels:
  - area:tooling
  - size:M
  - state:owner
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
<!-- SECTION:DESCRIPTION:END -->
