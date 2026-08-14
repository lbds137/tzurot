---
id: TASK-603
title: inspect-database hand-declares a third copy of the protected-index registry
status: To Do
assignee: []
created_date: '2026-08-14 11:51'
labels:
  - 'area:tooling'
  - 'area:db'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 603000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: check-migration-safety.ts now derives its protected-index list from prisma/drift-ignore.json, killing one hand-maintained copy. inspect-database.ts still carries its own full literal PROTECTED_INDEXES array (name, table, description, recreateSQL) for the same three indexes, and prints description to the operator at two sites (inspect-database.ts:124 and :210). protectedIndexRegistries.test.ts pins the NAME sets in agreement across the three sources, so a name can not drift — but nothing pins the other fields.

Measured drift already present: the facts-index recreateSQL differs between the two sources by a trailing semicolon (drift-ignore.json has none, inspect-database has one). Harmless today, and exactly the kind of divergence the name-set guard cannot see.

Deliberately scoped OUT of the check-migration-safety derivation PR: TASK-349 explicitly kept the guard test as the backstop for inspect-database rather than converting it, and inspect-database prints its descriptions to operators, so deriving them changes user-facing output and wants its own verification.

Fix shape: have inspect-database build its list from the same loader (or a shared one), so drift-ignore.json is the single registry for all three consumers. Reconcile the recreateSQL semicolon while doing it. Keep the name-set guard as the backstop.

Acceptance: inspect-database no longer declares index literals; the three sources agree by construction rather than by test; the guard test still passes; inspect-database output is verified unchanged apart from any deliberate description wording.
<!-- SECTION:DESCRIPTION:END -->
