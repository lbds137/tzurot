---
id: TASK-404
title: ops logs --since returns zero rows for lines that exist in-window
status: To Do
assignee: []
created_date: '2026-08-02 23:08'
labels:
  - 'area:tooling'
  - 'size:S'
dependencies: []
priority: medium
ordinal: 404000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: during the beta.190 post-release cache check, `pnpm ops logs --env prod --since 45m` (and --since 90m) reported "0 matching lines across 3 service windows" while the same command WITHOUT --since returned ai-worker lines timestamped inside that window (Generated response at 23:00Z, queried ~23:1xZ). A silently-empty time filter reads as "no data" and nearly sent the cache investigation down a wrong path.
What: reproduce, then fix the pino-time --since filter in packages/tooling/src (likely suspects: the `time=` field is epoch MILLISECONDS and the filter may parse it as seconds, or the relative-duration parse anchors to the wrong clock). Add a unit test with a real epoch-ms fixture line.
Acceptance: --since 45m returns the same recent lines the unfiltered pull shows; a regression test pins epoch-ms parsing.
<!-- SECTION:DESCRIPTION:END -->
