---
id: TASK-1545
title: Upload unit coverage for the six packages-cell packages Codecov never receives
status: To Do
assignee: []
created_date: '2026-11-25T15:43:00Z'
labels:
  - area:ci
  - size:S
  - state:ready
dependencies: []
priority: medium
ordinal: 1543000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the unit-tests packages cell (.github/workflows/ci.yml, matrix cell: packages) runs test:coverage for cache-invalidation, clients, config-resolver, conversation-history, embeddings and identity, each of which writes coverage/lcov.info, but the cell uploads only packages/common-types/coverage/lcov.info. Their unit coverage never reaches Codecov; only the component flag covers packages/, so a regression in a unit-tested branch there is invisible to the patch gate. Found while doing TASK-1535, which gave test-utils its own upload and flag.

What: one upload per package, each under its own flag with paths in codecov.yml (Codecov flags docs warn that one upload carrying several flags applies the whole report to every flag). Measure the project-coverage effect first: all: true adds every src file, so a package with untested files can lower the project percentage (threshold 2 percent).

Acceptance: Codecov shows each of the six flags from its own unit run, and the project status stays green.
<!-- SECTION:DESCRIPTION:END -->
