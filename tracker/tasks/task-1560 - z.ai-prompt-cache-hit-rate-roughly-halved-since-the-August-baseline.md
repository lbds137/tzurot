---
id: TASK-1560
title: z.ai prompt-cache hit rate roughly halved since the August baseline
status: To Do
assignee: []
created_date: '2026-11-26T13:06:00Z'
labels:
  - area:ai-worker
  - size:M
  - state:ready
dependencies: []
priority: medium
ordinal: 1554000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: zai-coding is 174 of 206 prod calls (11-19 to 11-26). It is the flat-rate plan, so a miss costs no dollars (doc-17 Phase 3 deferral); the cost is latency (an uncached prefix is processed in full) and possibly plan-quota headroom (whether cached tokens count less against the plan quota is unverified). Measure the latency effect before sizing the fix. The doc-17 gap-bucket reading of prod diagnostic rows (same definition as the doc-17 August table: same-channel gap, hit = cachedPromptTokens > 0) shows zai-coding hit rates of <2m 39.1% (Aug 76.2%), 2-10m 33.3% (Aug 63.3%), 10-30m 16.7% (Aug 35.0%), 30m-2h 0% (Aug 18.8%).

Candidates (unverified): (1) a prompt section added since August rendering ahead of the history messages and changing per turn (e.g. 3de3fa4cf recent_days, 2b72670c8 voice_anchor); (2) the Phase 2 real-messages switch (6c133831c, ON since 09-08) changed where the cut lands; (3) the GLM model change (#2795) or a z.ai-side cache change. Narrow with pnpm ops cache:prefix-diff --env prod on the busiest channel (TASK-643 limits depth selection).

Acceptance: the cause named with prefix-diff evidence, and either a fix with a post-deploy reading of the <2m bucket or a recorded reason the drop is provider-side.
<!-- SECTION:DESCRIPTION:END -->
