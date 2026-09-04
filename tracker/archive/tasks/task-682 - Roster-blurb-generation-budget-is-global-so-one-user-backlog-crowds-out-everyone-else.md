---
id: TASK-682
title: >-
  Roster-blurb generation budget is global, so one user backlog crowds out
  everyone else
status: To Do
assignee: []
created_date: '2026-08-19 14:16'
updated_date: '2026-09-04 20:03'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:observable'
dependencies: []
priority: low
ordinal: 682000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: sweepRosterBlurbs generates at most MAX_GENERATIONS_PER_SWEEP (10) rows per tick, and that budget is GLOBAL. findStale orders by whether a row already has a blurb — edits before never-generated — but does not distinguish whose rows they are. A user importing a large batch of Shapes characters adds a proportional number of never-generated rows that compete with every other user fresh imports and edits for the same 10-per-10-minutes.

At one-owner scale this is invisible. It becomes real the moment two users import batches near each other: the second user waits behind the first entire backlog, at ten rows per ten minutes.

Fix shape: add per-user diversity to the stale query rather than raising the global cap — something like row_number() over a partition by owner_id, taking the top N per owner before the global LIMIT. Raising the cap alone does not fix fairness, it just makes the unfair thing faster and more expensive.

Promote when: more than one active user imports characters in bulk, or the sweep is observed running at its per-tick cap across consecutive ticks (stats.generated == 10 repeatedly in the completed-job logs).

Raised by the PR #2149 round-6 review; verified against services/ai-worker/src/jobs/rosterBlurbSweep.ts findStale and the loop bound.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 20:03
---
Pass 2026-09-04 (TASK-888 half 1), owner ruling: SUPERSEDED into doc-92 (Idea Scale gated watches — threshold inventory for the single instance ceiling); archived. The member bullet there carries the fix shape, trigger or cost, and the 2026-09-04 evidence; pnpm tracker doc search TASK-682 finds it.
---
<!-- COMMENTS:END -->
