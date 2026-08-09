---
id: TASK-477
title: >-
  A count in a PR body goes stale when the branch moves, and nothing re-derives
  it
status: To Do
assignee: []
created_date: '2026-08-09 09:39'
labels:
  - 'area:process'
  - 'area:docs'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 477000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: four wrong counts shipped in PR bodies in one session — 38 probe cases (was the unit figure), 19 then 26 fixtures (was 27), 50/28 blocking-allowing (was 51/27), 17 then 23 unit tests (was 26, then 28 after more landed), 17 lines (was 30, then 24 after a trim). Every one was caught by a reviewer. One of them shipped in the body of the PR arguing that unverified claims get trusted.

The shape is NOT the one 10-working-posture already covers. That trigger is about deriving a count from the whole result set rather than the visible part — a truncation failure, at the moment of first writing. This is staleness: the number was correctly derived once, the branch then moved (new cases, a trim, a rebase), the body was edited five times, and the number was carried forward untouched because re-deriving it felt like re-doing settled work.

Why it resists attention: a stale count is a well-formed number in a sentence that already reads as finished. Nothing about it looks wrong on re-read, which is why five body edits sailed past it.

Fix shape, cheapest first: one clause on the existing claim-time trigger in 10-working-posture — a count is re-derived whenever the thing it counts changes, not only when first written. A mechanical form is probably not available (a PR body is free prose; nothing knows which number counts what), so this is a rule clause rather than a guard, and it should say so.

Acceptance: the trigger names staleness alongside truncation, in one clause, without growing the always-loaded budget by more than a line or two.
<!-- SECTION:DESCRIPTION:END -->
