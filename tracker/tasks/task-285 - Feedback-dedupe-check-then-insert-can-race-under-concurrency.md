---
id: TASK-285
title: Feedback dedupe check-then-insert can race under concurrency
status: To Do
assignee: []
created_date: '2026-07-15 00:00'
updated_date: '2026-09-04 19:36'
labels:
  - 'area:redis'
  - 'origin:review'
  - 'area:api-gateway'
  - 'size:S'
  - 'state:observable'
dependencies: []
priority: low
ordinal: 285000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Feedback dedupe check-then-insert can race under concurrency — The intake's near-dup gate is `findFirst` → `create` with no transaction or unique constraint (the `[userId, contentHash]` index is non-unique because legitimate resubmission after the 7-day window must insert the same hash) — two CONCURRENT identical submissions can both pass the read and double-insert (#1656 review; same accepted TOCTOU shape as FreeTierRequestQuota). Bounded by the 5/day attempt cap; sequential retries are absorbed correctly. **Fix shape** if it ever matters: short-lived Redis lock on the discordId held across the gate sequence, or a time-bucketed unique key. **Promote when**: duplicate rows actually observed in user_feedback. Surfaced 2026-07-15 (#1656 review).

**Why:** Abuse-gate surface, not billing/integrity — the cap bounds the damage to noise.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:36
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): KEEP. `feedback.ts` still does `findFirst` then `create` with no transaction/lock, exactly the described TOCTOU shape. Evidence: `grep -n "findFirst\|\.create(" services/api-gateway/src/routes/user/feedback.ts` → lines 113/127, sequential, no `$transaction`.
---
<!-- COMMENTS:END -->
