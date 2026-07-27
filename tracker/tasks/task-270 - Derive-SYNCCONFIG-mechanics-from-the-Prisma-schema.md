---
id: TASK-270
title: 'Derive SYNC_CONFIG mechanics from the Prisma schema'
status: To Do
assignee: []
created_date: '2026-07-14 00:00'
labels:
  - 'area:db'
dependencies: []
ordinal: 270000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Derive SYNC_CONFIG mechanics from the Prisma schema — Every new-tables PR trips prod db-sync "not in SYNC_CONFIG" warnings during the schema-ahead-of-code window, and the config hand-codes per-table PKs/timestamps/uuidColumns with only a component test as backstop (the test DID gate #1648 — the forgotten-config class is dead; this is about shrinking the hand-coded surface). Owner 2026-07-14: "manual hard coding of columns isn't working." **Fix shape**: derive pk/timestamps/uuidColumns from the Prisma DMMF at build or runtime; SYNC_CONFIG shrinks to the irreducibly-human per-table verdict (sync vs exclude + reason). The schema-ahead warnings themselves are timing-inherent (old prod code, new schema) and vanish per release — a derivation makes them accurate but can't remove them. **Promote when**: next PR that touches syncTables.ts, or the next time a sync-config field-level bug (not just a warning) surfaces. Surfaced 2026-07-14 (post-#1648 prod sync report).

**Why:** Same philosophy as the queued "derive serialize field sets from Zod" theme — decisions stay manual, mechanics derive.
<!-- SECTION:DESCRIPTION:END -->
