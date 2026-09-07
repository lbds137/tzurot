---
id: TASK-584
title: Execute both Redis Lua scripts against a real Redis in the component tier
status: To Do
assignee: []
created_date: '2026-08-13 11:40'
labels:
  - 'area:api-gateway'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 584000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: two Lua scripts ship in api-gateway and NEITHER is ever executed by a test. RELEASE_IF_OWNED_LUA (RedisDeduplicationCache, compare-and-delete on release) is covered only by a JS behavioural stand-in in the unit test that mimics what the script should do; INCR_WITH_EXPIRE_LUA (RedisRateLimiter) is unit-mocked the same way. A syntax slip or a semantic error in either Lua string would pass every gate and surface only against a live Redis - on a billing path for the first, and on the rate limiter for the second.

This is filed as the batch rather than one script: both have the same gap for the same reason, and one component test file closes both.

Fix shape: the component tier already wires a real ioredis (see the conformance harness that calls initializeDeduplicationCache with a live connection). Add component coverage that drives the real EVAL: for the release script, assert it deletes when the stored jobId matches, leaves a foreign entry alone, no-ops on an absent key, and does not error on a corrupt entry; for the rate limiter, assert the INCR sets the TTL only on first call.

Acceptance: both scripts execute as Lua in CI, and a deliberate syntax break in either reddens a test. Source: PR 2085 review round 5, Informational - reviewer hand-checked the release script and explicitly did not ask for a fix in that PR.

Widened 2026-09-07 by owner call: this is the bar for EVERY Lua script in the repo, present and future, not only the two gateway scripts. Present inventory at widening: RELEASE_IF_OWNED_LUA and INCR_WITH_EXPIRE_LUA in api-gateway, plus the ExtractionBudget counter script in ai-worker (services/ai-worker/src/services/extraction/ExtractionBudget.ts), whose unit test asserts the script TEXT crosses redis.eval and never executes it; TASK-904 converges that third script to the plain incr/expire shape the database rule prefers, and whichever lands first closes it. Any new Lua script added later inherits this acceptance: the real EVAL runs against the component tier's live Redis, and a deliberate syntax break reddens a test. No other test shape counts as Lua coverage: a string pin or a JS stand-in proves nothing about the script.
<!-- SECTION:DESCRIPTION:END -->
