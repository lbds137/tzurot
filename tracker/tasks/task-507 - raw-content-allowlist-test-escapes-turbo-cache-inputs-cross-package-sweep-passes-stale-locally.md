---
id: TASK-507
title: >-
  raw-content-allowlist test escapes turbo cache inputs - cross-package sweep
  passes stale locally
status: To Do
assignee: []
created_date: '2026-08-10 17:30'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 507000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the tooling test raw-content-allowlist.test.ts sweeps bot-client command files at runtime, but turbo hashes only the tooling package as inputs for tooling#test. A bot-client edit that trips a budget passes a local full pnpm test via cache hit (observed: PR 2050 - budget 5, actual 6 red in CI, green locally with tooling#test cached), so CI is the first thing that runs the sweep.
Fix shape: declare the swept surfaces as turbo inputs for the tooling test task (e.g. add services/*/src/commands/** to tooling test inputs in turbo.json, or a narrower globalDependencies entry), OR split the live-sweep tests into a task whose inputs include the swept trees. Verify by editing a bot-client literal and confirming tooling#test is a cache MISS.
Acceptance: a raw-literal count change in a swept package invalidates the tooling test cache locally.
<!-- SECTION:DESCRIPTION:END -->
