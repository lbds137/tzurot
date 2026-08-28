---
id: TASK-792
title: >-
  tests/ workspace has no typecheck script, so pnpm typecheck silently skips the
  whole package
status: To Do
assignee: []
created_date: '2026-08-28 14:45'
labels:
  - 'area:testing'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 792000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: tests/package.json (@tzurot/e2e) has an empty scripts block, so turbo run typecheck — and therefore pnpm quality — skips the entire package rather than erroring. Surfaced by claude-review on PR 2241: the new integration test imports a type from @tzurot/cache-invalidation while that package was absent from tests/package.json dependencies, and nothing static caught it. It worked only because import type is erased before any runtime resolution happens. The missing dependency was added in that PR; the gate gap is what remains.

This matters more now than it did: tests/e2e is no longer fixture-only. It holds real integration and contract tests that import service internals, so a type drift in a service can break a test here with no static gate to catch it.

Fix shape: give tests/package.json a typecheck script and a tsconfig with the right project references (it currently has neither a typecheck entry nor references covering cache-invalidation), then confirm turbo actually picks it up — the package must appear in the typecheck task graph, not merely define the script. Check whether typecheck:spec should cover it too, since that is the tier that type-checks test files elsewhere in the repo.

Acceptance: deliberately breaking a type in a tests/e2e file makes pnpm typecheck fail; the package appears in the turbo typecheck scope list rather than being skipped.
<!-- SECTION:DESCRIPTION:END -->
