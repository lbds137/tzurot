---
id: TASK-244
title: FreeTierRequestQuota polish
status: To Do
assignee: []
created_date: '2026-07-08 00:00'
updated_date: '2026-09-04 19:55'
labels:
  - 'origin:review'
  - 'area:ai-worker'
  - 'size:S'
  - 'state:dependent'
dependencies: []
priority: low
ordinal: 244000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

FreeTierRequestQuota polish — N-comment accuracy + redundant resolveSystemKey (batch w/ pipelining) — Two PR #1564 round-4 non-blocking nits, same files as the pipelining follow-up (fold together): (a) `computeWindowCap`'s "N excludes the current user" comment is only true on a user's FIRST in-window request — a repeat requester's own userId stays in the ACTIVE ZSET, so N self-includes thereafter (no correctness bug; the cap just runs slightly tighter/conservative — reword the comment or note self-inclusion is intentional); (b) `resolveTargetAndCredentials` can call `deps.resolveSystemKey()` twice on the degraded failure path (harmless, one-line short-circuit). **Promote when**: the pipelining follow-up is picked up. Surfaced 2026-07-08 (PR #1564 review).

**Why:** Doc accuracy + micro-cleanup.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:55
---
Pass 2026-09-04 (TASK-888 half 1), owner ruling: SUPERSEDED into doc-18 (Theme Quota Billing Key Identity); archived. The member bullet there carries the fix shape, trigger or cost, and the 2026-09-04 evidence; pnpm tracker doc search TASK-244 finds it.
---
<!-- COMMENTS:END -->
