---
id: TASK-1471
title: 'Identity epic Phase 5b: NOT NULL on User.defaultPersonaId'
status: To Do
assignee: []
created_date: '2026-11-20T00:11:00Z'
labels:
  - area:db
  - size:M
  - state:ready
dependencies: []
priority: low
ordinal: 1471000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: deferred from Phase 5 (shipped 2026-04-16, docs/reference/architecture/epic-identity-hardening.md): getOrCreateUserShell intentionally creates users with a null default, so NOT NULL needs an atomic shell-creation redesign with a placeholder persona plus a runMaintenanceTasks rename step, ~150-250 LOC. Pointer orphaned by the BACKLOG.md retirement (PR 2772 review).
What: design and land the atomic shell creation; then the NOT NULL migration.
Acceptance: dev migration green with the placeholder flow exercised end to end.
Promote when: the identity epic is resumed.
<!-- SECTION:DESCRIPTION:END -->
