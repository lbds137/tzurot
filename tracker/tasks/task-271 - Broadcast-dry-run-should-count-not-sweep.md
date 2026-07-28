---
id: TASK-271
title: 'Broadcast dry-run should count, not sweep'
status: To Do
assignee: []
created_date: '2026-07-14 00:00'
updated_date: '2026-07-28 10:51'
labels:
  - 'origin:review'
  - 'area:api-gateway'
  - 'size:S'
dependencies: []
priority: low
ordinal: 271000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Broadcast dry-run should count, not sweep — `handleBroadcast`'s dry-run calls the full cursor-paginated `resolveEligibleRecipients` sweep just to show a count + 10-name sample — N/500 round-trips for data a `user.count` + `findMany({take:10})` provides (review #1649 r1 obs 3). Admin-only and trivial at current scale. **Fix shape**: dedicated `countEligibleRecipients` + capped sample query in `releaseBroadcast.ts`; keep the real-send path on the full sweep. Ride-alongs for the same touch (#1649 r4): swap the sequential per-batch enqueue loop for the existing `addValidatedJobs` helper, add seconds to `defaultLabel` (same-minute ad-hoc broadcasts currently collide into a safe-but-surprising rejection), and hoist the `[...allowlist]` spread out of the pagination loop in `resolveEligibleRecipients` (#1650 r3 nit — rebuilt per page today, harmless under one page). **Promote when**: the opted-in audience grows past a few hundred users, or the next `releaseBroadcast.ts` touch. Surfaced 2026-07-14 (#1649 review; allowlist nit #1650 review).

**Why:** Correct-but-lazy beats clever-but-divergent while the audience fits in one page.
<!-- SECTION:DESCRIPTION:END -->
