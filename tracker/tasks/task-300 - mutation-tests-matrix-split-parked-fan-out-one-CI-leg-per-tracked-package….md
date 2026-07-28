---
id: TASK-300
title: Mutation-tests CI matrix split (one leg per tracked package)
status: To Do
assignee: []
created_date: '2026-07-19 00:00'
updated_date: '2026-07-28 10:52'
labels:
  - 'area:ci'
  - 'area:tooling'
  - 'size:M'
dependencies: []
priority: low
ordinal: 300000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Surfaced 2026-07-19 (CI-bottleneck assessment, owner-approved option 1 = the changed-aware gate) — mutation-tests matrix split parked: fan out one CI leg per tracked package (`mutation:check` fans in on report artifacts), capping worst-case wall-clock at setup + slowest package (~3min vs ~7min sequential) at the cost of 5× setup overhead per run. Not worth the plumbing at 5 tracked packages now that the gate skips untouched-surface PRs entirely. **Promote when**: a 6th package joins `MUTATED_PACKAGES` (sequential wall-clock grows linearly; common-types would blow past 10min), or gate-passing PRs become the common case.

**Why:** The gate fixes the common case (untouched surface); the matrix caps the worst case — only needed when the worst case grows.
<!-- SECTION:DESCRIPTION:END -->
