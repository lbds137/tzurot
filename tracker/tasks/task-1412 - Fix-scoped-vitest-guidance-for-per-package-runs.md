---
id: TASK-1412
title: Fix scoped-vitest guidance for per-package runs
status: To Do
assignee: []
created_date: '2026-11-12T23:14:00Z'
labels:
  - area:testing
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1402000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the documented scoped form (pnpm --filter PKG test -- --run PATH) dropped its positional on common-types — a premise-corroboration run silently executed the whole 3654-test suite while believing it ran one file (PR 2746 worker report, R3). The direct form (npx vitest run PATHS from the package dir) honors paths; bot-client counts proved it (31 = 28 + 3 new). What: probe both forms per package (common-types and bot-client at minimum, plus one more for the pattern), then correct the tzurot-testing skill scoped-run section with the verified form and an explicit caveat for where the pnpm-filter form fails. Acceptance: the skill names a form verified per package; any package where the filter form drops positionals is listed; the probe commands appear in the skill so the next session re-runs them rather than trusting prose.
<!-- SECTION:DESCRIPTION:END -->
