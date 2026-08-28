---
id: TASK-791
title: >-
  Vision fallback tiers fail in prod: openrouter/auto returns empty,
  openrouter/free has no eligible endpoint
status: To Do
assignee: []
created_date: '2026-08-28 14:45'
labels:
  - 'area:ai-worker'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 791000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: prod ai-worker logs for the beta.209 deployment (2026-08-28 04:18Z-13:30Z window) show 21 vision fallback chains fully exhausted against only 3 completed image descriptions. Most images posted to prod in that window got no description at all. Tally taken from the VisionDescriptionCache negative-cache log lines, which carry model and category as structured fields (not adjacency guessing): openrouter/auto 20x empty_response + 1x quota_exceeded; openrouter/free 1x model_not_found; z-ai/glm-5.3-flash 14x rate_limit + 13x bad_request.

Owner call 2026-08-28: the FALLBACK tiers are the defect, not the flash primary. openrouter/auto is meant to serve paid users and openrouter/free the guests; Qwen was also censoring images, so flash is not a regression and swapping it back would not touch the exhausted chains.

Two account-side leads, both unverified as causes:
1. The single quota_exceeded is a 402 whose text reads: requested up to 65536 tokens, but can only afford 5677. That is the OpenRouter key at or near its monthly limit. HYPOTHESIS, not runtime-confirmed: a key at its ceiling may also be what produces the 20 empty_response results from openrouter/auto.
2. The openrouter/free 404 reads: No endpoints available matching your guardrail restrictions and data policy, and points at the OpenRouter account privacy settings. If the data policy excludes the providers hosting free models, the free floor has no eligible endpoint at all.

Fix shape: first confirm or clear the two account-side leads, since neither is a code change. Then instrument whatever remains: VisionProcessor logs the requested modelName and the failure category but NOT which concrete model openrouter/auto actually routed to, so we cannot currently distinguish auto picking a non-vision model from auto being refused from auto returning a genuinely empty completion.

Acceptance: a fresh image in prod is described without exhausting the chain; the exhaustion rate (21 per 9 hours at filing) drops to near zero; if the cause turns out to be account-side, that finding is recorded so the next occurrence is diagnosable rather than re-investigated.
<!-- SECTION:DESCRIPTION:END -->
