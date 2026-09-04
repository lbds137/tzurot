---
id: TASK-271
title: 'Broadcast dry-run should count, not sweep'
status: To Do
assignee: []
created_date: '2026-07-14 00:00'
updated_date: '2026-09-04 19:36'
labels:
  - 'origin:review'
  - 'area:api-gateway'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 271000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Broadcast dry-run should count, not sweep — `handleBroadcast`'s dry-run calls the full cursor-paginated `resolveEligibleRecipients` sweep just to show a count + 10-name sample — N/500 round-trips for data a `user.count` + `findMany({take:10})` provides (review #1649 r1 obs 3). Admin-only and trivial at current scale. **Fix shape**: dedicated `countEligibleRecipients` + capped sample query in `releaseBroadcast.ts`; keep the real-send path on the full sweep. Ride-alongs for the same touch (#1649 r4): swap the sequential per-batch enqueue loop for the existing `addValidatedJobs` helper, add seconds to `defaultLabel` (same-minute ad-hoc broadcasts currently collide into a safe-but-surprising rejection), and hoist the `[...allowlist]` spread out of the pagination loop in `resolveEligibleRecipients` (#1650 r3 nit — rebuilt per page today, harmless under one page). **Promote when**: the opted-in audience grows past a few hundred users, or the next `releaseBroadcast.ts` touch. Surfaced 2026-07-14 (#1649 review; allowlist nit #1650 review).

**Why:** Correct-but-lazy beats clever-but-divergent while the audience fits in one page.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:36
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): KEEP. `handleBroadcast`'s dry-run branch in `admin/broadcast.ts` still calls the full `resolveEligibleRecipients` cursor sweep just to report `eligibleCount` + a 10-name sample — no dedicated count query. All three ride-alongs are also still open: the real-send path still loops `addValidatedJob` per batch (not the batched `addValidatedJobs` helper), `defaultLabel` still truncates to the minute (`slice(0, 16)`, no seconds), and `[...allowlist]` is still spread INSIDE `resolveEligibleRecipients`'s per-page `for(;;)` loop rather than hoisted out. Evidence: `sed -n '30,55p' services/api-gateway/src/routes/admin/broadcast.ts` → dry-run calls the full sweep; `sed -n '67,100p' services/api-gateway/src/services/releaseBroadcast.ts` → allowlist spread is inside the loop; `grep -n addValidatedJob services/api-gateway/src/services/releaseBroadcast.ts` → still singular per-batch call.
---
<!-- COMMENTS:END -->
