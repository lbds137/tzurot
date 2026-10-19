---
id: TASK-1250
title: Boot-b services crash when a main-tree gate rebuilds package dist
status: To Do
assignee: []
created_date: '2026-10-19 01:42'
labels:
  - 'area:tooling'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1238000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: boot-b (TzurotBot on the Machloket instance B) runs tsx watch from the main checkout, the same tree every gate runs in. Package builds are clean-first (rm -rf dist tsconfig.tsbuildinfo && tsc), so any turbo lint/build there deletes dist for seconds and the watch children die on ERR_MODULE_NOT_FOUND; the parents stay alive with no child and do not recover. Observed 2026-10-18: api-gateway down from 15:55, bot-client 17:55, ai-worker 21:17 (the last one coincides with a lint warm-up); a /random on B at 21:32 got "The application did not respond". Touching src/index.ts restarted ai-worker but not the other two; recovery took a kill by PID plus a relaunch.

What: run boot-b from a dedicated worktree (or a built copy) that gates never touch, with the relaunch recipe in docs/local/boot-b/README.md updated to match; alternatively a supervisor that relaunches a dead child. Measure first how often the main tree is rebuilt in a day.

Acceptance: a full pnpm quality in the main tree leaves boot-b healthy (bot-client log shows no new ERR_MODULE_NOT_FOUND).
<!-- SECTION:DESCRIPTION:END -->
