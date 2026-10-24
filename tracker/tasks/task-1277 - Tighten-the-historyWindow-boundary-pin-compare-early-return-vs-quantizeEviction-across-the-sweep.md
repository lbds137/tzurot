---
id: TASK-1277
title: >-
  Tighten the historyWindow boundary pin: compare early return vs
  quantizeEviction across the sweep
status: To Do
assignee: []
created_date: '2026-10-24 11:01'
labels:
  - 'area:conversation-history'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
type: chore
ordinal: 1265000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
PR 2650 round-6 review: the boundary pin asserts quantizeEviction(cap, cap, chunk) equals hard-coded {evicted: 0, take: cap} - necessary but not sufficient, since a future edit to resolveHistoryWindow EARLY RETURN (say a clamp on take) would make the boundary observable while the pin stays green; only the exactly-at-cap spot checks at caps 50 and 21 could catch it. Fix per the reviewer shape: in the same loop also expect resolveHistoryWindow(cap, cap) to equal the spread quantizeEviction result across caps 0..120, and soften the disable-site holds-exactly-while wording to necessary-not-sufficient. Same round: fold the exactly-at-cap test into that sweep (only its chunk assertions are new), keep the full equivalence proof at the disable site only (it is in three places), confirm knip accepts the test-only internal export at the next quality run (CI was green).
<!-- SECTION:DESCRIPTION:END -->
