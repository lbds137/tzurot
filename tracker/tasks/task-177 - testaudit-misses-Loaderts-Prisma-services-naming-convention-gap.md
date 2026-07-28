---
id: TASK-177
title: 'test:audit misses *Loader.ts Prisma services (naming-convention gap)'
status: To Do
assignee: []
created_date: '2026-06-25 00:00'
updated_date: '2026-07-28 10:49'
labels:
  - 'area:tooling'
  - 'area:identity'
  - 'area:db'
  - 'size:S'
dependencies: []
priority: medium
ordinal: 177000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

`test:audit` misses `*Loader.ts` Prisma services (naming-convention gap)

**Why:** `findServiceFiles` (`packages/tooling/src/test/audit-unified.ts`) matches `/Service\.ts$/`, so a Prisma-using class named `*Loader.ts` escapes the component-test ratchet. Concrete case: `PersonalityLoader.ts` (`packages/identity`) holds the actual `this.prisma.*` calls (PersonalityService delegates to it + only imports `PrismaClient` as a type, so PersonalityService correctly isn't flagged). NO coverage gap today — `PersonalityService.component.test.ts` exercises the full Service→Loader stack — but if that test were deleted, the ratchet wouldn't catch it. **Fix shape**: widen the pattern to `/Service\.ts$|Loader\.ts$/` (bump TEST_AUDIT_IMPL_VERSION + refresh baseline; verify no new gaps), OR a broader rename convention. **Promote when**: next touching `audit-unified.ts`, or a `*Loader.ts` Prisma class loses its coverage. Surfaced 2026-06-25 by PR #1344 round-3 claude-review.
<!-- SECTION:DESCRIPTION:END -->
