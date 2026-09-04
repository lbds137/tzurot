---
id: TASK-298
title: buildEntityDetailCard notice-vs-cap invariant is unenforced
status: To Do
assignee: []
created_date: '2026-07-19 00:00'
updated_date: '2026-09-04 19:44'
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

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:44
---
Pass 2026-09-04 (TASK-888 half 1), owner ruling: ARCHIVED. admission bar (06-backlog.md: there is deliberately no state for the-only-trigger-is-next-time-someone-touches-this; a task in it should never have been filed). The trigger event and the need are the same diff: the second descriptionCap caller reads the first.
---
<!-- COMMENTS:END -->
