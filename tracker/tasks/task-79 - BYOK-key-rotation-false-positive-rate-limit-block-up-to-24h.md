---
id: TASK-79
title: BYOK key rotation false-positive rate-limit block (up to 24h)
status: To Do
assignee: []
created_date: '2026-04-29 00:00'
updated_date: '2026-07-28 10:47'
labels:
  - 'area:tooling'
  - 'area:redis'
  - 'size:M'
  - 'state:observable'
dependencies: []
priority: medium
ordinal: 79000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

BYOK key rotation false-positive rate-limit block (up to 24h)

**Why:** Rate-limit cache uses `user:<discordId>` as scope identifier. If a user rotates their OpenRouter API key after the original key hit the daily quota, the `user:<discordId>` Redis bucket stays cached as rate-limited until the original reset window expires (up to 24h via clamped TTL). The new key has its own independent quota, so the block is incorrect. **Why deferred**: rare in practice — users almost never rotate keys mid-quota. **Fix shape options**: (a) add `keyRotatedAt` timestamp to the BYOK user record; `deriveCacheKeyId` returns `user:<discordId>:<rotation-epoch>` so a new key gets a fresh cache scope; (b) operator escape valve via `pnpm ops cache:clear-rate-limit --user-id <id>`. Option (b) is cheaper if the manual escape is acceptable; option (a) is correct without operator intervention. **Promote when**: a user reports being rate-limit-blocked after rotating their key, OR alongside an api-key-management UX overhaul. Surfaced 2026-04-29 PR #943. Deferred 2026-05-01.
<!-- SECTION:DESCRIPTION:END -->
