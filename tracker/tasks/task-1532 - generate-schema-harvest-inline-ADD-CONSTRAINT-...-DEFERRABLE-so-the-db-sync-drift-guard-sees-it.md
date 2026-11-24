---
id: TASK-1532
title: >-
  generate-schema: harvest inline ADD CONSTRAINT ... DEFERRABLE so the db-sync
  drift guard sees it
status: To Do
assignee: []
created_date: '2026-11-24T16:33:00Z'
labels:
  - area:tooling
  - size:S
  - state:ready
dependencies: []
priority: medium
ordinal: 1529000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the db-sync drift guard (DatabaseSyncService.component.test.ts, every DEFERRABLE foreign key test) reads the PGLite schema, which gets deferrability only from DEFERRABLE_CONSTRAINT_REGEX in packages/tooling/src/test/generate-schema.ts (ALTER CONSTRAINT form). A migration writing DEFERRABLE inline in ADD CONSTRAINT would be deferrable in prod but not in PGLite, so the guard would pass while SYNC_DEFERRED_CONSTRAINTS misses it: the same drift class as TASK-1528. All current migrations use the ALTER form (claude-review on PR 2802).

What: extend the harvest to the inline ADD CONSTRAINT ... DEFERRABLE form (or fail generation when it sees one), with a generate-schema test and a canary.

Acceptance: a fixture migration with an inline DEFERRABLE FK ends up DEFERRABLE in the generated schema; the guard reddens when that FK is absent from the list.
<!-- SECTION:DESCRIPTION:END -->
