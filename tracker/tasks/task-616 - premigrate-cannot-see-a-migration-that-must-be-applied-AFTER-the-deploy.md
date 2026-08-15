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
<!-- SECTION:DESCRIPTION:END -->
