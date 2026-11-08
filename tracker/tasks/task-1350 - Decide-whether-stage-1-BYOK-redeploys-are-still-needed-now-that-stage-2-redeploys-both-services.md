---
id: TASK-1350
title: >-
  Decide whether stage 1 BYOK redeploys are still needed now that stage 2
  redeploys both services
status: Done
assignee: []
created_date: '2026-11-04T18:28:00Z'
updated_date: '2026-11-08T03:28:00Z'
labels:
  - area:tooling
  - size:M
  - state:ready
dependencies: []
priority: low
ordinal: 1333000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Owner-directed filing 2026-11-04 (PR #2676 residue, previously declined there as an owner call): stage 2 already redeploys both services itself, so stage 1 redeploys may cost one extra restart per service per rotation. The counter-argument - rows written between the stages on the pre-rotation process land on PREVIOUS and are swept up by stage 2 - was plausible but never checked against every writer path. If dropped, verify each writer path first (03-database rule: trace WRITE then READ then external effect for each kept item).
<!-- SECTION:DESCRIPTION:END -->

## Decision (2026-11-07): keep the stage-1 redeploy

Writer/reader trace (develop 257240ac0, non-test callers of `encryptApiKey`/`decryptApiKey`):

- api-gateway WRITES: `routes/wallet/setKey.ts:83` (BYOK keys), `routes/user/shapes/auth.ts:101` (shapes cookie).
- ai-worker WRITES: `jobs/shapesCredentials.ts:76` (re-encrypts a refreshed shapes cookie).
- api-gateway READS: `wallet/testKey.ts:61`, `user/shapes/list.ts:67`, `utils/audioProviderKeyResolver.ts:78`, `utils/elevenLabsKeyResolver.ts:53`.
- ai-worker READS: `services/ApiKeyResolver.ts:305`, `jobs/shapesCredentials.ts:52`.

The counter-argument holds for rows AT REST: anything written under the old key before stage 2 is on PREVIOUS and stage 2 sweeps it. It misses the READ path in a mixed process state. Stage 1 writes the variables with `skipDeploys: true`, so without its redeploy both services keep running {CURRENT=old} until something redeploys them. Any single-service redeploy in the gap between stages (`pnpm ops deploy:redeploy --service X`, or an auto-deploy that rebuilds one service) then puts that service on {CURRENT=new, PREVIOUS=old} while the other still holds only the old key. Each service writes rows the other reads, so a write by the new-key service fails to decrypt in the old-key service. That lasts until the old-key service restarts: unbounded, since the gap between stage 1 and stage 2 is operator time. (Inference: that a new deployment reads the variables already stored with `skipDeploys` is Railway's documented model, not probed here.) The stage-1 redeploy bounds that mismatch to one deploy's duration, for one extra image-reuse restart per service per 180-day rotation. Keep it.

Residual, inherent to both stages: each redeploys api-gateway then ai-worker. While the first is on the new key and the second is not, a cross-service write can't be decrypted for about one deploy. It heals itself once the second service is live. No redeploy order removes it, because both services write and both read. Removing it needs a pre-stage that adds the new key as decrypt-only on both services before either encrypts with it. That's a design change to the rotation, filed separately for an owner ruling (see TASK-1356).
