---
id: TASK-119
title: >-
  Drop qs pnpm override when express/supertest ship versions that bump qs
  upstream
status: To Do
assignee: []
created_date: '2026-05-23 00:00'
updated_date: '2026-07-28 10:48'
labels:
  - 'area:ci'
  - 'size:S'
  - 'state:observable'
dependencies: []
priority: low
ordinal: 119000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Drop `qs` pnpm override when express/supertest ship versions that bump qs upstream

**Why:** PR #1088 added `qs@>=6.11.1 <6.15.2: >=6.15.2 <7.0.0` to root `package.json` pnpm overrides to clear `GHSA-q8mj-m7cp-5q26`. Override is transient — once `express@5.2.x` and `supertest@7.x` ship versions that depend on `qs@>=6.15.2` directly, the override becomes a no-op and can be deleted to keep `package.json` lean. **Fix shape**: `pnpm why qs` shows current consumers; when both report `qs@>=6.15.2` as their direct dep (not via the override), delete the override line and re-run `pnpm install`. **Promote when**: dependabot opens a follow-up to bump express or supertest (it usually does for transitive vulns once the upstream catches up), OR opportunistically during the next dep-audit pass. Surfaced 2026-05-23 by PR #1088 claude-review. Deferred 2026-05-23.
<!-- SECTION:DESCRIPTION:END -->
