---
id: TASK-616
title: premigrate cannot see a migration that must be applied AFTER the deploy
status: To Do
assignee: []
created_date: '2026-08-15 11:29'
labels:
  - 'area:tooling'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 616000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: release:premigrate classifies a migration as destructive by scanning for DDL keywords only — DROP COLUMN, DROP TABLE, RENAME COLUMN, RENAME TO, SET NOT NULL, DROP CONSTRAINT, ALTER COLUMN TYPE (DESTRUCTIVE_PATTERNS in packages/tooling/src/release/premigrate.ts). A pure-DML migration therefore always reads as additive and is applied BEFORE the release merges, while the old code is still live.

That is wrong for any DML migration that RENAMES or RESHAPES data the old code reads. Concrete case: 20260814120000_collapse_reasoning_to_thinking (PR 2103) renames a JSONB key, so old code sees a migrated row as having no reasoning configured — no scaled max_tokens, no effort sent upstream, leak detection off — for the whole deploy window. The owner decided to invert the order for that one, and the ONLY thing carrying that decision is a comment in the migration header plus a CURRENT.md note. A human has to read the right file at the right moment; nothing enforces it. Same failure class as the beta.140 incident that 03-database.md was written for.

What: give premigrate a recognized opt-out marker — e.g. a sentinel SQL comment such as `-- tzurot:apply-after-deploy` — that it detects and REFUSES on with an explanation naming the correct sequence, the same shape as the existing --allow-destructive refusal. Add the marker to the doc-77 migration. Consider also flagging pure-DML UPDATE migrations for a human read, since additive-by-DDL-absence is the wrong default for data reshapes.

Acceptance: a migration carrying the marker makes release:premigrate exit nonzero with a message naming the deploy-then-migrate order; covered by a unit test in the premigrate suite; 03-database.md Deployment section documents the marker.

Update 2026-08-15 (Fable verification pass): the conflict this task anticipates is now LIVE — 20260815134528_add_thinking_content_to_history (#2105) is pending on prod alongside the collapse migration and needs the STANDARD premigrate order, and `migrate deploy` is all-or-nothing with the collapse sorting first. So a marker design must handle a MIXED pending set: a bare refuse would block a release whose later migration legitimately needs premigrate. The concrete instance resolves before this task ships (CURRENT.md records the recommendation: premigrate both — after-deploy now breaks history writes for the window, worse than the collapse's bounded degradation), but the tool should refuse with a mixed-set explanation rather than assume marker-only pending sets.
<!-- SECTION:DESCRIPTION:END -->
