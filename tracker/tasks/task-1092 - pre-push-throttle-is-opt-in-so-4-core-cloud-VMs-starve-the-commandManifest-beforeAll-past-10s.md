---
id: TASK-1092
title: >-
  pre-push throttle is opt-in, so 4-core cloud VMs starve the commandManifest
  beforeAll past 10s
status: To Do
assignee: []
created_date: '2026-09-24 22:37'
labels:
  - 'area:husky'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1085000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the #2515 cloud session hit "Hook timed out in 10000ms" on services/bot-client/src/handlers/commandManifest.test.ts three pushes in a row and needed an owner-approved --no-verify. The beforeAll loads every command module (3.6s alone, green in CI where each package suite has its own job). Under .husky/pre-push, turbo runs every package suite concurrently and vitest adds 3 workers per package, so a 4-CPU VM starves it. The throttle exists (.husky/pre-push step 4: --concurrency=1, NODE_OPTIONS 2GB, LOW_RESOURCE_MODE exported so vitest.config.ts drops maxWorkers to 1) but only when LOW_RESOURCE_MODE is set in the shell or .env, and the cloud clone has neither.
Fix shape: (1) .husky/pre-push step 4 auto-enables the throttle when LOW_RESOURCE_MODE is unset and nproc reports 4 cores or fewer, printing which trigger fired; run its probe after the edit. (2) commandManifest.test.ts gives its command-loading beforeAll an explicit hook timeout with a one-line reason (setup imports every command module), so a single heavy setup does not false-fail the gate. Not an assertion change.
Acceptance: a pre-push on a 4-core box with no LOW_RESOURCE_MODE prints the throttle line; the beforeAll carries the explicit timeout; the next cloud unit pushes with hooks on.
<!-- SECTION:DESCRIPTION:END -->
