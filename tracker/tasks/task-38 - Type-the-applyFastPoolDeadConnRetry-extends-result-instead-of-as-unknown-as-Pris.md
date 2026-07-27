---
id: TASK-38
title: 'Type the applyFastPoolDeadConnRetry $extends result instead of as unknown as PrismaClient'
status: To Do
assignee: []
created_date: '2026-07-01 00:00'
labels:
  - 'area:db'
  - 'origin:review'
dependencies: []
ordinal: 38000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Type the `applyFastPoolDeadConnRetry` `$extends` result instead of `as unknown as PrismaClient`

**Why:** `applyFastPoolDeadConnRetry` (`dbTimeout.ts`) casts the `$extends()` result via `as unknown as PrismaClient` — the only production `$extends` in the repo, so no convention to follow. The cast discards Prisma's extended-client typing: if a future extension changes the fast pool's shape (another `$allOperations` hook, a model-op override), the compiler won't catch a mismatch — it checks against the lied-about `PrismaClient` type and only surfaces at runtime. Safe today (the fast pool only runs `conversationHistory.findUnique`/`.create`, grep-confirmed — no `$transaction`/`$queryRaw`). **Fix shape**: return the `$extends` inferred type (or a narrow structural interface covering just the ops the fast pool uses) and thread it through `RouteDeps.fastPrisma`. **Promote when**: a second fast-pool `$extends` hook is added, or `fastPrisma` grows a consumer beyond the 2 persist routes. Surfaced 2026-07-01 (PR #1424 release review, non-blocking).
<!-- SECTION:DESCRIPTION:END -->
