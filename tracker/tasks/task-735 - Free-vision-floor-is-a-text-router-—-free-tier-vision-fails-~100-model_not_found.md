---
id: TASK-735
title: >-
  Free vision floor is a text router — free-tier vision fails ~100%
  (model_not_found)
status: To Do
assignee: []
created_date: '2026-08-22 21:48'
labels:
  - 'area:ai-worker'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 735000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner prod report 2026-08-22 (characters get the image placeholder). Measured over the full current prod deployment (2026-08-20T20:14Z -> 08-22T21:40Z, ~49h): 23 all-tiers-exhausted placeholder events + 17 negative-cache cooldown serves vs ~25 successful describes — about half of fresh chains died, clustered in extended-context batches (8 in one second at 08-21T07:11Z). Every exhausted chain: tiers=[openrouter/free, qwen/qwen3.7-plus] source=system; openrouter/free failed 25/27 invocations (model_not_found + 400s), qwen then rate_limited.
Mechanism (code-read, not yet runtime-pinned): FREE_ROUTER_MODEL openrouter/free is the free TEXT router, hard fallback of getFreeVisionFloor (services/ai-worker/src/services/freeFloors.ts:29) and registry default of fallbackVisionModelFree (systemSettings.ts:439) — a text router asked for vision 404s. Same class as the beta.205 glm-4.5-air guest-text repoint, vision slot. Open question: a 21:39Z turn ran openrouter/free tier-1 then advanced to openrouter/auto (paid) — why is the free tier ahead of a paid route there.
Fix shape: (a) owner repoints fallbackVisionModelFree to an image-capable free model via /settings (no deploy); (b) code guard: vision floor resolution must reject non-image-capable routers (ModelCapabilityChecker exists) instead of degrading to FREE_ROUTER_MODEL; (c) runtime-confirm the mechanism with one dev probe before building.
Acceptance: free-tier vision describe succeeds on a probe image; exhausted-chain rate in prod logs drops to rate_limit-only residuals; the floor guard is test-pinned.
<!-- SECTION:DESCRIPTION:END -->
