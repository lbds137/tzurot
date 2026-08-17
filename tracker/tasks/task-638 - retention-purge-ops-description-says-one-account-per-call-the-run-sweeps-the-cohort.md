---
id: TASK-638
title: >-
  retention:purge ops description says one account per call - the run sweeps the
  cohort
status: To Do
assignee: []
created_date: '2026-08-17 01:52'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 638000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the ops --help table describes retention:purge as "ERASE the purge-eligible cohort, one account per call", but the 2026-08-16 prod run erased all 20 eligible accounts in a single invocation. The phrase likely describes internal gateway-API granularity, not CLI behavior - as written it caused the operator to plan 18 separate invocations.

Fix shape: reword the command description (registration site in packages/tooling, + OPS_CLI_REFERENCE row via guard:ops-doc) to say the run sweeps the whole eligible cohort, one gateway call per account internally.

Acceptance: --help and OPS_CLI_REFERENCE describe the sweep behavior accurately; guard:ops-doc passes.
<!-- SECTION:DESCRIPTION:END -->
