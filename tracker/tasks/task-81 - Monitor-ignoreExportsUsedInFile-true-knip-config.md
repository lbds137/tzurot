---
id: TASK-81
title: 'Monitor ignoreExportsUsedInFile: true knip config'
status: To Do
assignee: []
created_date: '2026-04-29 00:00'
labels:
  - 'area:bot-client'
  - 'area:api-gateway'
  - 'area:ai-worker'
dependencies: []
ordinal: 81000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Monitor `ignoreExportsUsedInFile: true` knip config

**Why:** PR #941 added `ignoreExportsUsedInFile: true` at the **global** knip config level to dampen the dominant false-positive class (option-bag/result-bag interfaces declared next to consumer functions). Risk: a genuine dead export that happens to also be used internally would be silently suppressed too. Knip supports this flag at per-workspace level. **Fix shape (when triggered)**: remove the global flag, add it per-workspace to only `services/ai-worker`, `services/api-gateway`, `services/bot-client` where the option-bag pattern dominates; leave `packages/*` workspaces stricter since they have public API surfaces. **Promote when**: a real dead-export bug that should have been caught is found by other means (review, manual audit, runtime), OR after ~5 PR cycles if the suppression starts feeling too aggressive in routine PR reviews. Surfaced 2026-04-29 PR #941 round 2. Deferred 2026-05-01.
<!-- SECTION:DESCRIPTION:END -->
