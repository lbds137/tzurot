---
id: TASK-686
title: >-
  Widening the z.ai piggyback past one model needs a weighted budget, not a
  request count
status: To Do
assignee: []
created_date: '2026-08-19 22:16'
labels:
  - 'area:ai-worker'
  - 'size:M'
  - 'state:owner'
dependencies: []
priority: medium
ordinal: 686000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the carve-out (ZAI_FREE_TIER_MODEL = glm-4.5-air, constants/ai.ts:688) is scoped to ONE model precisely because it bills at the plan cheapest 1x multiplier, and the comment there already says widening is an owner decision. The bound on it is FreeTierRequestQuota, which counts REQUESTS. A request count only bounds plan cost while every admitted model shares a multiplier, so admitting a second model at a different rate makes the counter read the same number while real plan consumption diverges silently.

MEASUREMENT 2026-08-19, /admin usage 30d on prod: 4,902 total requests. glm-4.5-air = 2,292 req / 67.56M tokens (47 percent of requests, 45 percent of tokens, ~29.5K tokens per request); glm-5.2 = 2,435 req / 76.20M. So the piggyback is roughly half the whole workload, not a rounding error. z.ai plan tighter window was at 25 percent consumed with 4 days to reset. NOT decomposable by model from that surface -- the plan percentage covers owner coding, fact extraction and guest traffic together.

Also settled by the same read: we have never sent a 4.7 model string. The top 5 models account for 4,893 of 4,902 requests, so at most 9 requests sit outside the display, and none of the listed models is 4.7. The z.ai web usage chart tagging air as 4.7 is therefore a display or internal-aliasing issue on their side, not our routing.

Acceptance: before any second model joins isZaiFreeTierModel, either (a) FreeTierRequestQuota carries a per-model weight so the budget bounds plan cost rather than headcount, or (b) it is recorded why a headcount still bounds it for the specific pair admitted.
<!-- SECTION:DESCRIPTION:END -->
