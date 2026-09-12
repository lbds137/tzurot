---
id: TASK-944
title: >-
  packages/test-utils declares no test script, so its colocated unit tests never
  run in pnpm test or CI
status: To Do
assignee: []
created_date: '2026-09-12 16:54'
labels:
  - 'area:testing'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 942000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: packages/test-utils is the only workspace package without a test script (its scripts are build clean lint lint:fix format typecheck typecheck:spec), so turbo run test skips it and CI never executes its colocated unit tests: contractFixtures.test.ts, jobContextArbitraries.test.ts and, from the ai-worker drain batch 1, invokeMockChatModel.test.ts. Only seed.component.test.ts runs, through the root component config. Found 2026-09-12 when the batch spec named a pnpm --filter @tzurot/test-utils test gate that cannot exist; the orchestrator ran the new helper test through the root vitest config instead. A test file that is never executed reports coverage while verifying nothing.
Fix shape: add a vitest config and a test script to packages/test-utils mirroring a sibling package (test-factories is the closest), confirm turbo picks it up (pnpm turbo run test --dry-run=json lists the package), check guard:gate-parity and test:audit for any registration the new tier needs, and run the three unit files once to see whether any has rotted while unexecuted.
Acceptance: pnpm --filter @tzurot/test-utils test runs the three colocated unit files and CI runs them on every PR; the gate-parity and test-audit guards stay green.
<!-- SECTION:DESCRIPTION:END -->
