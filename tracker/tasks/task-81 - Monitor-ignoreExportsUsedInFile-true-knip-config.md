---
id: TASK-81
title: 'Monitor ignoreExportsUsedInFile: true knip config'
status: To Do
assignee: []
created_date: '2026-04-29 00:00'
updated_date: '2026-09-04 19:38'
labels:
  - 'area:bot-client'
  - 'area:api-gateway'
  - 'area:ai-worker'
  - 'size:S'
  - 'state:observable'
dependencies: []
priority: low
ordinal: 81000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Monitor `ignoreExportsUsedInFile: true` knip config

**Why:** PR #941 added `ignoreExportsUsedInFile: true` at the **global** knip config level to dampen the dominant false-positive class (option-bag/result-bag interfaces declared next to consumer functions). Risk: a genuine dead export that happens to also be used internally would be silently suppressed too. Knip supports this flag at per-workspace level. **Fix shape (when triggered)**: remove the global flag, add it per-workspace to only `services/ai-worker`, `services/api-gateway`, `services/bot-client` where the option-bag pattern dominates; leave `packages/*` workspaces stricter since they have public API surfaces. **Promote when**: a real dead-export bug that should have been caught is found by other means (review, manual audit, runtime), OR after ~5 PR cycles if the suppression starts feeling too aggressive in routine PR reviews. Surfaced 2026-04-29 PR #941 round 2. Deferred 2026-05-01.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:38
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): KEEP. `knip.json` still sets `"ignoreExportsUsedInFile": true` at the global level (not per-workspace). The watch's promote-when (a real dead-export bug slipping through, or ~5 PR cycles of the suppression feeling too aggressive) is judgment-based and unfalsifiable from a code grep alone — genuinely a live watch, not stale. Evidence: `grep -n ignoreExportsUsedInFile knip.json` → `"ignoreExportsUsedInFile": true` at top level, line 4.
---
<!-- COMMENTS:END -->
