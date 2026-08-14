---
id: TASK-608
title: Partial-index recreate is no longer required to carry its WHERE clause
status: To Do
assignee: []
created_date: '2026-08-14 16:01'
labels:
  - 'area:db'
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 608000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the pre-commit hook previously required a recreate of memories_chunk_group_id_idx to match CREATE INDEX.*memories_chunk_group_id_idx.*WHERE. That grep block was replaced by pnpm ops db:check-safety, whose createPattern for the entry is CREATE\s+INDEX.*memories_chunk_group_id_idx with no WHERE requirement. So a migration that drops the partial index and recreates it NON-partially is now accepted where it was previously rejected. Dropping the WHERE clause turns a small partial index into a full-table index: correctness is preserved but the size and write-cost benefit is silently lost.

Not tightened in the same PR, deliberately: check-migration-safety matches whole-file content with a regex that has no s flag, so . does not cross newlines. The one real recreate in the repo (20251218140000_add_memory_chunk_fields) puts CREATE INDEX on line 11 and WHERE on line 12, so a naive .*WHERE pattern would fail to match the correct migration and flag it as a violation. Verified by reading both the matcher and the migration.

Fix shape: needs statement-level awareness rather than a whole-file regex. Options: normalize whitespace before matching, use [\s\S] with a bounded window, or split the file on semicolons and match per statement. Whichever is chosen must be validated against the existing correct migration as a negative control.

SECOND DIRECTION, folded in from the PR 2101 round-3 review (which scoped it "pre-existing"; origin is not a verdict, so it gets a disposition on merit): the same missing s flag means a DROP INDEX whose statement is split across lines does not match dropPattern at all, so the drop is never detected and the file reads as safe. That is a FALSE NEGATIVE on the gate this whole task exists to sharpen, and it is strictly worse than the WHERE gap above, which only relaxes a check. Both close under the one fix — statement-level matching — which is why this is folded in here rather than filed as a second task that would fragment the same work.

Acceptance: a migration dropping memories_chunk_group_id_idx and recreating it without a WHERE clause is rejected; a migration whose DROP INDEX statement spans two lines is still detected as a drop; AND the existing 20251218140000 migration still passes as the negative control.
<!-- SECTION:DESCRIPTION:END -->
