---
id: TASK-1466
title: 'telemetry cache section: scope Q-cache to llm_generation + caveat reword'
status: To Do
assignee: []
created_date: '2026-11-19T18:04:00Z'
labels:
  - area:tooling
  - size:S
  - state:ready
dependencies: []
priority: medium
ordinal: 1466000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Round-6 review finding on PR 2770 (cap round; owner pick: fast-follow). The cache sections Requests column counts non-chat writers (extraction/summary/blurb share GLM model pairs with chat), so the Reported-vs-Requests caveat can misattribute gaps to omitted zeros. Add AND request_type = llm_generation to the Q-cache WHERE in packages/tooling/src/telemetry/inference-report.ts, add a SQL-pin test asserting the filter, reword the LIMITATIONS sentence so the gap guidance is accurate, and add the round-6 optional LIMITATIONS line: readShare assumes tokens_in includes cached reads (unverified per-provider). Reviewer confirmed the hit-rate shares are unaffected; this is guidance + column-population accuracy only.
<!-- SECTION:DESCRIPTION:END -->
