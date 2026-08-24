---
id: TASK-639
title: >-
  OpenRouter model catalog unavailable in prod - ModelCapabilityChecker on
  pattern-fallback
status: Done
assignee: []
created_date: '2026-08-17 02:00'
updated_date: '2026-08-24 00:04'
labels:
  - 'area:ai-worker'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 639000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the 2026-08-17 00:40-01:57 UTC prod log window shows repeated "[ModelCapabilityChecker] Model catalog unavailable - running on degraded capability data" (source=pattern-fallback, contextLength=null) on every capability lookup. The two-tier OpenRouterModelCache (5min memory / 24h Redis) should make this rare; a sustained unavailable state means the OpenRouter models fetch is failing or the cache path is broken. Degraded data affects vision/reasoning gating and context-length clamps, and it blocks the GLM-5.3 fallback fix shape (b) (catalog-check before demotion - see the now.md Production Issues entry).

Fix shape: find why the catalog fetch fails in prod (log the fetch error itself if it is currently swallowed), verify the Redis tier is being read, and add a WARN with the underlying error when the catalog goes unavailable for more than one refresh cycle.

Acceptance: prod logs show the catalog loading normally (source not pattern-fallback) or a WARN naming the actual fetch failure; the unavailability cause is identified and filed or fixed.

Closure (retro-verified): root cause was the catalog being fetched only on cold miss - after the 24h Redis TTL expired nothing re-populated it. Fixed by 586a1845b (scheduled refresh at TTL/3 with failure logging + empty-200 rejection), shipped in beta.205 on 2026-08-18. Prod verification 2026-08-23: api-gateway logs show 2 on-cadence refreshes (modelCount=422, zero failures) and ai-worker shows 0 "Model catalog unavailable" warns across a 7h window with 706 job-activity lines - vs. every-lookup warns in the 2026-08-17 window. Sustained-outage alerting remains TASK-650.
<!-- SECTION:DESCRIPTION:END -->
