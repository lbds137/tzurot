---
id: TASK-548
title: >-
  ops context goes silent on a migration-check timeout instead of flagging
  unknown
status: To Do
assignee: []
created_date: '2026-08-12 09:45'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 548000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR 2072 fixed getPendingMigrations so a timeout returns null instead of the empty array that printed "All migrations applied" during a DB hang. Correct, but getSessionContext treats null as "skip the whole Migrations section", so the timeout case now renders identically to "this repo has no prisma/migrations directory" — total silence. Surfaced by the PR 2072 round-12 review.

The tool exists to warn a developer at session start about exactly this class of state, so silence is the one degradation it should not choose. Never claiming "none pending" when unsure was the fix; saying nothing at all is only half of it.

What: distinguish "no migrations directory" from "could not determine", and print a line for the second — something like a warning that migration status could not be determined, naming the timeout. Note this needs more than a one-line edit: getPendingMigrations returns string[] or null today and both cases collapse into null, so it needs a third state (a tagged result, or a distinct sentinel) plus the caller branch and test updates.

Why not in 2072: that PR was already twelve review rounds deep on a partial-pass scope, and this is a behavior change to the command output rather than a defect in the bound. Filed rather than ridden along.

Acceptance: a migration-status timeout produces a visible "unknown" line, and a repo with no migrations directory still produces no section at all.
<!-- SECTION:DESCRIPTION:END -->
