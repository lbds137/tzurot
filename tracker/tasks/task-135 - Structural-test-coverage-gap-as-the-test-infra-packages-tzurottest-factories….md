---
id: TASK-135
title: Structural-test coverage gap for the test-infra packages
status: To Do
assignee: []
created_date: '2026-06-03 00:00'
updated_date: '2026-07-28 10:48'
labels:
  - 'area:common-types'
  - 'area:testing'
  - 'size:S'
  - 'state:dependent'
dependencies: []
priority: low
ordinal: 135000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Structural-test coverage gap as the test-infra packages (`@tzurot/test-factories`, `@tzurot/test-utils`) grow

**Why:** `EXCLUDE_PATTERNS` in `packages/common-types/src/structure.test.ts` blanket-exempts the entire `@tzurot/test-factories/src/` AND `@tzurot/test-utils/src/` directories from the "every source file has a colocated test" rule, mirroring the legacy in-package `factories/` exclusion. Correct today: test-factories' builders are collectively covered by `factories.test.ts` + `factoryUtils.test.ts`, and test-utils is pure infra (mocks, PGLite setup, `seed.ts` exercised by `seed.component.test.ts`). The tradeoff (same for both): a future contributor could add a `new-logic.ts` file with NO test and the structure audit won't catch it — the blanket exclusion is a bigger gap surface now that each is a dedicated package than it was for a handful of files inside common-types. **Fix shape**: when either package grows logic files, replace the blanket `/\/test-(factories|utils)\/src\//` exclusion with a narrower one (exclude only the known infra files, or require each `*.ts` to be referenced by an import in the package's collective test). **Promote when**: either package gains a third+ logic file, OR a coverage gap is observed. Surfaced 2026-06-03 by PR #1142 (test-factories) + PR #1143 (test-utils) claude-reviews (non-blocking observations). Deferred 2026-06-03.
<!-- SECTION:DESCRIPTION:END -->
