---
id: TASK-1265
title: 'rotate-byok stage 3 fails: the Railway CLI rejects an empty --set value'
status: Done
assignee: []
created_date: '2026-10-22 19:28'
updated_date: '2026-10-22 20:50'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 1253000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: dev rehearsal of the Railway breach rotation, 2026-10-22: `pnpm ops secrets:rotate-byok --env dev --stage 3` died at packages/tooling/src/secrets/rotation.ts:412 (setServiceVariables, :161) with `railway variables ... --set API_KEY_ENCRYPTION_KEY_PREVIOUS=` → "Invalid variable format". The current Railway CLI refuses an empty value, so stage 3 can never close a window; the module doc premise "the Railway CLI cannot delete variables, so set it to empty" (rotation.ts:16-17, encryption.ts:65-66) is stale: `pnpm ops deploy:var-delete` deletes via the API, and getPreviousEncryptionKey treats an absent variable the same as "" (encryption.ts:70).

Dev workaround used: deploy:var-delete on api-gateway and ai-worker, then `secrets:mark-rotated byok-encryption-key --env dev`. The prod pass tonight needs the same workaround unless this lands first.

What: stage 3 deletes PREVIOUS through the railway-api delete path (as deploy:var-delete does) instead of --set ""; fix the two stale comments; a test that asserts the delete crosses the seam; an end-to-end dev run (00-critical.md). Also check stage 1 writes (CLI --set with key material in argv, rotation.ts:20-23) could move to the API with skipDeploys, which would also let stage 1 join a batched redeploy round (TASK-1260 L11).

Acceptance: stage 3 closes a dev window end to end; comments corrected.
<!-- SECTION:DESCRIPTION:END -->
