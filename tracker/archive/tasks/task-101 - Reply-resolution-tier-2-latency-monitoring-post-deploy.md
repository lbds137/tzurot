---
id: TASK-101
title: Reply-resolution tier-2 latency monitoring post-deploy
status: To Do
assignee: []
created_date: '2026-05-16 00:00'
updated_date: '2026-09-04 20:01'
labels:
  - 'area:api-gateway'
  - 'area:redis'
  - 'size:S'
  - 'state:observable'
dependencies: []
priority: low
ordinal: 101000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Reply-resolution tier-2 latency monitoring post-deploy

**Why:** PR #1035 dropped the `isDM` gate on `ReplyResolutionService.lookupPersonalityIdentifier`'s tier-2 DB lookup, so every Redis miss in guild channels now triggers an api-gateway round trip. Reply Redis keys have a 7-day TTL; under normal traffic the hit rate should keep this cheap, but bursty patterns (Redis restart, high-traffic channel after a long quiet period, batch reply scenarios) could surface p99 spikes on the reply-resolution path that the pre-PR code masked by returning null. **Fix shape options**: (a) restore a narrower gate keyed on "is the bot a member of the channel for >7d" (not really a thing) — likely impractical; (b) add a short in-memory negative cache for failed tier-2 lookups so a chain of replies to an unmatched personality doesn't hammer the gateway; (c) accept and monitor. **Promote when**: production logs show p99 latency spikes on the reply-resolution path correlated with the post-PR-#1035 window, OR a recurring "tier-2 hit rate" metric crosses some threshold worth dashboarding. Surfaced 2026-05-16 PR #1035 round 4.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 20:01
---
Pass 2026-09-04 (TASK-888 half 1), owner ruling: SUPERSEDED into doc-92 (Idea Scale gated watches — threshold inventory for the single instance ceiling); archived. The member bullet there carries the fix shape, trigger or cost, and the 2026-09-04 evidence; pnpm tracker doc search TASK-101 finds it.
---
<!-- COMMENTS:END -->
