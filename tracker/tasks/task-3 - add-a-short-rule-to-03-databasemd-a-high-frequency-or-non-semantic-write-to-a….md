---
id: TASK-3
title: >-
  add a short rule to 03-database.md: a high-frequency or non-semantic write to
  a…
status: Done
assignee: []
created_date: '2026-07-22 00:00'
updated_date: '2026-07-28 10:53'
labels:
  - 'area:db'
  - 'area:process'
  - 'origin:review'
dependencies: []
ordinal: 3000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Surfaced 2026-07-22 (retention 1b, #1765 review) — add a short rule to `03-database.md`: a **high-frequency or non-semantic write to a sync-tracked table** (`syncTables.ts`) via the Prisma client auto-bumps `updated_at` (via `@updatedAt`), which `DatabaseSyncService` uses as the dev↔prod **last-write-wins conflict resolver** — so the write silently makes that env's rows "win" and can clobber the other env's edits on the next sync. The retention `lastActiveAt` stamp hit exactly this (hourly per active user) and was fixed by writing via `$executeRaw` (bypasses `@updatedAt`, leaves `updated_at` untouched). **Fix shape**: one paragraph near `03-database.md`'s sync/`updated_at` material — "for a high-frequency or non-semantic column on a sync-tracked table, write it via raw SQL so it doesn't bump `updated_at`." **Promote when**: next `.claude/rules` PR, or the next stamp/counter/last-seen field added to a sync-tracked table.

**Why:** Subtle cross-system side-effect = silent sync data loss; the code comment documents it at the one site, a rule catches the class.
<!-- SECTION:DESCRIPTION:END -->
