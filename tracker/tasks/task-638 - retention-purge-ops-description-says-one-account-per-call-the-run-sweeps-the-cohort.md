---
id: TASK-638
title: >-
  retention:purge ops description says one account per call - the run sweeps the
  cohort
status: To Do
assignee: []
created_date: '2026-08-17 01:52'
updated_date: '2026-09-04 19:38'
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

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:38
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): KEEP. Confirmed the misleading description is still live and unedited — a real operator-facing correctness defect (already caused one operator to plan 18 unnecessary separate invocations). Evidence: `git grep -n "one account per call" packages/tooling/src` → `retention.ts:48`, `.command('retention:purge', 'ERASE the purge-eligible cohort, one account per call')`, unchanged.
---
<!-- COMMENTS:END -->
