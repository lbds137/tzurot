---
id: TASK-298
title: buildEntityDetailCard notice-vs-cap invariant is unenforced
status: To Do
assignee: []
created_date: '2026-07-19 00:00'
updated_date: '2026-07-28 10:52'
labels:
  - 'origin:review'
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 298000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Surfaced 2026-07-19 (#1719 r2+r3 observations) — `buildEntityDetailCard`'s notice-vs-cap invariant is documented but unenforced: a `truncationNotice` longer than `descriptionCap` floors the cut at 0 and returns just the notice, which can itself exceed the cap — contradicting the "provably ≤ cap" contract. Safe today (only caller: ~90-char notice vs 3800 cap; the pairing itself is type-forced). **Fix shape**: a dev-time throw (or clamp) in `resolveDescription` when `[...notice].length >= descriptionCap`, + one test. **Promote when**: any new `descriptionCap` caller lands, especially with a small cap.

**Why:** The type union forces the pair; this closes the remaining size relation the types can't express.
<!-- SECTION:DESCRIPTION:END -->
