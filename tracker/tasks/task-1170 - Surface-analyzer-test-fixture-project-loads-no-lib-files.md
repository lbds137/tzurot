---
id: TASK-1170
title: Surface analyzer test fixture project loads no lib files
status: To Do
assignee: []
created_date: '2026-10-04 21:07'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1162000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: buildFixtureProject in packages/tooling/src/surface/analyzer.test.ts sets compilerOptions lib: ['es2022']. In an in-memory ts-morph project that loads no lib file: a probe during PR #2571 round 5 showed diagnostics "Cannot find global type Array" and Error resolving to any. Every existing fixture therefore runs without global types, so a fixture can pass while a lib-typed value is silently any (measured, not hypothesized). PR #2571 worked around it with a separate buildLibFixtureProject using lib: ['lib.es2022.d.ts'].

What: switch the shared fixture to the file-name lib form (or drop the lib option), rerun the analyzer tests, and examine every outcome change; then fold buildLibFixtureProject back into the shared helper.

Acceptance: the shared fixture resolves Array and Error (assert no global-type diagnostics), all analyzer tests pass with any changed expectation justified in the PR, one fixture helper remains.
<!-- SECTION:DESCRIPTION:END -->
