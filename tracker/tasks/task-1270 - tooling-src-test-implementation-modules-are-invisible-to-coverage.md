---
id: TASK-1270
title: >-
  packages/tooling/src/test/ implementation modules are invisible to coverage
  (the '**/test/**' exclude)
status: To Do
assignee: []
created_date: '2026-10-23 18:00'
labels:
  - 'area:tooling'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1259000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the root vitest.config.ts coverage block excludes the `**/test/**` glob, and
packages/tooling keeps IMPLEMENTATION modules under src/test/ (mutation-check.ts,
mutation-gate.ts, audit-reporting.ts, audit-unified.ts, audit-utils.ts,
audit-version.ts, generate-schema.ts, test-tiers.ts, tier-report.ts — nine files at
filing). None of them appear in coverage reports or codecov, so the coverage ratchet
never measures them. Found 2026-10-23 when PR 2644's codecov/patch went red: its new
modules had followed the same convention (that PR moved them out to src/mutation/).

What: move the implementation modules to non-test directories (a mutation/ dir exists
since PR 2644; an audit/ dir fits the audit-* family), update every importer
(packages/tooling/src/commands/* and anything reading the dist), and confirm each
moved file appears in the tooling coverage output. Colocated tests move with their
modules. Do NOT touch the vitest exclude glob (test-only files must stay excluded).

Acceptance: no implementation .ts file (non *.test.ts) remains under
packages/tooling/src/test/; the tooling coverage report lists each moved module;
full tooling suite + quality green.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
<!-- SECTION:NOTES:END -->
