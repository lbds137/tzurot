---
id: TASK-1004
title: >-
  Recent-days digest: a pair that fails generation is re-eligible on the very
  next tick with no backoff
status: To Do
assignee: []
created_date: '2026-09-17 23:20'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:observable'
dependencies: []
priority: low
ordinal: 1000000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: a billed failure leaves generated_at null, so the selection query (packages/common-types/src/services/recentDaysDigestSelection.ts, the generated_at IS NULL arm of the interval clause) re-admits the pair on the next :06 tick. With MAX_ATTEMPTS = 3 a persistently failing pair occupies one of the ten per-tick generation slots on three consecutive ticks (~30 min) before going dead. Bounded and self-limiting, but under load (many due pairs competing for the cap) it delays healthy pairs by a tick or two. The roster-blurb sweep has exponential backoff keyed on its last-failed stamp; the digest table has no last-failed column. Reviewer finding on PR #2445 round 2, accepted as a conscious simplicity tradeoff at ship.
Watch signal: the sweep log line "Recent-days digest sweep complete" with failedBilled or dead above zero on consecutive ticks while selected equals MAX_GENERATIONS_PER_SWEEP (the cap is binding). Close by filing the fix when that shape is observed, or archive after a quiet month of prod ticks.
Fix shape: stamp digest_last_failed_at on the failure write (one additive migration) and gate the selection query on now >= last_failed_at + interval * power(2, attempts - 1), mirroring rosterBlurbSweep.ts findStale. Update the selection component test (C1) with a backed-off fixture.
<!-- SECTION:DESCRIPTION:END -->
