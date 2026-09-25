---
id: TASK-1094
title: >-
  Codecov component step uploads two JSON files beside lcov.info (disable_search
  unset)
status: To Do
assignee: []
created_date: '2026-09-25 01:23'
labels:
  - 'area:ci'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 1087000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the `Upload component coverage to Codecov` step in `.github/workflows/ci.yml` names `./coverage/component/lcov.info` but leaves `disable_search` unset, so codecov also picks up `coverage-topology.json` and `test-coverage-baseline.json` and uploads them under the `component` flag (seen in develop CI run 36080696626 while lcov.info itself was missing; the missing-lcov half is fixed by the TASK-614 PR).
Fix shape: set `disable_search: true` on that step (and check the unit-coverage step for the same), then read one CI run to confirm only lcov.info is uploaded under each flag.
Acceptance: the codecov step log lists exactly one file per flag.
<!-- SECTION:DESCRIPTION:END -->
