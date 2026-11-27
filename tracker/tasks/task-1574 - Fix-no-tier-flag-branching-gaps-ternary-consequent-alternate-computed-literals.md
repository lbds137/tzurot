---
id: TASK-1574
title: >-
  Fix no-tier-flag-branching gaps: ternary consequent/alternate + computed
  literals
status: To Do
assignee: []
created_date: '2026-11-27T19:16:00Z'
labels:
  - area:tooling
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1564000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: carried from PR 2827 r4 - the custom rule (packages/tooling/src/eslint/no-tier-flag-branching.ts) misses tier-flag branching expressed as ternary consequent/alternate and computed string literals, so that shape ships unflagged. Fix-or-document was the r4 disposition; PR 2 dropped it with the same worker-spec error (stated in the PR 2 body). What: extend the rule to cover both shapes, or document the gaps at the rule source if AST coverage is impractical. Acceptance: a canary fixture in each gap shape reddens the rule, rule tests green, tooling build green.
<!-- SECTION:DESCRIPTION:END -->
