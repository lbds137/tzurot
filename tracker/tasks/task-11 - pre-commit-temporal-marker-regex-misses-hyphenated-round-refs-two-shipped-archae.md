---
id: TASK-11
title: pre-commit temporal-marker regex misses hyphenated round refs
status: Done
assignee: []
created_date: '2026-07-12 00:00'
updated_date: '2026-08-06 02:54'
labels:
  - 'area:process'
  - 'size:S'
  - 'state:unreachable'
dependencies: []
priority: low
ordinal: 11000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Surfaced 2026-07-12 — pre-commit temporal-marker regex misses hyphenated round refs + two shipped archaeology comments — The `.husky/pre-commit` scanner's round-marker pattern expects a space (`round [0-9]+`) so `round-1 review` slips through — #1602 shipped two test comments carrying exactly that archaeology (`VisionConfigResolver.test.ts` ~line 107, `stampResolvedConfig.test.ts` ~line 25), reviewer-caught post-hoc. **Fix shape**: tighten the hook regex to `round[- ][0-9]+` AND strip the two comments to invariant-only phrasing in the same pass. **Promote when**: next touch of either file or the pre-commit hook.

**Why:** Structural-guard gap + the two comments it let through; one PR fixes both.
<!-- SECTION:DESCRIPTION:END -->
