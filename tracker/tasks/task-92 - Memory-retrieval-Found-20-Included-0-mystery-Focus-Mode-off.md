---
id: TASK-92
title: 'Memory retrieval Found: 20 / Included: 0 mystery (Focus Mode off)'
status: To Do
assignee: []
created_date: '2026-05-03 00:00'
labels: []
dependencies: []
ordinal: 92000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Memory retrieval `Found: 20 / Included: 0` mystery (Focus Mode off)

**Why:** Diagnostic screenshot 2026-05-03 showed 20 candidate memories scored 0.65–0.71 with zero included despite Focus Mode off. Possible: similarity-threshold misconfigured (0.72+?), token-budget logic returning 0, ranking-filter pipeline dropping candidates. Same screenshot also showed `History > 70%! Sycophancy risk!` — context-budget pressure may be related. **Fix shape**: trace `MemoryService.retrieveRelevant() → MemoryBudgetManager → final-include filter`; add structured log between each stage so drop reason is visible in diagnostic. **Promote when**: a user reports degraded memory recall, OR opportunistic during next memory-pipeline pass. Surfaced 2026-05-03. Deferred 2026-05-12.
<!-- SECTION:DESCRIPTION:END -->
