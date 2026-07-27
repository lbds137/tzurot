---
id: TASK-50
title: 'Drift-guard the ban list against NEW Prisma re-exports (catch missing entries)'
status: To Do
assignee: []
created_date: '2026-06-22 00:00'
labels:
  - 'area:bot-client'
  - 'area:common-types'
  - 'area:config-resolver'
  - 'area:conversation-history'
  - 'area:db'
  - 'origin:review'
dependencies: []
ordinal: 50000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Drift-guard the ban list against NEW Prisma re-exports (catch missing entries)

**Why:** #1305's runtime drift-guard test (`check-boundaries.test.ts`) asserts every entry in `BOT_CLIENT_BANNED_COMMON_TYPES_PRISMA_SYMBOLS` is still a real `@tzurot/common-types` export — it catches STALE entries (a banned symbol renamed/removed/moved) and the old `PersonalityService` false-positive risk is gone (list pruned to `createPrismaClient`/`PrismaClient`/`Prisma`). It does NOT catch MISSING entries: a NEW Prisma-backed symbol re-exported directly from common-types that bot-client should be banned from won't be auto-added. By design today — the dedicated Prisma-backed packages (identity/conversation-history/config-resolver) have package-level depcruise bans covering moved services; only NEW direct common-types Prisma re-exports are at risk. **Fix shape**: when common-types gains a new Prisma re-export, add its symbol to the const; ideally tag Prisma-backed exports (marker/convention) and test-assert the ban list ⊇ those tags. **Promote when**: `@tzurot/common-types` gains a new Prisma-backed re-export, or the ban list is next edited. Surfaced 2026-06-22 (PR #1305 claude-review; residual of the now-shipped #1305 drift-backstop).
<!-- SECTION:DESCRIPTION:END -->
