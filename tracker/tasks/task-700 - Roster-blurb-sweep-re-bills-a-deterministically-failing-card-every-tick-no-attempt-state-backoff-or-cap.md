---
id: TASK-700
title: >-
  Roster-blurb sweep re-bills a deterministically-failing card every tick - no
  attempt state, backoff, or cap
status: To Do
assignee: []
created_date: '2026-08-20 16:17'
labels:
  - 'area:ai-worker'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 700000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: 2026-08-20 pre-release second-look (owner-gated quality check). The stale predicate is purely roster_blurb_source_hash IS DISTINCT FROM card_source_hash; a generation failure writes nothing, so the row is re-selected every 10-minute tick and each retry is a real billed call (logUsage fires on the parse-failure path by design). A card that deterministically produces a refusal or non-JSON output (temperature 0, pure function of the card - the GLM reasoning-tag class) re-bills ~144 calls/day forever, and ten such rows saturate MAX_GENERATIONS_PER_SWEEP so no other row ever generates (ORDER BY puts already-blurbed rows first - starvation). Evidence: services/ai-worker/src/jobs/rosterBlurbSweep.ts:283-331 with :233-241 findStale.

Also fold in from the same review: stats.failed JSDoc miscounts (it counts two zero-spend outcomes as model calls - :291 and :330), and the unbounded findMany at :278-281 needs a take.

Fix shape: per-row attempt state (a failure stamp column or attempt counter with exponential backoff and a hard cap), so a failing card leaves the hot set; correct the failed JSDoc to what it counts or split the counter; add the take.

Acceptance: a row whose generation fails N times stops being selected until its card changes (or a capped backoff elapses), pinned by a test; the sweep stats distinguish billed failures from zero-spend skips.

GATES the rosterBlurbEnabled flip - the feature is inert until then, so this is not release-blocking, but the flip must not happen before this lands.
<!-- SECTION:DESCRIPTION:END -->
