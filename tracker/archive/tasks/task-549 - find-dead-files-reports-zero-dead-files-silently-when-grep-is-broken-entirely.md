---
id: TASK-549
title: find-dead-files reports zero dead files silently when grep is broken entirely
status: To Do
assignee: []
created_date: '2026-08-12 09:53'
updated_date: '2026-09-04 19:58'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 549000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: hasNonTestImporters answers true (assume imported) for any grep failure that is not exit 1, which is the safe direction for a single call — an unknown must never promote a file onto a deletion list. But if grep is broken for the WHOLE run (missing binary, ENOENT, a bad searchDir), every candidate answers true, findDeadFiles returns zero dead files, and the command prints its cheerful "No dead files found" line. Verification never ran and nothing says so. Surfaced by the PR 2072 round-13 review.

This is the mirror of the bug 2072 fixed: there, a failed check produced a confident wrong POSITIVE (a live file called dead). Here a wholly failed run produces a confident wrong NEGATIVE (a clean bill of health nobody earned). Same root shape — a failure answering as data.

What: track how many importer greps failed during a run. If every candidate check failed, or the failure count crosses some obvious threshold, print a warning that importer verification did not run and do not print the all-clear. Low stakes because the tool is advisory and its output already tells the reader to verify before deleting, but the all-clear line is exactly the thing a reader would take at face value.

Acceptance: a run where every importer grep fails does not print "No dead files found" without a warning that verification did not run.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:58
---
Pass 2026-09-04 (TASK-888 half 1), owner ruling: SUPERSEDED into doc-74 (Idea Guard workspace root coverage — three guards hardcode two of four roots); archived. The member bullet there carries the fix shape, trigger or cost, and the 2026-09-04 evidence; pnpm tracker doc search TASK-549 finds it.
---
<!-- COMMENTS:END -->
