---
id: TASK-349
title: Derive check-migration-safety patterns from drift-ignore.json
status: To Do
assignee: []
created_date: '2026-07-29 01:18'
updated_date: '2026-07-29 01:18'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 349000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Surfaced by the #1846 round-3 review — check-migration-safety.ts hand-declares dropPattern/createPattern RegExps that drift-ignore.json protectedIndexes entries ALREADY store as strings (verified: entries carry name, table, type, description, recreateSQL, dropPattern, createPattern). The #1846 guard pins name-set agreement but not pattern equivalence, so the two pattern sources can silently diverge. Fix shape: build PROTECTED_INDEXES from the JSON (new RegExp(entry.dropPattern, "i")) killing the hand-sync for the safety checker entirely; keep the guard test as the agreement backstop for inspect-database. Runtime behavior change to a DB-safety tool, so it wants its own small PR with the canary suite proving detection still fires.
<!-- SECTION:DESCRIPTION:END -->
