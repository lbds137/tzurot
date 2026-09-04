---
id: TASK-300
title: Mutation-tests CI matrix split (one leg per tracked package)
status: To Do
assignee: []
created_date: '2026-07-19 00:00'
updated_date: '2026-09-04 20:05'
labels:
  - 'area:ci'
  - 'area:tooling'
  - 'size:M'
  - 'state:dependent'
dependencies: []
priority: low
ordinal: 300000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Surfaced 2026-07-19 (CI-bottleneck assessment, owner-approved option 1 = the changed-aware gate) — mutation-tests matrix split parked: fan out one CI leg per tracked package (`mutation:check` fans in on report artifacts), capping worst-case wall-clock at setup + slowest package (~3min vs ~7min sequential) at the cost of 5× setup overhead per run. Not worth the plumbing at 5 tracked packages now that the gate skips untouched-surface PRs entirely. **Promote when**: a 6th package joins `MUTATED_PACKAGES` (sequential wall-clock grows linearly; common-types would blow past 10min), or gate-passing PRs become the common case.

**Why:** The gate fixes the common case (untouched surface); the matrix caps the worst case — only needed when the worst case grows.

## PROMOTE-WHEN MAY BE MOOT — see TASK-674 (2026-08-19)

The trigger above rests on sequential wall-clock growing LINEARLY with the
tracked-package count. Stryker 9.6.1 supports `--incremental` (probed: also
`--incrementalFile` and `--force`), under which cost tracks the DIFF rather than
the package set — so a 6th package would not grow the run the way this task
assumes, and the matrix may never be needed.

The two are not equivalent, and incremental is the cheaper of them: the matrix
caps wall-clock while PAYING 5× setup (checkout at fetch-depth 0 + install +
prisma generate + build, per leg); incremental removes the work instead of
redistributing it, with no fan-out plumbing. They compose if both are ever
wanted, but incremental should be tried first.

**Do not promote this on the 6th-package trigger alone until TASK-674 is
settled** — if incremental lands, re-derive whether the worst case actually
grew before paying for the matrix.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 20:05
---
Pass 2026-09-04 (TASK-888 half 1), owner ruling: SUPERSEDED into doc-4 (Theme Deterministic Test Quality Tooling mutation testing job payload contract); archived. The member bullet there carries the fix shape, trigger or cost, and the 2026-09-04 evidence; pnpm tracker doc search TASK-300 finds it.
---
<!-- COMMENTS:END -->
