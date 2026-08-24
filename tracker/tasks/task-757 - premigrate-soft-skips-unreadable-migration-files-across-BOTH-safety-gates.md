---
id: TASK-757
title: premigrate soft-skips unreadable migration files across BOTH safety gates
status: To Do
assignee: []
created_date: '2026-08-24 01:46'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 757000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: readMigrationFile (premigrate.ts) warns and skips a file it cannot read, so an unreadable migration is treated as neither destructive nor apply-after-deploy-marked and gets premigrated on a console warning alone - the soft-skip now sits in front of two independent safety gates (surfaced by claude-review on PR 2204, round 5; pre-existing behavior for the destructive scan, extended to the marker scan by the shared helper).
Trade-off to decide: hard-failing is safer at release time (a corrupt tree should stop the train) but the skip exists because git-diff can list a path the local working tree legitimately lacks (checkout behind the range). Fix shape: probably hard-fail by default with a --skip-unreadable escape, or distinguish ENOENT (legit, skip) from other read errors (hard-fail).
Acceptance: an unreadable migration file makes release:premigrate exit nonzero (or the decided variant); the legit list-but-absent case has a decided, tested behavior; premigrate.test.ts pins both.
<!-- SECTION:DESCRIPTION:END -->
