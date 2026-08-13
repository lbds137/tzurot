---
id: TASK-583
title: Collapse the dedup reserve SET-then-GET into one atomic SET NX EX GET
status: To Do
assignee: []
created_date: '2026-08-13 11:14'
labels:
  - 'area:api-gateway'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 583000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: RedisDeduplicationCache.reserve does SET NX EX, then GET when the SET reports the key exists. Those are two round trips with a real race between them - a reservation that expires in the gap resolves to neither reserved nor duplicate. Today that is handled probabilistically: a bounded 2-attempt loop that throws if both attempts miss. The throw path is untriggerable in practice but it exists, and the retry loop is extra code standing in for atomicity.

Fix shape: Redis 6.2+ supports SET key value NX EX ttl GET, which returns the previous value (or nil when the key was absent and the SET succeeded) in ONE atomic call. That collapses the loop and removes the race structurally rather than probabilistically, deleting the throw branch and its test.

Gating probe FIRST: this is an external-system claim. Confirm the deployed Redis version on Railway (both dev and prod) actually supports the GET argument to SET before writing anything - do not take the version support from docs or from this description.

Acceptance: reserve is a single round trip with no retry loop, the expired-race throw branch is gone, and the existing reserve tests still pass with the mock updated to the new call shape. Source: PR 2085 review round 3, Low - non-blocking, current implementation is correct.

Ride-along while in this file (PR 2085 review round 6, Low): release() derives its key with hashRequest OUTSIDE the try block, while its docstring promises best-effort - logged rather than thrown. Not reachable today, because generate.ts only calls release() with the same request object reserve() already hashed successfully moments earlier, and hashRequest is pure. Move the derivation inside the try so the contract is true independent of that caller invariant.
<!-- SECTION:DESCRIPTION:END -->
