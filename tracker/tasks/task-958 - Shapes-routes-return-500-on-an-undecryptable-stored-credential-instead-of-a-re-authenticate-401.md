---
id: TASK-958
title: >-
  Shapes routes return 500 on an undecryptable stored credential instead of a
  re-authenticate 401
status: Done
assignee: []
created_date: '2026-09-13 17:02'
updated_date: '2026-09-19 00:59'
labels:
  - 'area:api-gateway'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 955000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: dev api-gateway log 2026-09-13 16:40:54Z — two GET /api/user/shapes/list requests failed with "Unsupported state or unable to authenticate data" thrown from decryptWithKey inside the route (services/api-gateway/src/routes/user/shapes/list.ts decrypts the stored session cookie around line 59); the asyncHandler turned it into a 500, and the bot-client autocomplete rendered its outage sentinel ("Unable to load shapes — try again"), so the owner saw an outage where the real state was "your stored cookie cannot be decrypted, re-authenticate". The route already handles an EXPIRED cookie with a 401 naming /shapes auth (line ~101); an undecryptable one gets no branch. Why the dev row was undecryptable is NOT known: the staged rotation tool covers user_credentials (packages/tooling/src/secrets/rotation.ts lines ~302, ~377), so a key change outside it is the leading candidate — record the cause if the owner learns it.
Fix shape: catch the decrypt failure in list.ts and return the same 401 shape as the expired-cookie branch (message: stored credentials cannot be read, re-authenticate with /shapes auth), then sweep the sibling routes that decrypt the same credential (import.ts, export.ts, auth.ts status) and the ai-worker job side (services/ai-worker/src/jobs/shapesCredentials.ts) so every consumer of an undecryptable row degrades the same way. One unit test per route with a credential whose ciphertext does not authenticate. Also consider: the autocomplete sentinel could carry the 401 message when the failure is an auth failure rather than an outage — a UX decision, note it rather than build it here.
Acceptance: an undecryptable stored shapes.inc credential yields a 401 with a re-authenticate message on every shapes route, pinned by tests; no 500 reaches asyncHandler for that condition.
<!-- SECTION:DESCRIPTION:END -->
